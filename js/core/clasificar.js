// Clasificación de la sesión: tipo de cada foto, subtipo intraoral por segmentación de la secuencia,
// grupos de tomas repetidas y elección de la más nítida. Funciones puras (se prueban con node).
import { ESPACIOS, TIPOS, volteoDe } from './tipos.js';
import { mapaGirado } from './dientes.js';
import { CONSTANTES } from './constantes.js';

// ---------------------------------------------------------------------------------------------
// Una foto sola

// ¿La cara detectada es creíble? En intraorales el detector a veces "ve" una cara en la boca.
export function caraValida(a, C = CONSTANTES) {
  const c = a.cara;
  if (!c) return false;
  if (a.color.rosa > C.clasificacion.rosaMaxRetrato) return false;
  const anchoCara = c.caja.x1 - c.caja.x0;
  return anchoCara > 0.03 && anchoCara < 0.7;
}

// Foto de identificación: cara de frente y al menos una mano por debajo del mentón, cerca de la
// cara en horizontal (las manos de quien sostiene el fondo blanco quedan arriba, en las esquinas).
export function esIdentificacion(a) {
  const c = a.cara;
  if (!c || !a.manos?.length) return false;
  const anchoCara = c.caja.x1 - c.caja.x0;
  return a.manos.some((m) => {
    const mx = (m.x0 + m.x1) / 2;
    return m.y0 > c.menton.y - 0.05 && mx > c.caja.x0 - 1.5 * anchoCara && mx < c.caja.x1 + 1.5 * anchoCara;
  });
}

// Perfil según la segmentación: cabeza con piel de la cara en un solo extremo.
export function parecePerfil(a, C = CONSTANTES) {
  const k = a.cabeza;
  if (!k || a.color.rosa > C.clasificacion.rosaMaxRetrato) return false;
  const min = Math.min(k.pielIzq, k.pielDer), max = Math.max(k.pielIzq, k.pielDer);
  return min <= 0.12 && max >= 0.4 && Math.abs(k.desvioPiel) >= 0.05 && k.fracPelo > 0.01 && k.fracPiel > 0.01;
}

// Tipo de una foto mirada sola. Para las intraorales devuelve 'intraoral' (el subtipo se decide con
// la secuencia). Devuelve { tipo, confianza }.
export function tipoIndividual(a, C = CONSTANTES) {
  const k = C.clasificacion;
  if (caraValida(a, C)) {
    const c = a.cara;
    const yaw = Math.abs(c.yaw ?? 0);
    if (yaw >= k.yawPerfil) {
      const mira = a.cabeza?.mira || (c.yaw > 0 ? 'der' : 'izq');
      return { tipo: mira === 'izq' ? 'perfil_izq' : 'perfil_der', confianza: 0.7 };
    }
    if (yaw >= k.yawTresCuartos) return { tipo: 'tres_cuartos', confianza: yaw >= k.yawTresCuartos + 8 ? 0.9 : 0.6 };
    if (esIdentificacion(a)) return { tipo: 'identificacion', confianza: 0.9 };
    const s = c.sonrisa;
    const conf = Math.min(1, 0.5 + Math.abs(s - k.umbralSonrisa));
    return { tipo: s >= k.umbralSonrisa ? 'frente_sonrisa' : 'frente_reposo', confianza: conf };
  }
  if (parecePerfil(a, C)) {
    return { tipo: a.cabeza.mira === 'izq' ? 'perfil_izq' : 'perfil_der', confianza: 0.85 };
  }
  if (a.color.rosa >= k.rosaMinIntraoral) return { tipo: 'intraoral', confianza: 0.9 };
  return { tipo: 'otra', confianza: 0.3 };
}

// ---------------------------------------------------------------------------------------------
// Orientación de las intraorales (giro k·90°)
//
// Las fotos de celular pueden traer el EXIF bien y el contenido girado (al apuntar hacia abajo o
// hacia arriba). Un modelo lineal calibrado puntúa cada giro k del "mapa" de la foto (distribución
// de dientes, mucosa, oscuro, plástico y otros en una grilla); se suma un previo que favorece 0°
// (EXIF correcto) y castiga mucho 180°. Giro k = el que se usa como Recorte.angulo = 90·k.

// Puntajes (log, normalizados) de cada giro k = 0..3 para una foto.
export function puntajesGiro(a, C = CONSTANTES) {
  const o = C.orientacion;
  const mapa = a?.dientes?.mapa;
  if (!o || !mapa) return [0, -Infinity, -Infinity, -Infinity];
  const s = [0, 1, 2, 3].map((k) => {
    const m = mapaGirado(mapa, k);
    let v = o.sesgo || 0;
    for (let i = 0; i < m.length; i++) v += m[i] * o.pesos[i];
    return v + o.previo[k];
  });
  const mx = Math.max(...s);
  const z = Math.log(s.reduce((acc, v) => acc + Math.exp(v - mx), 0)) + mx;
  return s.map((v) => v - z);
}

export function giroDeFoto(a, C = CONSTANTES) {
  const s = puntajesGiro(a, C);
  return s.indexOf(Math.max(...s));
}

// Giro común de varias fotos de la misma toma: se promedian sus evidencias (sin el previo) y se
// suma el previo. Promediar (no sumar) evita que pocas fotos con un sesgo leve venzan al previo.
export function giroComun(lista, C = CONSTANTES) {
  if (!lista.length) return 0;
  const previo = C.orientacion?.previo || [0, 0, 0, 0];
  const total = [0, 0, 0, 0];
  for (const a of lista) puntajesGiro(a, C).forEach((v, k) => { total[k] += (v - previo[k]) / lista.length; });
  total.forEach((v, k) => { total[k] = v + previo[k]; });
  return total.indexOf(Math.max(...total));
}

// Rasgos de la vista tal como se ve con el giro k.
export function vistaEnGiro(a, k) {
  return a?.dientes?.vistas?.[k] || a?.dientes?.vista || null;
}

// ---------------------------------------------------------------------------------------------
// Espejo y lado de los incisivos (laterales)

// ¿La foto se tomó con espejo? true, false o null (no se sabe). Claves: la "imagen doble" (dientes
// reales de cerca, altos, junto a un borde, fuera del espejo) y las zonas oscuras fuera del espejo.
// Una lateral directa (sin espejo) no tiene ninguna de las dos.
export function espejoDe(a, k, C = CONSTANTES) {
  const v = vistaEnGiro(a, k);
  const osc = a?.dientes?.espejo?.oscuro;
  const e = C.espejo;
  if (!v || osc == null || !e) return null;
  if (v.alturaBorde >= e.alturaEspejo || osc >= e.oscuroEspejo) return true;
  if (v.alturaBorde < e.alturaDirecta && osc < e.oscuroDirecta) return false;
  return null;
}

// Puntaje de "incisivos a la DERECHA en la foto final" (después del giro y del volteo) de una
// lateral. Positivo = derecha. Con espejo (se voltea): los incisivos del reflejo quedan del lado
// de los dientes grandes y el volteo los pasa al otro lado. Sin espejo (no se voltea): el
// retractor queda del lado de los molares, opuesto a los incisivos.
export function ladoIncisivosFinal(a, k, espejo) {
  const v = vistaEnGiro(a, k);
  if (!v) return 0;
  if (espejo === false) return 0.5 - (v.cxPlastico ?? 0.5);
  return 0.5 - (v.cxGrandes ?? 0.5);
}

// Volteo propuesto para una foto según su tipo ACTUAL y la evidencia de espejo de su análisis:
// las laterales tomadas sin espejo no se voltean; el resto, el volteo del tipo.
export function volteoAutoDe(foto) {
  const t = foto.tipo;
  if (t === 'io_lateral_1' || t === 'io_lateral_2') return foto.analisis?.espejo === false ? 'ninguno' : 'horizontal';
  return volteoDe(t);
}

// ---------------------------------------------------------------------------------------------
// Vista intraoral (modelo lineal calibrado sobre el mapa de clases de la foto ya derecha)

// Vistas del modelo: las dos laterales se reconocen igual (el lado se decide aparte).
export const VISTAS_MODELO = ['io_frontal', 'lateral', 'io_oclusal_inf', 'io_oclusal_sup'];

// Rasgos relativos a la sesión: brillo y textura de la zona central de cada foto comparados con la
// mediana de las intraorales de la misma sesión (el paladar es más claro y liso que la lengua, pero
// el brillo absoluto depende de la cámara y del flash). lista: [{ analisis, giro }].
export function relativosSesion(lista) {
  const v = lista.map((x) => vistaEnGiro(x.analisis, x.giro) || {});
  const med = (c) => {
    const xs = v.map((y) => y[c]).filter(Number.isFinite).sort((a, b) => a - b);
    return xs.length ? xs[xs.length >> 1] : 0;
  };
  const ml = med('lumCentro'), mt = med('texturaCentro');
  return v.map((y) => [((y.lumCentro ?? ml) - ml) / 20, ((y.texturaCentro ?? mt) - mt) / 10]);
}

// Entrada del modelo de vistas: el mapa de clases visto con el giro k, los rasgos relativos a la
// sesión y un término constante.
export function entradaVista(a, k, relativos = [0, 0]) {
  const mapa = a?.dientes?.mapa;
  return mapa ? [...mapaGirado(mapa, k), ...relativos, 1] : null;
}

// Probabilidades (softmax con temperatura) de cada vista de VISTAS_MODELO para la foto `a` vista
// con el giro k. Una temperatura mayor que 1 suaviza el modelo.
export function probVista(a, k, C = CONSTANTES, temperatura = C.vistas?.temperatura ?? 1, relativos = [0, 0]) {
  const x = entradaVista(a, k, relativos);
  const W = C.vistas?.pesos;
  if (!x || !W) return VISTAS_MODELO.map(() => 1 / VISTAS_MODELO.length);
  const s = W.map((w) => w.reduce((acc, val, i) => acc + val * x[i], 0) / temperatura);
  const m = Math.max(...s);
  const e = s.map((v) => Math.exp(v - m));
  const z = e.reduce((p, q) => p + q, 0);
  return e.map((v) => v / z);
}

// Distancia entre firmas visuales (0..1).
export function distanciaFirmas(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length / 255;
}

function promedioFirmas(lista) {
  const f = lista.filter(Boolean);
  if (!f.length) return null;
  return f[0].map((_, k) => f.reduce((s, x) => s + x[k], 0) / f.length);
}

// Puntaje de frontera entre la foto i−1 y la i: diferencia visual entre los vecindarios (las
// `ventana` fotos de cada lado) más un término por el tiempo transcurrido.
export function puntajesFrontera(items, C = CONSTANTES) {
  const k = C.segmentacion;
  const b = new Array(items.length).fill(0);
  for (let i = 1; i < items.length; i++) {
    const A = promedioFirmas(items.slice(Math.max(0, i - k.ventana), i).map((x) => x.firma));
    const B = promedioFirmas(items.slice(i, i + k.ventana).map((x) => x.firma));
    const dv = Math.max(distanciaFirmas(A, B), distanciaFirmas(items[i - 1].firma, items[i].firma));
    const t0 = items[i - 1].fecha, t1 = items[i].fecha;
    const dt = t0 != null && t1 != null ? Math.max(0, (t1 - t0) / 1000) : null;
    b[i] = dv + (dt == null ? k.tiempoSinFecha : k.tau * Math.log2(1 + dt / 30));
  }
  return b;
}

// Estados de la secuencia intraoral. Las dos laterales comparten la probabilidad de "lateral" del
// modelo de vistas y se separan por el lado de los incisivos en la foto final.
export const ESTADOS = ['io_frontal', 'io_lateral_1', 'io_lateral_2', 'io_oclusal_inf', 'io_oclusal_sup'];
const VISTA_DE_ESTADO = [0, 1, 1, 2, 3];

// Órdenes de captura conocidos (cámara Sony y celular de los pacientes de referencia).
// Dan un previo suave: pasar de una vista a la siguiente en alguno de estos órdenes
// no cuesta extra; cualquier otro paso cuesta `penalOrden`.
export const ORDENES_CONOCIDOS = [
  ['io_frontal', 'lateral', 'lateral', 'io_oclusal_inf', 'io_oclusal_sup'],
  ['io_oclusal_sup', 'io_oclusal_inf', 'io_frontal', 'lateral', 'lateral'],
];

// Pasos e inicios conocidos: de todos los órdenes, o solo del orden `orden` (índice) si la sesión
// mostró cuál sigue.
function pasosConocidos(orden = null) {
  const familia = (e) => (e.includes('lateral') ? 'lateral' : e);
  const pasos = new Set(), inicios = new Set();
  for (const o of orden == null ? ORDENES_CONOCIDOS : [ORDENES_CONOCIDOS[orden]]) {
    inicios.add(o[0]);
    for (let i = 1; i < o.length; i++) pasos.add(`${o[i - 1]}>${o[i]}`);
  }
  const conocido = ESTADOS.map((a) => ESTADOS.map((b) => pasos.has(`${familia(a)}>${familia(b)}`)));
  const inicio = ESTADOS.map((a) => inicios.has(familia(a)));
  return { conocido, inicio };
}

// Etiqueta una secuencia con los ESTADOS sin imponer un orden fijo (Viterbi). El estado de la
// programación dinámica es (vista actual, conjunto de vistas ya usadas), así se puede:
//   - castigar un paso que no está en ningún orden conocido (penalOrden),
//   - castigar volver a una vista ya usada, como una toma repetida al final (penalRetorno),
//   - castigar cada vista que no aparece (penalSalto),
//   - cortar donde la frontera visual/temporal es fuerte (costoCambio − lambda·frontera).
// unario[i][s]: costo de que la foto i sea el estado s. Devuelve el índice de estado de cada foto.
//
// Con `orden` (índice de ORDENES_CONOCIDOS que la sesión mostró seguir; ver ordenDeSesion), solo
// valen los pasos de ese orden y salirse de él cuesta `penalFueraDeOrden`; volver a una vista ya
// usada (una toma repetida) cuesta solo `penalRetorno`.
export function etiquetarSecuencia(unario, frontera, { lambda, costoCambio, penalSalto, penalOrden, penalRetorno, penalFueraDeOrden = 10 }, orden = null) {
  const n = unario.length;
  if (!n) return [];
  const S = ESTADOS.length, M = 1 << S;
  const { conocido, inicio } = pasosConocidos(orden);
  const penal = orden == null ? penalOrden : penalFueraDeOrden;
  const idx = (s, m) => s * M + m;
  let D = new Float64Array(S * M).fill(Infinity);
  const atras = [];
  for (let s = 0; s < S; s++) {
    D[idx(s, 1 << s)] = unario[0][s] + (inicio[s] ? 0 : penal);
  }
  for (let i = 1; i < n; i++) {
    const N = new Float64Array(S * M).fill(Infinity);
    const P = new Int32Array(S * M).fill(-1);
    const corte = costoCambio - lambda * frontera[i];
    for (let s = 0; s < S; s++) {
      for (let m = 0; m < M; m++) {
        const d = D[idx(s, m)];
        if (d === Infinity) continue;
        // Seguir en la misma vista.
        if (d + unario[i][s] < N[idx(s, m)]) { N[idx(s, m)] = d + unario[i][s]; P[idx(s, m)] = idx(s, m); }
        // Cambiar de vista.
        for (let t = 0; t < S; t++) {
          if (t === s) continue;
          const vuelta = m & (1 << t);
          const fuera = conocido[s][t] ? 0 : orden != null && vuelta ? 0 : penal;
          const c = d + corte + fuera + (vuelta ? penalRetorno : 0) + unario[i][t];
          const j = idx(t, m | (1 << t));
          if (c < N[j]) { N[j] = c; P[j] = idx(s, m); }
        }
      }
    }
    atras.push(P);
    D = N;
  }
  let mejor = Infinity, fin = -1;
  for (let j = 0; j < S * M; j++) {
    if (D[j] === Infinity) continue;
    const m = j % M;
    let faltan = 0;
    for (let s = 0; s < S; s++) if (!(m & (1 << s))) faltan++;
    const c = D[j] + penalSalto * faltan;
    if (c < mejor) { mejor = c; fin = j; }
  }
  const out = new Array(n);
  let j = fin;
  for (let i = n - 1; i >= 0; i--) {
    out[i] = Math.floor(j / M);
    if (i > 0) j = atras[i - 1][j];
  }
  return out;
}

// Asigna el subtipo, el giro y el espejo a las intraorales (en orden de captura).
// `items`: [{ analisis, fecha }]. Devuelve [{ tipo, confianza, giro }].
// `orden`: índice del orden conocido que sigue la sesión, o null (sin orden preferido).
export function subtiposIntraorales(items, C = CONSTANTES, orden = null) {
  if (!items.length) return [];
  const k = C.segmentacion;
  const giros = items.map((x) => giroDeFoto(x.analisis, C));
  const rel = relativosSesion(items.map((x, i) => ({ analisis: x.analisis, giro: giros[i] })));
  const probs = items.map((x, i) => probVista(x.analisis, giros[i], C, k.temperatura ?? C.vistas?.temperatura ?? 1, rel[i]));
  // Mezcla con una distribución uniforme: ninguna foto sola puede imponerse a la secuencia.
  const u = k.mezclaUniforme ?? 0;
  // Laterales: la lateral 1 tiene los incisivos a la DERECHA en la foto final (miran al centro de
  // la diapositiva, donde va la frontal); la lateral 2, a la izquierda.
  const beta = k.betaLado ?? 10;
  const pEstado = probs.map((p, i) => {
    const a = items[i].analisis;
    const lado = ladoIncisivosFinal(a, giros[i], espejoDe(a, giros[i], C));
    const q1 = 1 / (1 + Math.exp(-beta * lado));
    return [p[0], p[1] * q1, p[1] * (1 - q1), p[2], p[3]];
  });
  const unario = pEstado.map((p) => p.map((q) => -k.alfa * Math.log(Math.max((1 - u) * q + u / p.length, 1e-6))));
  const frontera = puntajesFrontera(items.map((x) => ({ firma: x.analisis.firma, fecha: x.fecha })), C);
  const estados = etiquetarSecuencia(unario, frontera, k, orden);
  return estados.map((s, i) => ({
    tipo: ESTADOS[s],
    confianza: Math.round(probs[i][VISTA_DE_ESTADO[s]] * 100) / 100,
    giro: giros[i],
  }));
}

// Giro y espejo definitivos de cada foto de la sesión según su tipo ACTUAL: las intraorales
// consecutivas del mismo tipo y casi iguales comparten el giro (se promedian sus evidencias). Deja en el análisis
// `giro` (k) y `espejo` (true/false/null), y en la foto `volteoAuto`. Se llama de nuevo cada vez
// que el usuario cambia tipos.
export function orientarSesion(fotos, C = CONSTANTES) {
  // Solo comparten el giro las repeticiones casi iguales (misma toma): si una foto vecina es otra
  // toma mal clasificada, no arrastra a las demás.
  const maxDist = C.orientacion?.distanciaMisma ?? 0.16;
  let i = 0;
  while (i < fotos.length) {
    let j = i + 1;
    const intra = TIPOS[fotos[i].tipo]?.grupo === 'intraoral';
    while (j < fotos.length && fotos[j].tipo === fotos[i].tipo
      && distanciaFirmas(fotos[j - 1].analisis?.firma, fotos[j].analisis?.firma) <= maxDist) j++;
    const tramo = fotos.slice(i, j).filter((f) => f.analisis && !f.analisis.error);
    const kComun = intra ? giroComun(tramo.map((f) => f.analisis), C) : 0;
    for (const f of tramo) {
      if (f.analisis.dientes) {
        f.analisis.giro = kComun;
        f.analisis.espejo = espejoDe(f.analisis, intra ? kComun : giroDeFoto(f.analisis, C), C);
      }
    }
    i = j;
  }
  for (const f of fotos) f.volteoAuto = volteoAutoDe(f);
  return fotos;
}

// ---------------------------------------------------------------------------------------------
// Sesión

// Orden de captura que muestra la sesión (hábito de trabajo): con la cámara Sony el doctor hace
// primero los retratos y después las intraorales (orden 0: frontal primero); con el celular, las
// intraorales primero y los retratos al final (orden 1: oclusales primero). `tipos`: tipo
// individual de cada foto en orden de captura ('intraoral', tipos de retrato u 'otra'). Devuelve
// 0, 1 o null si no se puede saber (sin retratos o mezclados).
export function ordenDeSesion(tipos) {
  const esRetrato = (t) => TIPOS[t]?.grupo === 'retrato';
  let antes = 0, despues = 0, retratos = 0;
  for (let i = 0; i < tipos.length; i++) {
    if (tipos[i] !== 'intraoral') { if (esRetrato(tipos[i])) retratos++; continue; }
    // Para cada intraoral, cuántos retratos van antes y cuántos después.
    for (let j = 0; j < tipos.length; j++) {
      if (!esRetrato(tipos[j])) continue;
      if (j < i) antes++; else despues++;
    }
  }
  const total = antes + despues;
  if (!retratos || !total) return null;
  if (antes / total >= 0.8) return 0;
  if (despues / total >= 0.8) return 1;
  return null;
}

// Clasifica las fotos (ya ordenadas por captura). Agrega a cada foto `tipoAuto`, `confianzaTipo`,
// `volteoAuto` y `grupo`, y deja `tipo = tipoAuto` salvo que ya tuviera un tipo fijado
// (`tipoFijo`). En el análisis deja `giro` (k de 90°) y `espejo` (ver orientarSesion).
export function clasificarSesion(fotos, C = CONSTANTES) {
  const ind = fotos.map((f) => (!f.analisis || f.analisis.error ? { tipo: 'otra', confianza: 0 } : tipoIndividual(f.analisis, C)));
  const io = [];
  fotos.forEach((f, i) => { if (ind[i].tipo === 'intraoral') io.push(i); });
  const orden = ordenDeSesion(ind.map((x) => x.tipo));
  const sub = subtiposIntraorales(io.map((i) => ({ analisis: fotos[i].analisis, fecha: fotos[i].fecha })), C, orden);
  io.forEach((i, j) => { ind[i] = sub[j]; });
  fotos.forEach((f, i) => {
    f.tipoAuto = ind[i].tipo;
    f.confianzaTipo = ind[i].confianza;
    f.tipo = f.tipoFijo || f.tipoAuto;
  });
  orientarSesion(fotos, C);
  agrupar(fotos, C);
  return fotos;
}

// Grupos de tomas repetidas: fotos consecutivas del mismo tipo; se corta el grupo si pasó mucho
// tiempo y además la foto cambió bastante.
export function agrupar(fotos, C = CONSTANTES) {
  const k = C.grupos;
  let n = 0;
  fotos.forEach((f, i) => {
    const p = fotos[i - 1];
    let nuevo = !p || p.tipo !== f.tipo;
    if (!nuevo && p.fecha != null && f.fecha != null) {
      const dt = (f.fecha - p.fecha) / 1000;
      if (dt > k.maxSegundos && distanciaFirmas(p.analisis?.firma, f.analisis?.firma) > k.maxDistancia) nuevo = true;
    }
    if (nuevo) n++;
    f.grupo = `g${n}`;
  });
  return fotos;
}

// La más nítida de una lista de fotos.
export function masNitida(fotos) {
  let mejor = null;
  for (const f of fotos) if (!mejor || (f.nitidez ?? 0) > (mejor.nitidez ?? 0)) mejor = f;
  return mejor;
}

// Espacios de salida con sus candidatas (en orden de captura) y la propuesta. Solo se incluyen los
// espacios que tienen candidatas (docs/CONTRATO.md). En "perfil" se propone el perfil que mira a la
// izquierda si hay alguno (regla de la especificación), si no, el que mira a la derecha.
export function armarEspacios(fotos, elegidasPrevias = {}) {
  const espacios = [];
  for (const e of ESPACIOS) {
    const cand = fotos.filter((f) => e.tipos.includes(f.tipo));
    if (!cand.length) continue;
    let elegida = null;
    const previa = elegidasPrevias[e.id];
    if (previa && cand.some((f) => f.id === previa)) elegida = previa;
    else {
      for (const t of e.tipos) {
        const m = masNitida(cand.filter((f) => f.tipo === t));
        if (m) { elegida = m.id; break; }
      }
    }
    espacios.push({ id: e.id, candidatas: cand.map((f) => f.id), elegida });
  }
  return espacios;
}

// Tipo a partir del nombre de una carpeta (modo manual). Acepta el id del tipo o su etiqueta,
// sin importar mayúsculas, tildes, guiones ni espacios. Devuelve null si no coincide.
export function tipoDeCarpeta(ruta) {
  if (!ruta) return null;
  const partes = ruta.split(/[\\/]/).slice(0, -1).reverse();
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const alias = {};
  for (const [id, t] of Object.entries(TIPOS)) { alias[norm(id)] = id; alias[norm(t.etiqueta)] = id; }
  Object.assign(alias, {
    reposo: 'frente_reposo', 'frente reposo': 'frente_reposo', sonrisa: 'frente_sonrisa', 'frente sonrisa': 'frente_sonrisa',
    perfil: 'perfil_izq', 'perfil izquierdo': 'perfil_izq', 'perfil derecho': 'perfil_der', 'tres cuartos': 'tres_cuartos', '3 4': 'tres_cuartos',
    frontal: 'io_frontal', 'lateral 1': 'io_lateral_1', 'lateral 2': 'io_lateral_2', 'oclusal inferior': 'io_oclusal_inf',
    'oclusal superior': 'io_oclusal_sup', identificacion: 'identificacion',
  });
  for (const p of partes) { const t = alias[norm(p)]; if (t) return t; }
  return null;
}
