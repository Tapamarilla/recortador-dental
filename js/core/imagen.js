// Decodificación con la orientación EXIF aplicada, copia reducida para el análisis, miniatura y
// nitidez (varianza del Laplaciano). Funciona en el hilo principal y en el Worker.

export const LADO_REDUCIDO = 1024; // lado mayor de la copia de análisis
export const LADO_MINIATURA = 400; // lado mayor de la miniatura

// Lee ancho y alto del marcador SOF de un JPEG, sin decodificarlo (tamaño ANTES de orientar).
// Devuelve null si no es un JPEG reconocible.
export function dimensionesJpeg(buffer) {
  const d = new DataView(buffer);
  if (d.byteLength < 4 || d.getUint16(0) !== 0xffd8) return null;
  let i = 2;
  while (i + 9 < d.byteLength) {
    if (d.getUint8(i) !== 0xff) { i++; continue; }
    const m = d.getUint8(i + 1);
    if (m === 0xff) { i++; continue; }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    const largo = d.getUint16(i + 2);
    // SOF0..SOF15 salvo DHT (C4), JPG (C8) y DAC (CC).
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { ancho: d.getUint16(i + 7), alto: d.getUint16(i + 5) };
    }
    i += 2 + largo;
  }
  return null;
}

function medidasReducidas(ancho, alto, lado) {
  const s = Math.min(1, lado / Math.max(ancho, alto));
  return { w: Math.max(1, Math.round(ancho * s)), h: Math.max(1, Math.round(alto * s)) };
}

// Decodifica `archivo` (File/Blob) y devuelve la copia reducida ya orientada:
// { bitmap, ancho, alto } con ancho/alto = tamaño ORIENTADO a resolución completa.
// Si el tamaño se puede leer del encabezado JPEG, el navegador decodifica directamente a tamaño
// reducido (mucho más rápido que decodificar los 16 MP y reducir después).
export async function decodificarReducida(archivo, orientacion = 1, lado = LADO_REDUCIDO) {
  let dims = null;
  try {
    dims = dimensionesJpeg(await archivo.slice(0, 512 * 1024).arrayBuffer());
  } catch { dims = null; }
  if (dims) {
    const gira = orientacion >= 5 && orientacion <= 8;
    const ancho = gira ? dims.alto : dims.ancho, alto = gira ? dims.ancho : dims.alto;
    const { w, h } = medidasReducidas(ancho, alto, lado);
    try {
      const bitmap = await createImageBitmap(archivo, {
        imageOrientation: 'from-image', resizeWidth: w, resizeHeight: h, resizeQuality: 'high',
      });
      // Comprobación: si el navegador no aplicó la orientación como esperábamos, la proporción
      // no coincide y se usa el camino lento.
      if (Math.abs(bitmap.width / bitmap.height - w / h) < 0.02) return { bitmap, ancho, alto };
      bitmap.close();
    } catch { /* sigue por el camino lento */ }
  }
  const completa = await createImageBitmap(archivo, { imageOrientation: 'from-image' });
  const ancho = completa.width, alto = completa.height;
  const { w, h } = medidasReducidas(ancho, alto, lado);
  const bitmap = await createImageBitmap(completa, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
  completa.close();
  return { bitmap, ancho, alto };
}

// Imagen completa, orientada (para el editor y la exportación).
export function decodificarCompleta(archivo) {
  return createImageBitmap(archivo, { imageOrientation: 'from-image' });
}

export function crearLienzo(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Píxeles RGBA de un ImageBitmap (o lienzo), opcionalmente reducido a `lado`.
export function pixelesDe(fuente, lado = null) {
  const { w, h } = lado ? medidasReducidas(fuente.width, fuente.height, lado) : { w: fuente.width, h: fuente.height };
  const lienzo = crearLienzo(w, h);
  const g = lienzo.getContext('2d', { willReadFrequently: true });
  g.drawImage(fuente, 0, 0, w, h);
  return g.getImageData(0, 0, w, h);
}

// Miniatura JPEG (Blob) con lado mayor `lado`.
export async function miniaturaBlob(fuente, lado = LADO_MINIATURA) {
  const { w, h } = medidasReducidas(fuente.width, fuente.height, lado);
  const lienzo = crearLienzo(w, h);
  const g = lienzo.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(fuente, 0, 0, w, h);
  if (lienzo.convertToBlob) return lienzo.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  return new Promise((ok) => lienzo.toBlob(ok, 'image/jpeg', 0.85));
}

// Escala de grises (luma) de un ImageData.
export function grises(img) {
  const { data, width, height } = img;
  const g = new Float32Array(width * height);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  return g;
}

// Varianza del Laplaciano (4 vecinos) sobre la imagen en grises, opcionalmente dentro de la caja
// { x0, y0, x1, y1 } en píxeles. Mayor = más nítida.
export function varianzaLaplaciano(gris, ancho, alto, caja = null) {
  const x0 = Math.max(1, Math.floor(caja ? caja.x0 : 1)), y0 = Math.max(1, Math.floor(caja ? caja.y0 : 1));
  const x1 = Math.min(ancho - 1, Math.ceil(caja ? caja.x1 : ancho - 1)), y1 = Math.min(alto - 1, Math.ceil(caja ? caja.y1 : alto - 1));
  let n = 0, suma = 0, suma2 = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0, i = y * ancho + x0; x < x1; x++, i++) {
      const l = gris[i - 1] + gris[i + 1] + gris[i - ancho] + gris[i + ancho] - 4 * gris[i];
      suma += l; suma2 += l * l; n++;
    }
  }
  if (!n) return 0;
  const m = suma / n;
  return suma2 / n - m * m;
}
