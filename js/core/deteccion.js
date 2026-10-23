// Detectores de MediaPipe (cara con blendshapes, manos y segmentador multiclase), creados al
// primer uso. Delegado GPU con respaldo automático a CPU si falla al crear o al detectar.
// Funciona en el hilo principal, en un Worker clásico y en un Worker de módulo.
import { FilesetResolver, FaceLandmarker, HandLandmarker, ImageSegmenter } from '../../vendor/mediapipe/vision_bundle.mjs';

const RUTA_WASM = new URL('../../vendor/mediapipe/wasm', import.meta.url).href;
const modelo = (n) => new URL(`../../vendor/modelos/${n}`, import.meta.url).href;

// En un Worker de módulo `importScripts` existe pero lanza TypeError: hay que usar el cargador
// del WASM en versión módulo (lo carga MediaPipe con import()).
function esWorkerDeModulo() {
  if (typeof importScripts !== 'function' || typeof document !== 'undefined') return false;
  try { importScripts(); return false; } catch { return true; }
}

// Si WebGL corre por software (SwiftShader, llvmpipe: GPU bloqueada o sin controlador), el delegado
// GPU "funciona" pero es unas 10 veces más lento que el de CPU. En ese caso se usa CPU de entrada.
function webglPorSoftware() {
  try {
    const lienzo = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
    const gl = lienzo.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const nombre = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /swiftshader|llvmpipe|software|basic render/i.test(nombre);
  } catch {
    return true;
  }
}

let fileset = null;
let delegado = webglPorSoftware() ? 'CPU' : 'GPU';
const tareas = {}; // nombre → Promise<tarea>

const FABRICAS = {
  cara: (fs, d) => FaceLandmarker.createFromOptions(fs, {
    baseOptions: { modelAssetPath: modelo('face_landmarker.task'), delegate: d },
    runningMode: 'IMAGE', numFaces: 1, minFaceDetectionConfidence: 0.3, minFacePresenceConfidence: 0.3,
    outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
  }),
  manos: (fs, d) => HandLandmarker.createFromOptions(fs, {
    baseOptions: { modelAssetPath: modelo('hand_landmarker.task'), delegate: d },
    runningMode: 'IMAGE', numHands: 2, minHandDetectionConfidence: 0.4,
  }),
  segmentador: (fs, d) => ImageSegmenter.createFromOptions(fs, {
    baseOptions: { modelAssetPath: modelo('selfie_multiclass_256x256.tflite'), delegate: d },
    runningMode: 'IMAGE', outputCategoryMask: true, outputConfidenceMasks: false,
  }),
};

async function obtenerFileset() {
  if (!fileset) fileset = await FilesetResolver.forVisionTasks(RUTA_WASM, esWorkerDeModulo());
  return fileset;
}

// MediaPipe borra `self.ModuleFactory` después de crear cada tarea. Con el cargador clásico lo
// vuelve a definir al ejecutar el script de nuevo, pero un módulo importado queda en caché y no se
// vuelve a ejecutar: en un Worker de módulo hay que restaurarlo antes de cada creación.
async function restaurarFabricaModulo(fs) {
  if (!esWorkerDeModulo() || self.ModuleFactory) return;
  const m = await import(fs.wasmLoaderPath);
  self.ModuleFactory = m.default;
}

async function crear(nombre) {
  const fs = await obtenerFileset();
  await restaurarFabricaModulo(fs);
  if (delegado === 'GPU') {
    try {
      return await FABRICAS[nombre](fs, 'GPU');
    } catch (e) {
      console.warn(`MediaPipe: GPU no disponible para ${nombre}, se usa CPU.`, e);
      pasarACpu();
    }
  }
  await restaurarFabricaModulo(fs);
  return FABRICAS[nombre](fs, 'CPU');
}

function pasarACpu() {
  if (delegado === 'CPU') return;
  delegado = 'CPU';
  for (const k of Object.keys(tareas)) {
    const p = tareas[k];
    delete tareas[k];
    p.then((t) => t.close?.()).catch(() => {});
  }
}

function tarea(nombre) {
  if (!tareas[nombre]) tareas[nombre] = crear(nombre);
  return tareas[nombre];
}

export function delegadoActual() { return delegado; }

// Precarga los tres modelos (opcional; si no, se crean al primer uso).
export async function prepararDetectores() {
  await Promise.all(Object.keys(FABRICAS).map(tarea));
  return delegado;
}

// Ejecuta `fn(tarea)`; si falla con GPU, pasa a CPU y reintenta una vez.
async function conRespaldo(nombre, fn) {
  const t = await tarea(nombre);
  try {
    return fn(t);
  } catch (e) {
    if (delegado !== 'GPU') throw e;
    console.warn(`MediaPipe: fallo con GPU en ${nombre}, se reintenta con CPU.`, e);
    pasarACpu();
    return fn(await tarea(nombre));
  }
}

// Cara: devuelve null o { puntos: [{x,y,z}] normalizados, blend: {nombre: valor}, matriz: number[16] }.
export function detectarCara(imagen) {
  return conRespaldo('cara', (t) => {
    const r = t.detect(imagen);
    if (!r.faceLandmarks?.length) return null;
    const blend = {};
    for (const c of r.faceBlendshapes?.[0]?.categories || []) blend[c.categoryName] = c.score;
    return {
      puntos: r.faceLandmarks[0].map((p) => ({ x: p.x, y: p.y, z: p.z })),
      blend,
      matriz: r.facialTransformationMatrixes?.[0]?.data ? Array.from(r.facialTransformationMatrixes[0].data) : null,
    };
  });
}

// Manos: lista de { puntos: [{x,y}] normalizados, lado, confianza }.
export function detectarManos(imagen) {
  return conRespaldo('manos', (t) => {
    const r = t.detect(imagen);
    return (r.landmarks || []).map((pts, i) => ({
      puntos: pts.map((p) => ({ x: p.x, y: p.y })),
      lado: r.handedness?.[i]?.[0]?.categoryName || '',
      confianza: r.handedness?.[i]?.[0]?.score || 0,
    }));
  });
}

// Segmentación multiclase: { ancho, alto, clases: Uint8Array } con
// 0 fondo, 1 pelo, 2 piel del cuerpo, 3 piel de la cara, 4 ropa, 5 otros.
export function segmentar(imagen) {
  return conRespaldo('segmentador', (t) => {
    let salida = null;
    t.segment(imagen, (r) => {
      const m = r.categoryMask;
      if (m) salida = { ancho: m.width, alto: m.height, clases: m.getAsUint8Array().slice() };
    });
    return salida;
  });
}

export const CLASES_SEGMENTO = { fondo: 0, pelo: 1, pielCuerpo: 2, pielCara: 3, ropa: 4, otros: 5 };
