// Recorte a resolución completa → JPEG (sección 7.5 y "Reglas fijas" del contrato).
//
// - El lienzo mide exactamente round(ancho) × round(alto) del Recorte: nunca se reduce.
// - Un píxel (u, v) del resultado sale del original en (cx, cy) + R(angulo)·(u − W/2, v − H/2)
//   (convención del contrato). Sin rotación se copian los píxeles tal cual (sin interpolar);
//   con rotación se interpola con suavizado de alta calidad.
// - El volteo ('ninguno' | 'horizontal' | 'vertical' | 'ambos') se aplica en los píxeles, después
//   del recorte. 'ambos' = horizontal + vertical (igual que girar 180°).
// - EXIF: orientación 1. Si la fuente es un JPEG con EXIF, se copia el resto (fecha, cámara,
//   exposición) sin la miniatura ni la MakerNote, con PixelXDimension/PixelYDimension
//   corregidos. Si el EXIF está roto, el JPEG sale sin EXIF (nunca falla por eso).
// - Exportar de a una foto: el lienzo se libera al terminar.

import { cargarPiexif } from './vendor.js';

const GRADOS = Math.PI / 180;

/** Volteos que acepta exportarRecorte. */
export const VOLTEOS = ['ninguno', 'horizontal', 'vertical', 'ambos'];

/**
 * @param {ImageBitmap|HTMLImageElement|HTMLCanvasElement|OffscreenCanvas|Blob|File|Function} fuente
 *   Imagen ya orientada a resolución completa, o el archivo original (se decodifica con la
 *   orientación EXIF aplicada), o una función sin argumentos que devuelve cualquiera de ellos
 *   (por ejemplo `() => cargarImagenCompleta(foto)`). Si se pasa una Foto del contrato, se usa
 *   `foto.archivo`.
 * @param {{cx:number, cy:number, ancho:number, alto:number, angulo:number}} recorte
 * @param {'ninguno'|'horizontal'|'vertical'|'ambos'} [volteo='ninguno']
 * @param {{ calidad?: number, exif?: Blob|File|null }} [opciones]
 *   `exif`: archivo JPEG del que copiar el EXIF cuando `fuente` no es un archivo (por ejemplo
 *   un ImageBitmap ya cargado). Por defecto, la propia fuente si es un archivo.
 * @returns {Promise<Blob>} JPEG
 */
export async function exportarRecorte(fuente, recorte, volteo = 'ninguno', opciones = {}) {
  const { calidad = 0.95 } = opciones;
  volteo ??= 'ninguno';
  // Un volteo desconocido no debe salir sin voltear sin avisar.
  if (!VOLTEOS.includes(volteo)) throw new Error(`Volteo desconocido: ${volteo}`);
  let origen = fuente;
  if (origen && typeof origen === 'object' && 'archivo' in origen && !(origen instanceof Blob)) {
    origen = origen.archivo; // Foto del contrato
  }
  if (typeof origen === 'function') origen = await origen();
  const archivoExif = opciones.exif !== undefined ? opciones.exif : (origen instanceof Blob ? origen : null);

  let imagen = origen;
  let cerrarImagen = false;
  if (origen instanceof Blob) {
    imagen = await createImageBitmap(origen, { imageOrientation: 'from-image' });
    cerrarImagen = true;
  }

  let jpeg;
  try {
    jpeg = await dibujarYCodificar(imagen, recorte, volteo, calidad);
  } finally {
    if (cerrarImagen) imagen.close?.();
  }

  const W = Math.round(recorte.ancho);
  const H = Math.round(recorte.alto);
  return await agregarExif(jpeg, archivoExif, W, H);
}

/** Dibuja el recorte (rotado y volteado) y lo codifica en JPEG. */
async function dibujarYCodificar(imagen, recorte, volteo, calidad) {
  const W = Math.round(recorte.ancho);
  const H = Math.round(recorte.alto);
  if (!(W > 0 && H > 0)) throw new Error('Recorte vacío');

  const lienzo = crearLienzo(W, H);
  try {
    const ctx = lienzo.getContext('2d', { alpha: false });
    // Fondo blanco por si el marco rotado toca fuera de la imagen (JPEG no tiene transparencia).
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    // 1) Volteo, que se aplica al resultado ya recortado.
    if (volteo === 'horizontal' || volteo === 'ambos') { ctx.translate(W, 0); ctx.scale(-1, 1); }
    if (volteo === 'vertical' || volteo === 'ambos') { ctx.translate(0, H); ctx.scale(1, -1); }

    const angulo = recorte.angulo || 0;
    if (Math.abs(angulo) < 1e-6) {
      // 2a) Sin rotación: copia píxel a píxel, alineada a la rejilla del original.
      ctx.imageSmoothingEnabled = false;
      const sx = Math.round(recorte.cx - W / 2);
      const sy = Math.round(recorte.cy - H / 2);
      dibujarRecorteRecto(ctx, imagen, sx, sy, W, H);
    } else {
      // 2b) Con rotación: destino = R(−a)·(origen − c) + (W/2, H/2).
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.translate(W / 2, H / 2);
      ctx.rotate(-angulo * GRADOS);
      ctx.translate(-recorte.cx, -recorte.cy);
      ctx.drawImage(imagen, 0, 0);
    }

    return await codificarJpeg(lienzo, calidad);
  } finally {
    // Liberar la memoria del lienzo enseguida (fotos de ~16 MP).
    lienzo.width = 0;
    lienzo.height = 0;
  }
}

/** drawImage del rectángulo (sx, sy, W, H) recortado a los límites de la imagen. */
function dibujarRecorteRecto(ctx, imagen, sx, sy, W, H) {
  const iw = imagen.width;
  const ih = imagen.height;
  const x0 = Math.max(0, sx);
  const y0 = Math.max(0, sy);
  const x1 = Math.min(iw, sx + W);
  const y1 = Math.min(ih, sy + H);
  if (x1 <= x0 || y1 <= y0) return;
  ctx.drawImage(imagen, x0, y0, x1 - x0, y1 - y0, x0 - sx, y0 - sy, x1 - x0, y1 - y0);
}

function crearLienzo(W, H) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(W, H);
  const lienzo = document.createElement('canvas');
  lienzo.width = W;
  lienzo.height = H;
  return lienzo;
}

function codificarJpeg(lienzo, calidad) {
  if (typeof lienzo.convertToBlob === 'function') {
    return lienzo.convertToBlob({ type: 'image/jpeg', quality: calidad });
  }
  return new Promise((ok, falla) => {
    lienzo.toBlob((b) => (b ? ok(b) : falla(new Error('No se pudo codificar el JPEG'))), 'image/jpeg', calidad);
  });
}

// ---------------------------------------------------------------------------------------------
// EXIF

/**
 * Inserta en `jpeg` el EXIF de `archivoOriginal` con orientación 1 y el tamaño nuevo.
 * Ante cualquier problema devuelve `jpeg` tal cual (sin EXIF = orientación 1 implícita).
 */
async function agregarExif(jpeg, archivoOriginal, W, H) {
  if (!archivoOriginal) return jpeg;
  try {
    const segmento = await leerSegmentoExif(archivoOriginal);
    if (!segmento) return jpeg;
    const piexif = await cargarPiexif();
    const exif = piexif.load(segmento);
    const nuevo = {
      '0th': { ...exif['0th'] },
      Exif: { ...exif.Exif },
      GPS: { ...exif.GPS },
      Interop: { ...exif.Interop },
      '1st': {},
      thumbnail: null,
    };
    nuevo['0th'][piexif.ImageIFD.Orientation] = 1;
    delete nuevo['0th'][piexif.ImageIFD.ImageWidth];
    delete nuevo['0th'][piexif.ImageIFD.ImageLength];
    // La MakerNote (Sony) usa desplazamientos absolutos que dejan de valer al reescribir el EXIF.
    delete nuevo.Exif[piexif.ExifIFD.MakerNote];
    nuevo.Exif[piexif.ExifIFD.PixelXDimension] = W;
    nuevo.Exif[piexif.ExifIFD.PixelYDimension] = H;
    if (!Object.keys(nuevo.GPS).length) delete nuevo.GPS;
    if (!Object.keys(nuevo.Interop).length) delete nuevo.Interop;

    const exifTexto = piexif.dump(nuevo); // "Exif\0\0" + TIFF, como cadena binaria
    if (exifTexto.length + 2 > 0xffff) return jpeg; // no entra en un segmento APP1
    const app1 = new Uint8Array(4 + exifTexto.length);
    app1[0] = 0xff; app1[1] = 0xe1;
    app1[2] = ((exifTexto.length + 2) >> 8) & 0xff;
    app1[3] = (exifTexto.length + 2) & 0xff;
    for (let i = 0; i < exifTexto.length; i++) app1[4 + i] = exifTexto.charCodeAt(i) & 0xff;

    // Quitar el APP0 (JFIF) y cualquier APP1 que haya puesto el codificador.
    const bytes = new Uint8Array(await jpeg.arrayBuffer());
    const resto = saltarSegmentosApp(bytes);
    if (resto < 0) return jpeg;
    return new Blob([bytes.subarray(0, 2), app1, bytes.subarray(resto)], { type: 'image/jpeg' });
  } catch {
    return jpeg;
  }
}

/** Índice del primer segmento después de SOI que no sea APP0/APP1 (o −1 si no es JPEG). */
function saltarSegmentosApp(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return -1;
  let i = 2;
  while (i + 4 <= bytes.length && bytes[i] === 0xff && (bytes[i + 1] === 0xe0 || bytes[i + 1] === 0xe1)) {
    i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
  }
  return i;
}

/**
 * Busca el segmento APP1 "Exif" al principio del archivo (sin leerlo entero) y lo devuelve como
 * cadena binaria que empieza por "Exif\0\0" (formato que acepta piexif.load), o null.
 */
async function leerSegmentoExif(archivo) {
  const cabeza = new Uint8Array(await archivo.slice(0, 256 * 1024).arrayBuffer());
  if (cabeza[0] !== 0xff || cabeza[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 <= cabeza.length) {
    if (cabeza[i] !== 0xff) return null;
    const marcador = cabeza[i + 1];
    if (marcador === 0xda || marcador === 0xd9) return null; // empiezan los datos de imagen
    const largo = (cabeza[i + 2] << 8) | cabeza[i + 3];
    if (marcador === 0xe1 && i + 2 + largo <= cabeza.length
      && cabeza[i + 4] === 0x45 && cabeza[i + 5] === 0x78 && cabeza[i + 6] === 0x69 && cabeza[i + 7] === 0x66) {
      const datos = cabeza.subarray(i + 4, i + 2 + largo);
      let texto = '';
      for (let k = 0; k < datos.length; k += 0x8000) {
        texto += String.fromCharCode.apply(null, datos.subarray(k, k + 0x8000));
      }
      return texto;
    }
    i += 2 + largo;
  }
  return null;
}
