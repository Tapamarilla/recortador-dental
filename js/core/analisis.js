// Rasgos por foto. `analizarArchivo` corre en el navegador (hilo principal o Worker): decodifica,
// reduce, ejecuta MediaPipe y calcula rasgos. Las funciones de rasgos son puras (sin DOM) para
// poder probarlas y calibrarlas con node.
import { rasgosDientes, componentes } from './dientes.js';

export const VERSION_ANALISIS = 1;
export const LADO_TRABAJO = 256; // copia pequeña para color, firma y máscara de dientes

const r4 = (v) => Math.round(v * 1e4) / 1e4;

// ---------------------------------------------------------------------------------------------
// Navegador

// Analiza un archivo. Devuelve { analisis, miniatura (Blob), ancho, alto, orientacionExif, fecha,
// nitidez }. Con `crudo: true` agrega los arreglos de trabajo (para calibración).
export async function analizarArchivo(archivo, { crudo = false } = {}) {
  const [{ leerExif }, img, det] = await Promise.all([
    import('./exif.js'), import('./imagen.js'), import('./deteccion.js'),
  ]);
  const ms = {};
  let t = performance.now();
  const { orientacion, fecha } = await leerExif(archivo);
  const { bitmap, ancho, alto } = await img.decodificarReducida(archivo, orientacion);
  ms.decodificar = performance.now() - t;

  t = performance.now();
  const miniatura = await img.miniaturaBlob(bitmap);
  const pix = img.pixelesDe(bitmap);
  const gris = img.grises(pix);
  const trabajo = img.pixelesDe(bitmap, LADO_TRABAJO);
  ms.preparar = performance.now() - t;

  t = performance.now();
  const cara = await det.detectarCara(bitmap);
  ms.cara = performance.now() - t;
  t = performance.now();
  const seg = await det.segmentar(bitmap);
  ms.segmentar = performance.now() - t;
  let manos = [];
  if (cara) {
    t = performance.now();
    manos = await det.detectarManos(bitmap);
    ms.manos = performance.now() - t;
  }
  bitmap.close();

  t = performance.now();
  const mascara = seg ? reducirMascara(seg, trabajo.width, trabajo.height) : null;
  const analisis = calcularRasgos({
    anchoRed: pix.width, altoRed: pix.height, ancho, alto,
    trabajo, mascara, cara, manos,
  });
  analisis.nitidezGlobal = img.varianzaLaplaciano(gris, pix.width, pix.height);
  const zona = zonaNitidez(analisis);
  const nitidez = img.varianzaLaplaciano(gris, pix.width, pix.height, {
    x0: zona.x0 * pix.width, y0: zona.y0 * pix.height, x1: zona.x1 * pix.width, y1: zona.y1 * pix.height,
  });
  ms.rasgos = performance.now() - t;
  analisis.ms = Object.fromEntries(Object.entries(ms).map(([k, v]) => [k, Math.round(v)]));
  analisis.delegado = det.delegadoActual();
  analisis.hilo = typeof document === 'undefined' ? 'worker' : 'principal';
  if (crudo) {
    analisis.crudo = {
      trabajo: { ancho: trabajo.width, alto: trabajo.height, datos: trabajo.data },
      mascara: mascara ? { ancho: trabajo.width, alto: trabajo.height, datos: mascara } : null,
      puntos: cara ? cara.puntos.map((p) => [r4(p.x), r4(p.y), r4(p.z)]) : null,
      blend: cara ? cara.blend : null,
      matriz: cara ? cara.matriz : null,
      manos,
    };
  }
  return { analisis, miniatura, ancho, alto, orientacionExif: orientacion, fecha, nitidez };
}

// Máscara de clases reducida al tamaño de trabajo (vecino más cercano).
function reducirMascara(seg, w, h) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(seg.alto - 1, Math.floor((y + 0.5) * seg.alto / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(seg.ancho - 1, Math.floor((x + 0.5) * seg.ancho / w));
      out[y * w + x] = seg.clases[sy * seg.ancho + sx];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Rasgos (puros)

// Arma el objeto `analisis` a partir de los datos de trabajo. Todas las coordenadas quedan
// normalizadas (0..1) respecto de la imagen orientada.
export function calcularRasgos({ anchoRed, altoRed, ancho, alto, trabajo, mascara, cara, manos }) {
  return {
    version: VERSION_ANALISIS,
    ancho, alto, anchoRed, altoRed,
    escala: anchoRed / ancho,
    cara: cara ? rasgosCara(cara, ancho / alto) : null,
    manos: (manos || []).map(cajaMano),
    segmento: mascara ? rasgosSegmento(mascara, trabajo.width, trabajo.height) : null,
    cabeza: mascara ? rasgosCabeza(mascara, trabajo.width, trabajo.height) : null,
    color: rasgosColor(trabajo),
    firma: firmaVisual(trabajo),
    dientes: rasgosDientes(trabajo),
  };
}

function cajaMano(m) {
  const xs = m.puntos.map((p) => p.x), ys = m.puntos.map((p) => p.y);
  return { x0: r4(Math.min(...xs)), y0: r4(Math.min(...ys)), x1: r4(Math.max(...xs)), y1: r4(Math.max(...ys)), confianza: r4(m.confianza) };
}

// Índices de la malla de MediaPipe que usan la clasificación y el recorte.
export const PUNTOS = {
  ojoDerExt: 33, ojoDerInt: 133, ojoIzqInt: 362, ojoIzqExt: 263, irisDer: 468, irisIzq: 473,
  nariz: 1, menton: 152, frente: 10, mejillaDer: 234, mejillaIzq: 454, labioSup: 13, labioInf: 14,
  bocaDer: 61, bocaIzq: 291,
};

// Rasgos de la cara. `aspecto` = ancho/alto de la imagen, para medir ángulos en píxeles reales.
export function rasgosCara({ puntos, blend, matriz }, aspecto) {
  const P = (i) => puntos[i];
  const xs = puntos.map((p) => p.x), ys = puntos.map((p) => p.y);
  const medio = (a, b) => ({ x: (P(a).x + P(b).x) / 2, y: (P(a).y + P(b).y) / 2 });
  // "Der"/"Izq" son los del paciente: su ojo derecho queda a la izquierda de la imagen.
  // Centro de cada ojo = punto medio de sus comisuras (más estable que el iris para nivelar).
  const ojoDer = medio(PUNTOS.ojoDerExt, PUNTOS.ojoDerInt);
  const ojoIzq = medio(PUNTOS.ojoIzqExt, PUNTOS.ojoIzqInt);
  const angOjos = Math.atan2(ojoIzq.y - ojoDer.y, (ojoIzq.x - ojoDer.x) * aspecto) * 180 / Math.PI;
  let yaw = null, pitch = null, roll = null;
  if (matriz) {
    // Matriz 4×4 en orden de columnas: R = [[m0 m4 m8], [m1 m5 m9], [m2 m6 m10]].
    const m = matriz;
    yaw = Math.atan2(-m[2], Math.hypot(m[0], m[1])) * 180 / Math.PI;
    pitch = Math.atan2(m[6], m[10]) * 180 / Math.PI;
    roll = Math.atan2(m[1], m[0]) * 180 / Math.PI;
  }
  const pt = (p) => ({ x: r4(p.x), y: r4(p.y) });
  return {
    caja: { x0: r4(Math.min(...xs)), y0: r4(Math.min(...ys)), x1: r4(Math.max(...xs)), y1: r4(Math.max(...ys)) },
    ojoDer: pt(ojoDer), ojoIzq: pt(ojoIzq),
    nariz: pt(P(PUNTOS.nariz)), menton: pt(P(PUNTOS.menton)), frente: pt(P(PUNTOS.frente)),
    mejillaDer: pt(P(PUNTOS.mejillaDer)), mejillaIzq: pt(P(PUNTOS.mejillaIzq)),
    bocaDer: pt(P(PUNTOS.bocaDer)), bocaIzq: pt(P(PUNTOS.bocaIzq)),
    labioSup: pt(P(PUNTOS.labioSup)), labioInf: pt(P(PUNTOS.labioInf)),
    anguloOjos: r4(angOjos),
    yaw: yaw == null ? null : r4(yaw), pitch: pitch == null ? null : r4(pitch), roll: roll == null ? null : r4(roll),
    sonrisa: r4(((blend.mouthSmileLeft || 0) + (blend.mouthSmileRight || 0)) / 2),
  };
}

// Rasgos de la segmentación multiclase (0 fondo, 1 pelo, 2 piel del cuerpo, 3 piel de la cara,
// 4 ropa, 5 otros): fracción, caja y centroide de cada clase.
export function rasgosSegmento(mascara, w, h) {
  const n = 6;
  const cuenta = new Array(n).fill(0), sx = new Array(n).fill(0), sy = new Array(n).fill(0);
  const x0 = new Array(n).fill(w), y0 = new Array(n).fill(h), x1 = new Array(n).fill(-1), y1 = new Array(n).fill(-1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = mascara[y * w + x];
      cuenta[c]++; sx[c] += x; sy[c] += y;
      if (x < x0[c]) x0[c] = x;
      if (x > x1[c]) x1[c] = x;
      if (y < y0[c]) y0[c] = y;
      if (y > y1[c]) y1[c] = y;
    }
  }
  const clases = [];
  for (let c = 0; c < n; c++) {
    clases.push(cuenta[c]
      ? { frac: r4(cuenta[c] / (w * h)), cx: r4((sx[c] / cuenta[c] + 0.5) / w), cy: r4((sy[c] / cuenta[c] + 0.5) / h), x0: r4(x0[c] / w), y0: r4(y0[c] / h), x1: r4((x1[c] + 1) / w), y1: r4((y1[c] + 1) / h) }
      : { frac: 0 });
  }
  return { clases };
}

// Cabeza según la segmentación: la mancha conexa más grande de pelo + piel de la cara. Sirve para
// los perfiles (que el detector de caras no encuentra) y para el borde de arriba de los retratos.
// Devuelve coordenadas normalizadas: arriba (pelo o frente), menton (abajo de la piel de la cara),
// nariz (punto extremo de la piel de la cara hacia donde mira), mira ('izq' | 'der') y la
// proporción de piel en cada extremo, que indica cuán claro es el lado.
export function rasgosCabeza(mascara, w, h) {
  const cab = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) if (mascara[k] === 1 || mascara[k] === 3) cab[k] = 1;
  const { etiqueta, comps } = componentes(cab, w, h, 1);
  let id = 0;
  for (let i = 1; i < comps.length; i++) if (!id || comps[i].n > comps[id].n) id = i;
  if (!id || comps[id].n < 0.01 * w * h) return null;
  const c = comps[id];
  let piel = 0, pelo = 0, py1 = -1, sxPiel = 0, sxPelo = 0;
  let px0 = w, px1 = -1, yx0 = 0, yx1 = 0;
  for (let y = c.y0; y <= c.y1; y++) {
    for (let x = c.x0; x <= c.x1; x++) {
      const k = y * w + x;
      if (etiqueta[k] !== id) continue;
      if (mascara[k] === 3) {
        piel++; sxPiel += x;
        if (y > py1) py1 = y;
        if (x < px0) { px0 = x; yx0 = y; }
        if (x > px1) { px1 = x; yx1 = y; }
      } else { pelo++; sxPelo += x; }
    }
  }
  if (!piel) return null;
  // Piel de la cara en la franja del 15 % de cada lado de la cabeza.
  const franja = Math.max(1, Math.round((c.x1 - c.x0 + 1) * 0.15));
  const lado = (xa, xb) => {
    let p = 0, t = 0;
    for (let y = c.y0; y <= c.y1; y++) {
      for (let x = xa; x <= xb; x++) {
        const k = y * w + x;
        if (etiqueta[k] !== id) continue;
        t++;
        if (mascara[k] === 3) p++;
      }
    }
    return t ? p / t : 0;
  };
  const pielIzq = lado(c.x0, c.x0 + franja - 1), pielDer = lado(c.x1 - franja + 1, c.x1);
  const mira = pielIzq >= pielDer ? 'izq' : 'der';
  return {
    x0: r4(c.x0 / w), x1: r4((c.x1 + 1) / w),
    arriba: r4(c.y0 / h), menton: r4((py1 + 1) / h),
    mira, pielIzq: r4(pielIzq), pielDer: r4(pielDer),
    nariz: mira === 'izq' ? { x: r4(px0 / w), y: r4((yx0 + 0.5) / h) } : { x: r4((px1 + 1) / w), y: r4((yx1 + 0.5) / h) },
    fracPiel: r4(piel / (w * h)), fracPelo: r4(pelo / (w * h)),
    // Centroide horizontal de la piel respecto del pelo (negativo = la cara está a la izquierda).
    desvioPiel: pelo ? r4((sxPiel / piel - sxPelo / pelo) / w) : 0,
  };
}

// Estadísticas de color sobre la copia de trabajo.
export function rasgosColor(img) {
  const { data, width: w, height: h } = img;
  let rosa = 0, claroNeutro = 0, oscuro = 0;
  const n = w * h;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const sat = max ? (max - min) / max : 0;
    if (max < 50) oscuro++;
    else if (sat < 0.12 && max > 150) claroNeutro++;
    if (r > 90 && r > g * 1.25 && r > b * 1.1 && sat > 0.2) rosa++;
  }
  return { rosa: r4(rosa / n), claroNeutro: r4(claroNeutro / n), oscuro: r4(oscuro / n) };
}

// Firma visual para comparar fotos: color medio en 16×12 celdas.
export const FIRMA_W = 16, FIRMA_H = 12;
export function firmaVisual(img) {
  const { data, width: w, height: h } = img;
  const cel = FIRMA_W * FIRMA_H;
  const suma = new Float64Array(cel * 3), cuenta = new Float64Array(cel);
  for (let y = 0; y < h; y++) {
    const cy = Math.min(FIRMA_H - 1, Math.floor(y * FIRMA_H / h));
    for (let x = 0; x < w; x++) {
      const cx = Math.min(FIRMA_W - 1, Math.floor(x * FIRMA_W / w));
      const k = cy * FIRMA_W + cx, i = (y * w + x) * 4;
      suma[k * 3] += data[i]; suma[k * 3 + 1] += data[i + 1]; suma[k * 3 + 2] += data[i + 2]; cuenta[k]++;
    }
  }
  const f = [];
  for (let k = 0; k < cel; k++) for (let c = 0; c < 3; c++) f.push(Math.round(suma[k * 3 + c] / Math.max(1, cuenta[k])));
  return f;
}

// Zona (normalizada) donde medir la nitidez: la cara si la hay; la cabeza si parece un retrato sin
// cara detectada (perfil); los dientes si no.
export function zonaNitidez(a) {
  if (a.cara) return a.cara.caja;
  if (a.cabeza && a.color.rosa < 0.3) {
    const k = a.cabeza;
    return { x0: k.x0, y0: k.arriba, x1: k.x1, y1: k.menton };
  }
  const d = a.dientes?.dientes || a.dientes?.boca;
  if (d) return d;
  return { x0: 0.2, y0: 0.2, x1: 0.8, y1: 0.8 };
}
