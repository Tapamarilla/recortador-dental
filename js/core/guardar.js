// Guardado de los archivos de salida (recortes, correcciones.json y la presentación).
//
// - Con File System Access (Chrome/Edge): el usuario elige una carpeta y se escribe ahí.
//   Antes de escribir se comprueba el permiso (se vuelve a pedir si hace falta) y se buscan los
//   nombres que ya existen: si hay alguno, se llama a `confirmarSobrescribir(nombres)`; si la
//   respuesta es no, no se escribe NADA (para no mezclar recortes viejos con nuevos).
// - Sin File System Access: `elegirCarpeta()` devuelve null y `guardarArchivos(null, …)` descarga
//   un .zip (`<Paciente>.zip`) o, si es un solo archivo, ese archivo directamente.

import { cargarJSZip } from './vendor.js';

/** ¿El navegador permite escribir en una carpeta elegida por el usuario? */
export function hayAccesoACarpetas() {
  return typeof globalThis.showDirectoryPicker === 'function';
}

/** ¿El error es porque el usuario cerró el diálogo sin elegir? */
export function esCancelacion(error) {
  return error?.name === 'AbortError';
}

/**
 * Pide una carpeta al usuario.
 * @returns {Promise<FileSystemDirectoryHandle|null>} null si no hay File System Access (modo .zip).
 *   Si el usuario cancela, la promesa se rechaza con un AbortError (ver `esCancelacion`).
 */
export async function elegirCarpeta() {
  if (!hayAccesoACarpetas()) return null;
  return await globalThis.showDirectoryPicker({ id: 'recortes', mode: 'readwrite', startIn: 'pictures' });
}

/**
 * Comprueba (y si hace falta vuelve a pedir) el permiso de escritura sobre la carpeta.
 * `requestPermission` necesita un gesto del usuario: llamar desde el clic de "Guardar".
 * @returns {Promise<boolean>}
 */
export async function verificarPermiso(handle) {
  const opciones = { mode: 'readwrite' };
  if (typeof handle.queryPermission === 'function' && (await handle.queryPermission(opciones)) === 'granted') return true;
  if (typeof handle.requestPermission === 'function') return (await handle.requestPermission(opciones)) === 'granted';
  return typeof handle.queryPermission !== 'function'; // sin API de permisos: se intenta escribir
}

/**
 * Nombres de `nombres` que ya existen en la carpeta.
 * @returns {Promise<string[]>}
 */
export async function nombresExistentes(handle, nombres) {
  const existentes = [];
  for (const nombre of nombres) {
    try {
      await handle.getFileHandle(nombre); // sin { create: true }: falla si no existe
      existentes.push(nombre);
    } catch (e) {
      if (e?.name !== 'NotFoundError' && e?.name !== 'TypeMismatchError') throw e;
      if (e?.name === 'TypeMismatchError') existentes.push(nombre); // hay una carpeta con ese nombre
    }
  }
  return existentes;
}

/**
 * Guarda los archivos en la carpeta o, si `handle` es null, los descarga (.zip o archivo suelto).
 * @param {FileSystemDirectoryHandle|null} handle
 * @param {{ nombre: string, blob: Blob }[]} archivos
 * @param {{ confirmarSobrescribir?: (nombres: string[]) => Promise<boolean>, nombreZip?: string }} [opciones]
 * @returns {Promise<{ modo: 'carpeta'|'zip'|'descarga', guardados: string[], cancelado: boolean }>}
 */
export async function guardarArchivos(handle, archivos, opciones = {}) {
  const { confirmarSobrescribir = async () => false, nombreZip = 'Recortes.zip' } = opciones;
  if (!handle) return await descargar(archivos, nombreZip);

  if (!(await verificarPermiso(handle))) {
    throw new Error('No hay permiso para guardar en la carpeta elegida.');
  }
  const existentes = await nombresExistentes(handle, archivos.map((a) => a.nombre));
  if (existentes.length && !(await confirmarSobrescribir(existentes))) {
    return { modo: 'carpeta', guardados: [], cancelado: true };
  }

  const guardados = [];
  for (const { nombre, blob } of archivos) {
    const archivo = await handle.getFileHandle(nombre, { create: true });
    const escritura = await archivo.createWritable();
    try {
      await escritura.write(blob);
      await escritura.close();
    } catch (e) {
      await escritura.abort?.().catch(() => {});
      throw e;
    }
    guardados.push(nombre);
  }
  return { modo: 'carpeta', guardados, cancelado: false };
}

/** Un archivo suelto se descarga tal cual; varios, dentro de un .zip. */
async function descargar(archivos, nombreZip) {
  if (archivos.length === 1) {
    descargarBlob(archivos[0].blob, archivos[0].nombre);
    return { modo: 'descarga', guardados: [archivos[0].nombre], cancelado: false };
  }
  const zip = await crearZip(archivos);
  descargarBlob(zip, nombreZip.toLowerCase().endsWith('.zip') ? nombreZip : `${nombreZip}.zip`);
  return { modo: 'zip', guardados: archivos.map((a) => a.nombre), cancelado: false };
}

/**
 * .zip con los archivos (los JPEG y el .pptx ya vienen comprimidos: se guardan sin recomprimir).
 * @returns {Promise<Blob>}
 */
export async function crearZip(archivos) {
  const JSZip = await cargarJSZip();
  const zip = new JSZip();
  for (const { nombre, blob } of archivos) {
    const comprimir = /\.(json|txt|csv)$/i.test(nombre);
    zip.file(nombre, await blob.arrayBuffer(), { compression: comprimir ? 'DEFLATE' : 'STORE' });
  }
  return await zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
}

function descargarBlob(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Blob de un objeto JSON con sangría (para correcciones.json). */
export function blobJson(objeto) {
  return new Blob([JSON.stringify(objeto, null, 2)], { type: 'application/json' });
}
