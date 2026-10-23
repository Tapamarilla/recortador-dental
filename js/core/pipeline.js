// API de alto nivel del análisis para la interfaz (docs/CONTRATO.md):
//   analizarFotos(files, { modo, onProgreso }) → { fotos, espacios, identificacion }
//   reclasificar(fotos[, espaciosPrevios]) → espacios
//   recorteAutomatico(foto, tipo) → Promise<{ recorte, angulo, confianza }>
//   cargarImagenCompleta(foto) → Promise<ImageBitmap>
//
// El análisis de cada foto corre en un Worker de módulo (js/worker/analisis.worker.js). Si el
// Worker no se puede crear o falla, se analiza en el hilo principal, cediendo el control entre foto
// y foto para que la interfaz siga pintando (el progreso se ve igual).
import { analizarArchivo } from './analisis.js';
import { clasificarSesion, agrupar, armarEspacios, tipoDeCarpeta } from './clasificar.js';
import { recortePara } from './recorte.js';
import { decodificarCompleta } from './imagen.js';

const ESPERA_PRIMERA_MS = 120000; // la primera foto incluye cargar los modelos
const ESPERA_MS = 60000;

let worker = null;
let workerRoto = false;
let pendientes = new Map();
let siguienteId = 1;

function crearWorker() {
  if (worker || workerRoto || typeof Worker === 'undefined') return worker;
  try {
    worker = new Worker(new URL('../worker/analisis.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const p = pendientes.get(e.data?.id);
      if (!p) return;
      pendientes.delete(e.data.id);
      if (e.data.ok) p.ok(e.data.resultado);
      else p.error(new Error(e.data.error));
    };
    worker.onerror = (e) => {
      e.preventDefault?.();
      descartarWorker(new Error(e.message || 'Error en el Worker'));
    };
  } catch (err) {
    console.warn('No se pudo crear el Worker de análisis; se usa el hilo principal.', err);
    descartarWorker(err);
  }
  return worker;
}

function descartarWorker(err) {
  workerRoto = true;
  if (worker) worker.terminate();
  worker = null;
  for (const p of pendientes.values()) p.error(err);
  pendientes = new Map();
}

function analizarEnWorker(archivo, espera) {
  return new Promise((ok, error) => {
    const id = siguienteId++;
    const reloj = setTimeout(() => {
      pendientes.delete(id);
      error(new Error('El Worker no respondió a tiempo'));
    }, espera);
    pendientes.set(id, {
      ok: (r) => { clearTimeout(reloj); ok(r); },
      error: (e) => { clearTimeout(reloj); error(e); },
    });
    worker.postMessage({ id, archivo });
  });
}

const ceder = () => new Promise((ok) => setTimeout(ok, 0));

// Analiza un archivo con el Worker si se puede, si no en el hilo principal.
// `esPrimera` da más tiempo de espera (carga de modelos).
async function analizarUno(archivo, esPrimera, usarWorker = true) {
  if (usarWorker && crearWorker()) {
    try {
      return await analizarEnWorker(archivo, esPrimera ? ESPERA_PRIMERA_MS : ESPERA_MS);
    } catch (err) {
      // Un archivo dañado no rompe el Worker: el error vuelve como mensaje normal y se propaga.
      if (!workerRoto && !/no respondió/.test(err.message)) throw err;
      console.warn('El Worker de análisis falló; se sigue en el hilo principal.', err);
      descartarWorker(err);
    }
  }
  await ceder();
  return analizarArchivo(archivo);
}

// Ordena por fecha de captura; si falta la fecha, por nombre de archivo.
function ordenar(fotos) {
  const conFecha = fotos.every((f) => f.fecha != null);
  return fotos.sort((a, b) => {
    if (conFecha && a.fecha !== b.fecha) return a.fecha - b.fecha;
    return a.nombre.localeCompare(b.nombre, 'es', { numeric: true });
  });
}

// `usarWorker: false` fuerza el hilo principal (solo para pruebas).
export async function analizarFotos(files, { modo = 'automatico', onProgreso, usarWorker = true } = {}) {
  const lista = Array.from(files || []).filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic)$/i.test(f.name));
  const fotos = [];
  onProgreso?.(0, lista.length);
  for (let i = 0; i < lista.length; i++) {
    const archivo = lista[i];
    const foto = {
      id: `${i}-${archivo.name}`, archivo, nombre: archivo.name, fecha: null, ancho: 0, alto: 0,
      orientacionExif: 1, miniaturaUrl: null, nitidez: 0, analisis: null,
      tipoAuto: 'otra', tipo: 'otra', grupo: null,
    };
    try {
      const r = await analizarUno(archivo, i === 0, usarWorker);
      Object.assign(foto, {
        fecha: r.fecha, ancho: r.ancho, alto: r.alto, orientacionExif: r.orientacionExif,
        nitidez: r.nitidez, analisis: r.analisis,
        miniaturaUrl: r.miniatura ? URL.createObjectURL(r.miniatura) : null,
      });
    } catch (err) {
      console.warn(`No se pudo analizar ${archivo.name}.`, err);
      foto.analisis = { error: true };
    }
    if (modo === 'manual') foto.tipoFijo = tipoDeCarpeta(archivo.webkitRelativePath) || 'otra';
    fotos.push(foto);
    onProgreso?.(i + 1, lista.length);
  }
  ordenar(fotos);
  clasificarSesion(fotos);
  const espacios = calcularEspacios(fotos);
  const id = fotos.find((f) => f.tipo === 'identificacion');
  return { fotos, espacios, identificacion: id ? id.id : null };
}

function espacioConRecorte(e, fotos, previo) {
  const foto = fotos.find((f) => f.id === e.elegida);
  const r = foto ? recortePara(foto.analisis, foto.tipo) : null;
  const recorteAuto = r ? r.recorte : null;
  // Si la elegida y su tipo no cambiaron, se conserva el recorte que haya editado el usuario.
  const conservar = previo && previo.elegida === e.elegida && previo.tipoElegida === foto?.tipo && previo.recorte;
  return {
    ...e,
    tipoElegida: foto?.tipo ?? null,
    recorteAuto,
    recorte: conservar ? previo.recorte : recorteAuto,
    nivelAuto: r ? r.angulo : 0,
    confianza: r ? r.confianza : 0,
  };
}

function calcularEspacios(fotos, espaciosPrevios = []) {
  const previos = Object.fromEntries(espaciosPrevios.map((e) => [e.id, e]));
  const elegidas = Object.fromEntries(espaciosPrevios.map((e) => [e.id, e.elegida]));
  return armarEspacios(fotos, elegidas).map((e) => espacioConRecorte(e, fotos, previos[e.id]));
}

// Tras cambios de tipo hechos por el usuario: rehace los grupos y los espacios. Si se pasan los
// espacios anteriores, conserva las elegidas que sigan siendo candidatas y los recortes editados.
export function reclasificar(fotos, espaciosPrevios = []) {
  agrupar(fotos);
  return calcularEspacios(fotos, espaciosPrevios);
}

export async function recorteAutomatico(foto, tipo) {
  const r = foto?.analisis && !foto.analisis.error ? recortePara(foto.analisis, tipo) : null;
  if (!r) {
    // Sin análisis: marco centrado del tamaño típico.
    const a = { ancho: foto.ancho, alto: foto.alto, color: {}, cara: null, cabeza: null, dientes: null };
    const s = recortePara(a, tipo);
    return s ? { recorte: s.recorte, angulo: s.angulo, confianza: s.confianza } : null;
  }
  return { recorte: r.recorte, angulo: r.angulo, confianza: r.confianza };
}

export function cargarImagenCompleta(foto) {
  return decodificarCompleta(foto.archivo);
}
