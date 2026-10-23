// Recorte automático por tipo. Funciones puras: reciben el `analisis` de una foto (coordenadas
// normalizadas) y devuelven un Recorte en píxeles del original orientado a resolución completa
// (convención de docs/CONTRATO.md). Las constantes salen de tools/calibrar.mjs (constantes.js).
//
// Las funciones `anclas*` miden la foto (puntos de referencia en un sistema de ejes alineado con el
// marco) y las usa también la calibración, para que la app y la calibración midan igual.
import { TIPOS, proporcionDe } from './tipos.js';
import { aCoordenadasMarco, desdeCoordenadasMarco, encajarEnImagen } from './geometria.js';
import { CONSTANTES } from './constantes.js';

const LIMITE_NIVEL = 10; // grados; más que esto no es un error de nivel sino una foto girada

export function familiaDe(tipo) {
  if (tipo === 'frente_reposo' || tipo === 'frente_sonrisa') return 'frente';
  if (tipo === 'tres_cuartos') return 'tres_cuartos';
  if (tipo === 'perfil_izq' || tipo === 'perfil_der') return 'perfil';
  if (TIPOS[tipo]?.grupo === 'intraoral') return 'intraoral';
  return null;
}

// ---------------------------------------------------------------------------------------------
// Retratos de frente y de tres cuartos (landmarks de la cara)

// Origen = punto medio de los ojos; ejes girados `angulo`. Devuelve medidas en píxeles:
// vMenton (mentón), vArriba (borde de arriba del pelo, si la segmentación lo encontró), uNariz.
export function anclasCara(a, nivelar = true) {
  const c = a.cara;
  if (!c) return null;
  const W = a.ancho, H = a.alto;
  const angulo = nivelar ? Math.max(-LIMITE_NIVEL, Math.min(LIMITE_NIVEL, c.anguloOjos)) : 0;
  const ox = (c.ojoDer.x + c.ojoIzq.x) / 2 * W, oy = (c.ojoDer.y + c.ojoIzq.y) / 2 * H;
  const base = { cx: ox, cy: oy, ancho: 0, alto: 0, angulo };
  const loc = (x, y) => aCoordenadasMarco(base, x * W, y * H);
  const [, vMenton] = loc(c.menton.x, c.menton.y);
  const [uNariz] = loc(c.nariz.x, c.nariz.y);
  let vArriba = null;
  const cab = a.cabeza;
  if (cab && cab.arriba < Math.min(c.ojoDer.y, c.ojoIzq.y)) {
    const [, v] = loc(ox / W, cab.arriba);
    // Si la "cabeza" llega al borde de arriba de la foto, el pelo está cortado y no sirve.
    if (cab.arriba > 0.005 && v < 0) vArriba = v;
  }
  // +1 si la nariz queda a la izquierda de los ojos (mira a la izquierda), −1 si a la derecha.
  const signoNariz = uNariz <= 0 ? 1 : -1;
  return { angulo, base, vMenton, vArriba, uNariz, signoNariz };
}

function recorteCara(a, tipo, C) {
  const fam = familiaDe(tipo);
  const k = C.retrato[fam];
  const an = anclasCara(a, k.nivelar);
  if (!an || an.vMenton <= 0) return null;
  let alto, confianza;
  if (an.vArriba != null) {
    alto = (an.vMenton - an.vArriba) * k.altoPorMentonArriba;
    confianza = 0.9;
  } else {
    alto = an.vMenton * k.altoPorOjosMenton;
    confianza = 0.75;
  }
  const ancho = alto * proporcionDe(tipo);
  const v = an.vMenton - alto * (k.mentonV - 0.5);
  // Tres cuartos: el marco se corre hacia la nuca; `uCentroDesdeNariz` está medido con la cara
  // mirando a la izquierda (nariz a la izquierda de los ojos) y se espeja si mira a la derecha.
  const u = fam === 'tres_cuartos' ? an.uNariz + an.signoNariz * alto * k.uCentroDesdeNariz : alto * k.uCentroDesdeOjos;
  const [cx, cy] = desdeCoordenadasMarco(an.base, u, v);
  return { recorte: { cx, cy, ancho, alto, angulo: an.angulo }, confianza, fuente: an.vArriba != null ? 'cara+pelo' : 'cara' };
}

// ---------------------------------------------------------------------------------------------
// Perfiles (segmentación: cabeza = pelo + piel de la cara)

export function anclasPerfil(a, tipo) {
  const cab = a.cabeza;
  if (!cab) return null;
  const W = a.ancho, H = a.alto;
  // Si la clasificación dice un lado y la segmentación el otro, manda el tipo (lo eligió el usuario).
  const mira = tipo === 'perfil_der' ? 'der' : tipo === 'perfil_izq' ? 'izq' : cab.mira;
  return {
    mira, signo: mira === 'izq' ? 1 : -1,
    narizX: cab.nariz.x * W, arriba: cab.arriba * H, menton: cab.menton * H,
  };
}

function recortePerfil(a, tipo, C) {
  const k = C.retrato.perfil;
  const an = anclasPerfil(a, tipo);
  if (!an || an.menton - an.arriba < 0.1 * a.alto) return null;
  const alto = (an.menton - an.arriba) * k.altoPorMentonArriba;
  const ancho = alto * proporcionDe(tipo);
  const cy = an.menton - alto * (k.mentonV - 0.5);
  // Borde delantero del marco (del lado de la nariz) a `narizU` del ancho antes de la nariz.
  const borde = an.narizX - an.signo * k.narizU * ancho;
  const cx = borde + an.signo * ancho / 2;
  const confianza = a.cabeza.mira === an.mira ? 0.8 : 0.5;
  return { recorte: { cx, cy, ancho, alto, angulo: 0 }, confianza, fuente: 'segmentacion' };
}

// ---------------------------------------------------------------------------------------------
// Intraorales (caja de dientes/encías)

// Caja de la fuente indicada ('boca', 'dientes' o 'arco'), normalizada, o null.
export function cajaIntraoral(a, fuente) {
  return a.dientes?.[fuente] || null;
}

// Tamaño de la caja expresado como ancho de un marco de proporción `prop` (fracción del ancho de
// la foto): 'ancho' usa solo el ancho de la caja; 'max', el mayor entre el ancho y el alto pasado a
// ancho; 'media', el promedio de los dos.
export function medidaCaja(a, caja, medida = 'ancho', prop = 4 / 3) {
  const w = caja.x1 - caja.x0;
  const hw = (caja.y1 - caja.y0) * (a.alto / a.ancho) * prop;
  if (medida === 'max') return Math.max(w, hw);
  if (medida === 'media') return (w + hw) / 2;
  return w;
}

function recorteIntraoral(a, tipo, C) {
  const k = C.intraoral[tipo];
  const W = a.ancho, H = a.alto;
  const prop = proporcionDe(tipo);
  let cx = k.previo.cx, cy = k.previo.cy, w = k.previo.ancho, confianza = 0.3, fuente = 'previo';
  const caja = k.fuente !== 'previo' ? cajaIntraoral(a, k.fuente) : null;
  if (caja) {
    const dcx = (caja.x0 + caja.x1) / 2 + k.dx, dcy = (caja.y0 + caja.y1) / 2 + k.dy;
    const dw = medidaCaja(a, caja, k.medida, prop) * k.anchoPorCaja;
    cx = k.peso * dcx + (1 - k.peso) * cx;
    cy = k.peso * dcy + (1 - k.peso) * cy;
    w = k.pesoTam * dw + (1 - k.pesoTam) * w;
    confianza = 0.6;
    fuente = k.fuente;
  }
  const ancho = w * W;
  return { recorte: { cx: cx * W, cy: cy * H, ancho, alto: ancho / prop, angulo: 0 }, confianza, fuente };
}

// ---------------------------------------------------------------------------------------------

// Respaldo sin detección: marco centrado del tamaño típico del tipo (sección 6 de la
// especificación: usar las fracciones solo cuando no hay detección).
function recorteRespaldo(a, tipo, C) {
  const prop = proporcionDe(tipo);
  const W = a.ancho, H = a.alto;
  const fam = familiaDe(tipo);
  let ancho;
  if (fam === 'intraoral') ancho = C.respaldo.anchoIntraoral * W;
  else ancho = C.respaldo.altoRetrato * H * prop;
  return { recorte: { cx: W / 2, cy: H / 2, ancho, alto: ancho / prop, angulo: 0 }, confianza: 0.1, fuente: 'respaldo' };
}

// Recorte automático de la foto `a` (su análisis) para el tipo `tipo`.
// Devuelve { recorte, angulo, confianza, fuente } o null si el tipo no se recorta.
export function recortePara(a, tipo, C = CONSTANTES) {
  if (!proporcionDe(tipo)) return null;
  const fam = familiaDe(tipo);
  let r = null;
  if (fam === 'frente' || fam === 'tres_cuartos') r = recorteCara(a, tipo, C);
  else if (fam === 'perfil') r = recortePerfil(a, tipo, C);
  else if (fam === 'intraoral') r = recorteIntraoral(a, tipo, C);
  if (!r) r = recorteRespaldo(a, tipo, C);
  const prop = proporcionDe(tipo);
  const rec = encajarEnImagen({ ...r.recorte, alto: r.recorte.ancho / prop }, a.ancho, a.alto);
  // Si hubo que achicarlo mucho para que entre, la confianza baja.
  const achique = rec.ancho / r.recorte.ancho;
  return { recorte: rec, angulo: rec.angulo, confianza: Math.round(r.confianza * Math.min(1, achique + 0.1) * 100) / 100, fuente: r.fuente };
}
