// Geometría del Recorte (ver docs/CONTRATO.md): esquinas, caja envolvente, encajar en la imagen,
// escalas e IoU de polígonos. Funciones puras, sin dependencias (se prueban con node --test).

const RAD = Math.PI / 180;

// Esquinas del marco en coordenadas del original, en el orden del resultado:
// arriba-izquierda, arriba-derecha, abajo-derecha, abajo-izquierda.
export function esquinasRecorte({ cx, cy, ancho, alto, angulo = 0 }) {
  const c = Math.cos(angulo * RAD), s = Math.sin(angulo * RAD);
  const w = ancho / 2, h = alto / 2;
  return [[-w, -h], [w, -h], [w, h], [-w, h]].map(([u, v]) => [cx + c * u - s * v, cy + s * u + c * v]);
}

// Caja alineada a los ejes que contiene el marco girado.
export function cajaEnvolvente(recorte) {
  const p = esquinasRecorte(recorte);
  const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

// Pasa un punto del original a coordenadas del marco (u, v), con origen en la esquina de arriba
// a la izquierda del marco. Inversa de la fórmula del contrato.
export function aCoordenadasMarco(recorte, x, y) {
  const c = Math.cos(recorte.angulo * RAD), s = Math.sin(recorte.angulo * RAD);
  const dx = x - recorte.cx, dy = y - recorte.cy;
  return [c * dx + s * dy + recorte.ancho / 2, -s * dx + c * dy + recorte.alto / 2];
}

// Pasa (u, v) del marco al original.
export function desdeCoordenadasMarco(recorte, u, v) {
  const c = Math.cos(recorte.angulo * RAD), s = Math.sin(recorte.angulo * RAD);
  const du = u - recorte.ancho / 2, dv = v - recorte.alto / 2;
  return [recorte.cx + c * du - s * dv, recorte.cy + s * du + c * dv];
}

// Multiplica todas las medidas por `s` (por ejemplo, de la copia reducida a resolución completa).
export function escalarRecorte(r, s) {
  return { cx: r.cx * s, cy: r.cy * s, ancho: r.ancho * s, alto: r.alto * s, angulo: r.angulo };
}

// Deja el marco dentro de la imagen (ancho × alto): primero lo mueve hacia adentro; si aun así no
// cabe, lo reduce desde su centro manteniendo la proporción y lo vuelve a mover.
export function encajarEnImagen(recorte, anchoImg, altoImg) {
  let r = { ...recorte, angulo: recorte.angulo || 0 };
  const c = Math.abs(Math.cos(r.angulo * RAD)), s = Math.abs(Math.sin(r.angulo * RAD));
  // Medio ancho y medio alto de la caja envolvente.
  const medioW = (r.ancho * c + r.alto * s) / 2, medioH = (r.ancho * s + r.alto * c) / 2;
  const f = Math.min(1, anchoImg / (2 * medioW), altoImg / (2 * medioH));
  if (f < 1) r = { ...r, ancho: r.ancho * f, alto: r.alto * f };
  const mw = medioW * f, mh = medioH * f;
  r.cx = Math.min(Math.max(r.cx, mw), anchoImg - mw);
  r.cy = Math.min(Math.max(r.cy, mh), altoImg - mh);
  return r;
}

// Área con signo (fórmula del cordón); positiva si los vértices van en sentido antihorario en
// coordenadas matemáticas.
export function areaPoligono(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

// Intersección de dos polígonos convexos (Sutherland–Hodgman). Devuelve los vértices.
export function interseccionConvexa(sujeto, recortador) {
  const orient = Math.sign(areaPoligono(recortador)) || 1;
  let salida = sujeto.slice();
  for (let i = 0; i < recortador.length && salida.length; i++) {
    const a = recortador[i], b = recortador[(i + 1) % recortador.length];
    const dentro = (p) => orient * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) >= 0;
    // Punto donde el lado p→q cruza la recta a→b: p + t·(q − p).
    const cruce = (p, q) => {
      const ex = b[0] - a[0], ey = b[1] - a[1], dx = q[0] - p[0], dy = q[1] - p[1];
      const t = (ex * (a[1] - p[1]) - ey * (a[0] - p[0])) / (ex * dy - ey * dx);
      return [p[0] + t * dx, p[1] + t * dy];
    };
    const entrada = salida;
    salida = [];
    for (let j = 0; j < entrada.length; j++) {
      const p = entrada[j], q = entrada[(j + 1) % entrada.length];
      const pd = dentro(p), qd = dentro(q);
      if (pd) salida.push(p);
      if (pd !== qd) salida.push(cruce(p, q));
    }
  }
  return salida;
}

// Intersección sobre unión de dos polígonos convexos.
export function iouPoligonos(a, b) {
  const ai = Math.abs(areaPoligono(a)), bi = Math.abs(areaPoligono(b));
  const inter = Math.abs(areaPoligono(interseccionConvexa(a, b)));
  const union = ai + bi - inter;
  return union > 0 ? inter / union : 0;
}

export function iouRecortes(r1, r2) {
  return iouPoligonos(esquinasRecorte(r1), esquinasRecorte(r2));
}

// Recorte con centro, proporción y ángulo dados, del ancho indicado.
export function recorteDesdeCentro(cx, cy, ancho, proporcion, angulo = 0) {
  return { cx, cy, ancho, alto: ancho / proporcion, angulo };
}

// ---------------------------------------------------------------------------------------------
// Giros de k·90° ("vista k"): lo que se ve con un marco de ángulo 90·k que cubre toda la foto.
// Con la fórmula del contrato, en la vista 1 (90°) la derecha del resultado es el abajo de la foto
// y el abajo del resultado es la izquierda de la foto.

// Ángulo en (−180, 180].
export function normalizarAngulo(a) {
  let x = ((a % 360) + 360) % 360;
  if (x > 180) x -= 360;
  return x;
}

// k en 0..3 más cercano a un ángulo.
export function giroDeAngulo(a) {
  return ((Math.round(normalizarAngulo(a) / 90) % 4) + 4) % 4;
}

// Punto normalizado de la foto → punto normalizado en la vista k.
export function aVistaNorm(x, y, k) {
  switch (k & 3) {
    case 1: return [y, 1 - x];
    case 2: return [1 - x, 1 - y];
    case 3: return [1 - y, x];
    default: return [x, y];
  }
}

// Punto normalizado en la vista k → punto normalizado de la foto.
export function desdeVistaNorm(u, v, k) {
  switch (k & 3) {
    case 1: return [1 - v, u];
    case 2: return [1 - u, 1 - v];
    case 3: return [v, 1 - u];
    default: return [u, v];
  }
}

// Caja normalizada { x0, y0, x1, y1 } de la foto → caja en la vista k.
export function cajaAVista(c, k) {
  const [a0, b0] = aVistaNorm(c.x0, c.y0, k), [a1, b1] = aVistaNorm(c.x1, c.y1, k);
  return { x0: Math.min(a0, a1), y0: Math.min(b0, b1), x1: Math.max(a0, a1), y1: Math.max(b0, b1) };
}

// Imagen ({ data, width, height } RGBA) vista con un giro k (mismo sentido que el Recorte).
export function rotarImagen(img, k) {
  k &= 3;
  if (!k) return img;
  const { data, width: W, height: H } = img;
  const w = k === 2 ? W : H, h = k === 2 ? H : W;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let v = 0; v < h; v++) {
    for (let u = 0; u < w; u++) {
      let x, y;
      if (k === 1) { x = W - 1 - v; y = u; } else if (k === 2) { x = W - 1 - u; y = H - 1 - v; } else { x = v; y = H - 1 - u; }
      const i = (y * W + x) * 4, j = (v * w + u) * 4;
      out[j] = data[i]; out[j + 1] = data[i + 1]; out[j + 2] = data[i + 2]; out[j + 3] = data[i + 3];
    }
  }
  return { data: out, width: w, height: h };
}

// Mediana de una lista de números (ignora valores no finitos).
export function mediana(valores) {
  const v = valores.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
