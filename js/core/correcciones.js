// correcciones.json (sección 10 de la especificación): lo que la app propuso y lo que quedó, por
// cada foto usada, para entrenar en la v2 un detector y un clasificador.
//
// Volteo: el final es `espacio.volteo ?? volteoDe(tipo)` (la interfaz puede guardar en el espacio
// un volteo elegido a mano). `volteoTipo` es el que corresponde al tipo final; `volteo` solo se
// escribe cuando difiere de él.

import { volteoDe } from './tipos.js';

export const VERSION_APP = '1.1.0';
export const VERSION_FORMATO = 1;

const redondear = (n, decimales) => (Number.isFinite(n) ? Number(n.toFixed(decimales)) : null);

/** Recorte con números redondeados (píxeles a 0,1 y grados a 0,01). */
function recorteJson(r) {
  if (!r) return null;
  return {
    cx: redondear(r.cx, 1),
    cy: redondear(r.cy, 1),
    ancho: redondear(r.ancho, 1),
    alto: redondear(r.alto, 1),
    angulo: redondear(r.angulo || 0, 2),
  };
}

function mismoRecorte(a, b) {
  return JSON.stringify(recorteJson(a)) === JSON.stringify(recorteJson(b));
}

/**
 * @param {{ paciente: string, doctor?: string, fotos: object[], espacios: object[] }} sesion
 * @param {{ versionApp?: string, fecha?: Date }} [opciones]
 * @returns {object} listo para JSON.stringify
 */
export function crearCorrecciones(sesion, opciones = {}) {
  const { versionApp = VERSION_APP, fecha = new Date() } = opciones;
  const fotos = sesion?.fotos || [];
  const porId = new Map(fotos.map((f) => [f.id, f]));

  const usadas = [];
  for (const espacio of sesion?.espacios || []) {
    const foto = porId.get(espacio.elegida);
    if (!foto || !espacio.recorte) continue;
    const volteoTipo = volteoDe(foto.tipo);
    const volteo = espacio.volteo ?? volteoTipo;
    const entrada = {
      espacio: espacio.id,
      archivo: foto.nombre ?? foto.archivo?.name ?? null,
      anchoOriginal: foto.ancho ?? null,
      altoOriginal: foto.alto ?? null,
      orientacionExif: foto.orientacionExif ?? null,
      tipoAuto: foto.tipoAuto ?? null,
      tipo: foto.tipo ?? null,
      recorteAuto: recorteJson(espacio.recorteAuto),
      recorte: recorteJson(espacio.recorte),
      rotacionAuto: redondear(espacio.recorteAuto?.angulo ?? espacio.nivelAuto ?? 0, 2),
      rotacion: redondear(espacio.recorte.angulo || 0, 2),
      confianza: redondear(espacio.confianza, 3),
      volteoTipo,
      recorteEditado: !mismoRecorte(espacio.recorteAuto, espacio.recorte),
    };
    if (volteo !== volteoTipo) entrada.volteo = volteo;
    usadas.push(entrada);
  }

  return {
    formato: VERSION_FORMATO,
    versionApp,
    fecha: fecha.toISOString(),
    paciente: sesion?.paciente ?? '',
    doctor: sesion?.doctor ?? '',
    fotos: usadas,
    // Tipo propuesto y final de todas las fotos cargadas (para el clasificador de la v2).
    clasificacion: fotos.map((f) => ({
      archivo: f.nombre ?? f.archivo?.name ?? null,
      tipoAuto: f.tipoAuto ?? null,
      tipo: f.tipo ?? null,
    })),
  };
}
