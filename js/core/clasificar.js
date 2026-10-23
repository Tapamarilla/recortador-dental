// Clasificación de la sesión: tipo de cada foto, subtipo intraoral por segmentación de la secuencia,
// grupos de tomas repetidas y elección de la más nítida. Funciones puras (se prueban con node).
import { ESPACIOS, ORDEN_INTRAORAL, TIPOS } from './tipos.js';
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
// Vista intraoral (modelo gaussiano simple con medias y desvíos calibrados)

// Log-probabilidad (sin normalizar) de cada vista de ORDEN_INTRAORAL para los rasgos `v`.
export function logVerosimilitudVista(v, C = CONSTANTES) {
  const M = C.vistas;
  return ORDEN_INTRAORAL.map((t) => {
    const cl = M.clases[t];
    if (!cl) return 0;
    let ll = 0;
    M.rasgos.forEach((r, i) => {
      const x = v?.[r] ?? cl.media[i];
      const z = (x - cl.media[i]) / cl.desvio[i];
      ll += -0.5 * z * z - Math.log(cl.desvio[i]);
    });
    return ll;
  });
}

// Probabilidades normalizadas (softmax con temperatura) de cada vista. Una temperatura mayor que 1
// suaviza el modelo, que por suponer rasgos independientes tiende a exagerar su seguridad.
export function probVista(v, C = CONSTANTES, temperatura = C.vistas.temperatura) {
  const ll = logVerosimilitudVista(v, C).map((x) => x / temperatura);
  const m = Math.max(...ll);
  const e = ll.map((x) => Math.exp(x - m));
  const s = e.reduce((p, q) => p + q, 0);
  return e.map((x) => x / s);
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

// Divide una secuencia en tramos contiguos y ordenados, uno por cada etiqueta 0..K−1, por
// programación dinámica. Puede saltear etiquetas (con penalización), así una vista que falta no
// desordena las demás.
//   unario[i][k]: costo de que la foto i tenga la etiqueta k.
//   frontera[i]: puntaje de cortar entre i−1 e i (más alto = más probable).
// Costo total = Σ unario + Σ_cortes (costoCambio − lambda·frontera) + penalSalto·(etiquetas sin fotos).
// Devuelve la etiqueta de cada foto.
export function segmentarSecuencia(unario, frontera, { lambda, costoCambio, penalSalto }) {
  const n = unario.length;
  if (!n) return [];
  const K = unario[0].length;
  const D = Array.from({ length: n }, () => new Float64Array(K).fill(Infinity));
  const P = Array.from({ length: n }, () => new Int32Array(K).fill(-1));
  for (let k = 0; k < K; k++) D[0][k] = unario[0][k] + penalSalto * k;
  for (let i = 1; i < n; i++) {
    const corte = costoCambio - lambda * frontera[i];
    for (let k = 0; k < K; k++) {
      let mejor = D[i - 1][k], de = k;
      for (let j = 0; j < k; j++) {
        const c = D[i - 1][j] + corte + penalSalto * (k - j - 1);
        if (c < mejor) { mejor = c; de = j; }
      }
      D[i][k] = mejor + unario[i][k];
      P[i][k] = de;
    }
  }
  let k = 0, mejor = Infinity;
  for (let j = 0; j < K; j++) {
    const c = D[n - 1][j] + penalSalto * (K - 1 - j);
    if (c < mejor) { mejor = c; k = j; }
  }
  const etiquetas = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    etiquetas[i] = k;
    if (i > 0) k = P[i][k];
  }
  return etiquetas;
}

// Asigna el subtipo a las intraorales (en orden de captura). `items`: [{ analisis, fecha }].
// Devuelve [{ tipo, confianza }].
export function subtiposIntraorales(items, C = CONSTANTES) {
  if (!items.length) return [];
  const k = C.segmentacion;
  const probs = items.map((x) => probVista(x.analisis.dientes?.vista, C, k.temperatura ?? C.vistas.temperatura));
  // Mezcla con una distribución uniforme: ninguna foto sola puede imponerse al orden de la sesión.
  const u = k.mezclaUniforme ?? 0;
  const unario = probs.map((p) => p.map((q) => -k.alfa * Math.log(Math.max((1 - u) * q + u / p.length, 1e-6))));
  const frontera = puntajesFrontera(items.map((x) => ({ firma: x.analisis.firma, fecha: x.fecha })), C);
  const etiquetas = segmentarSecuencia(unario, frontera, k);
  return etiquetas.map((e, i) => ({ tipo: ORDEN_INTRAORAL[e], confianza: Math.round(probs[i][e] * 100) / 100 }));
}

// ---------------------------------------------------------------------------------------------
// Sesión

// Clasifica las fotos (ya ordenadas por captura). Agrega a cada foto `tipoAuto`, `confianzaTipo` y
// `grupo`, y deja `tipo = tipoAuto` salvo que ya tuviera un tipo fijado (`tipoFijo`).
export function clasificarSesion(fotos, C = CONSTANTES) {
  const ind = fotos.map((f) => (!f.analisis || f.analisis.error ? { tipo: 'otra', confianza: 0 } : tipoIndividual(f.analisis, C)));
  const io = [];
  fotos.forEach((f, i) => { if (ind[i].tipo === 'intraoral') io.push(i); });
  const sub = subtiposIntraorales(io.map((i) => ({ analisis: fotos[i].analisis, fecha: fotos[i].fecha })), C);
  io.forEach((i, j) => { ind[i] = sub[j]; });
  fotos.forEach((f, i) => {
    f.tipoAuto = ind[i].tipo;
    f.confianzaTipo = ind[i].confianza;
    f.tipo = f.tipoFijo || f.tipoAuto;
  });
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
