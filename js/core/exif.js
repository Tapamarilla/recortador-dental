// Lectura de EXIF: orientación (1..8) y fecha de captura (DateTimeOriginal), con exifr.
// Funciona en el hilo principal y en el Worker (solo lee el principio del archivo).
import { parse } from '../../vendor/exifr.mjs';

// Devuelve { orientacion, fecha } (fecha en ms desde época, o null). Nunca lanza error:
// si el archivo no trae EXIF (PNG, capturas de pantalla), devuelve orientación 1 y fecha null.
export async function leerExif(archivo) {
  try {
    const datos = await parse(archivo, {
      pick: ['Orientation', 'DateTimeOriginal', 'CreateDate', 'SubSecTimeOriginal'],
      translateValues: false,
      reviveValues: true,
    });
    if (!datos) return { orientacion: 1, fecha: null };
    const orientacion = Number.isInteger(datos.Orientation) && datos.Orientation >= 1 && datos.Orientation <= 8
      ? datos.Orientation : 1;
    const f = datos.DateTimeOriginal || datos.CreateDate;
    let fecha = f instanceof Date && !isNaN(f) ? f.getTime() : null;
    // Las fracciones de segundo ayudan a ordenar ráfagas tomadas en el mismo segundo.
    if (fecha != null && datos.SubSecTimeOriginal != null) {
      const sub = String(datos.SubSecTimeOriginal).trim();
      if (/^\d+$/.test(sub)) fecha += Number(('0.' + sub)) * 1000;
    }
    return { orientacion, fecha };
  } catch {
    return { orientacion: 1, fecha: null };
  }
}

// Orientaciones 5..8 intercambian ancho y alto.
export function giraEjes(orientacion) {
  return orientacion >= 5 && orientacion <= 8;
}
