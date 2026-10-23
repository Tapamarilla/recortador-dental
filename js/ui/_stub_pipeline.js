// SUSTITUTO del análisis, solo para probar la interfaz sin MediaPipe: se usa con ?demo en la
// dirección (por ejemplo http://localhost:8765/app/?demo). Cumple la API de js/core/pipeline.js
// del contrato, pero NO reconoce nada: reparte los tipos según el orden de las fotos y propone
// recortes centrados. No usar para pacientes reales.
import { TIPOS, ESPACIOS, proporcionDe, seRecorta } from '../core/tipos.js';

const SECUENCIA = [
  'identificacion', 'frente_reposo', 'frente_reposo', 'frente_sonrisa', 'frente_sonrisa',
  'perfil_izq', 'perfil_izq', 'perfil_der', 'perfil_der', 'tres_cuartos',
  'io_frontal', 'io_frontal', 'io_lateral_1', 'io_lateral_1', 'io_lateral_2', 'io_lateral_2',
  'io_oclusal_inf', 'io_oclusal_inf', 'io_oclusal_sup', 'io_oclusal_sup',
];

const normalizar = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Tipo según el nombre de la carpeta (modo manual): acepta la clave o la etiqueta del tipo.
function tipoDeCarpeta(archivo) {
  const partes = (archivo.webkitRelativePath || '').split('/').slice(0, -1);
  for (const carpeta of partes.reverse()) {
    const n = normalizar(carpeta);
    for (const [clave, t] of Object.entries(TIPOS)) {
      if (n === normalizar(clave) || n === normalizar(t.etiqueta)) return clave;
    }
  }
  return null;
}

let contador = 0;

export async function analizarFotos(files, { modo = 'automatico', onProgreso = () => {} } = {}) {
  const ordenados = [...files].sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
  const fotos = [];
  for (const [i, archivo] of ordenados.entries()) {
    onProgreso(i, ordenados.length);
    const bmp = await createImageBitmap(archivo, { imageOrientation: 'from-image' });
    const escala = 400 / Math.max(bmp.width, bmp.height);
    const lienzo = new OffscreenCanvas(Math.round(bmp.width * escala), Math.round(bmp.height * escala));
    lienzo.getContext('2d').drawImage(bmp, 0, 0, lienzo.width, lienzo.height);
    const miniatura = await lienzo.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    const tipo = modo === 'manual' ? tipoDeCarpeta(archivo) || 'otra' : SECUENCIA[i] || 'otra';
    fotos.push({
      id: `f${++contador}`,
      archivo,
      nombre: archivo.name,
      fecha: archivo.lastModified || null,
      ancho: bmp.width,
      alto: bmp.height,
      orientacionExif: 1,
      miniaturaUrl: URL.createObjectURL(miniatura),
      nitidez: ((i * 7919) % 100) + 1,
      analisis: null,
      // Caso de prueba: lateral 2 tomada sin espejo ⇒ el análisis propone no voltearla.
      volteoAuto: tipo === 'io_lateral_2' ? 'ninguno' : undefined,
      tipoAuto: tipo,
      tipo,
      grupo: tipo,
    });
    bmp.close();
  }
  onProgreso(ordenados.length, ordenados.length);
  return { fotos, espacios: reclasificar(fotos) };
}

// Igual que el contrato: devuelve los espacios con candidatas y la más nítida elegida, con su
// recorte automático (en el sustituto se calcula al instante).
export function reclasificar(fotos) {
  const espacios = [];
  for (const def of ESPACIOS) {
    const candidatas = fotos.filter((f) => def.tipos.includes(f.tipo));
    if (!candidatas.length) continue;
    const mejor = candidatas.reduce((a, b) => ((b.nitidez ?? 0) > (a.nitidez ?? 0) ? b : a));
    const r = recorteSincrono(mejor, mejor.tipo);
    espacios.push({
      id: def.id,
      candidatas: candidatas.map((f) => f.id),
      elegida: mejor.id,
      recorteAuto: r.recorte,
      recorte: { ...r.recorte },
      nivelAuto: r.angulo,
      confianza: r.confianza,
    });
  }
  return espacios;
}

function recorteSincrono(foto, tipo) {
  if (!seRecorta(tipo)) return { recorte: null, angulo: 0, confianza: 0 };
  const p = proporcionDe(tipo);
  let alto;
  let ancho;
  if (p < 1) {
    alto = foto.alto * 0.68;
    ancho = alto * p;
  } else {
    ancho = foto.ancho * 0.72;
    alto = ancho / p;
  }
  // Caso de prueba: la oclusal superior simula una foto de celular girada 90° (+1,5° fino).
  if (tipo === 'io_oclusal_sup') {
    const ancho = Math.min(foto.alto, foto.ancho * p) * 0.85; // a 90° el ancho del marco va a lo alto de la foto
    return { recorte: { cx: foto.ancho / 2, cy: foto.alto / 2, ancho, alto: ancho / p, angulo: 91.5 }, angulo: 91.5, confianza: 0.9 };
  }
  const angulo = tipo.startsWith('frente') ? 1.5 : 0;
  const confianza = ['io_oclusal_inf', 'perfil_der'].includes(tipo) ? 0.3 : 0.9;
  return { recorte: { cx: foto.ancho / 2, cy: foto.alto / 2, ancho, alto, angulo }, angulo, confianza };
}

export async function recorteAutomatico(foto, tipo) {
  return recorteSincrono(foto, tipo);
}

export async function cargarImagenCompleta(foto) {
  return createImageBitmap(foto.archivo, { imageOrientation: 'from-image' });
}
