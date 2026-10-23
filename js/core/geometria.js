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

// Mediana de una lista de números (ignora valores no finitos).
export function mediana(valores) {
  const v = valores.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
