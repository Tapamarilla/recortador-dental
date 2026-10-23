// Nombres de los archivos de salida (sección 7.5 de la especificación).
// "<Paciente> <n>.jpg", numerados en el orden de ESPACIOS (el de la presentación: reposo,
// sonrisa, perfil, lateral 1, frontal, lateral 2, oclusal inferior, oclusal superior y al final
// los extras). Los espacios vacíos se saltan sin dejar huecos en la numeración.
//
// El volteo no influye en el nombre. (La exportación usa `espacio.volteo ?? volteoDe(tipo)`:
// si la interfaz guarda un volteo elegido a mano en el espacio, ese manda sobre el del tipo.)

import { ESPACIOS } from './tipos.js';

// Caracteres que Windows no admite en nombres de archivo, más los de control.
const PROHIBIDOS = /[\\/:*?"<>|\u0000-\u001f]/g;
// Nombres reservados de Windows (sin extensión).
const RESERVADOS = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Limpia el nombre del paciente para usarlo en un nombre de archivo: quita los caracteres que
 * Windows prohíbe, junta los espacios repetidos y recorta los extremos. Conserva tildes, eñes y
 * mayúsculas tal como se escribieron. Windows tampoco admite punto o espacio al final.
 * @param {string} texto
 * @returns {string} nombre limpio ('Paciente' si queda vacío)
 */
export function limpiarNombre(texto) {
  let limpio = String(texto ?? '')
    .normalize('NFC')
    .replace(PROHIBIDOS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  if (!limpio) limpio = 'Paciente';
  if (RESERVADOS.test(limpio)) limpio = `${limpio}_`;
  return limpio;
}

/**
 * Indica si un espacio tiene foto para exportar.
 * @param {object|undefined} espacio  Espacio de la sesión
 */
function tieneFoto(espacio) {
  return !!(espacio && espacio.elegida != null && espacio.recorte);
}

/**
 * Nombres de salida para los espacios con foto, en el orden de ESPACIOS.
 * Los espacios de la sesión que no estén en ESPACIOS (si los hubiera) van al final, en el orden
 * en que vienen.
 * @param {string} paciente
 * @param {object[]} espacios  Espacio[] de la sesión (en cualquier orden)
 * @returns {{ espacioId: string, nombre: string }[]}
 */
export function nombresDeSalida(paciente, espacios) {
  const base = limpiarNombre(paciente);
  const porId = new Map((espacios || []).map((e) => [e.id, e]));
  const conocidos = new Set(ESPACIOS.map((e) => e.id));
  const orden = [
    ...ESPACIOS.map((e) => porId.get(e.id)),
    ...(espacios || []).filter((e) => !conocidos.has(e.id)),
  ];
  const salida = [];
  for (const espacio of orden) {
    if (!tieneFoto(espacio)) continue;
    salida.push({ espacioId: espacio.id, nombre: `${base} ${salida.length + 1}.jpg` });
  }
  return salida;
}

/**
 * Nombre del archivo de correcciones del paciente: "<Paciente> correcciones.json", para que
 * varios pacientes puedan compartir una carpeta sin pisarse.
 * @param {string} paciente
 */
export function nombreCorrecciones(paciente) {
  return `${limpiarNombre(paciente)} correcciones.json`;
}
