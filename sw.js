// Service worker: guarda la aplicación completa (código, librerías, WASM y modelos de
// MediaPipe) para que funcione sin internet después de la primera carga.
// Estrategia: primero la caché; si no está, la red (y se guarda para la próxima vez).
// Las actualizaciones se instalan en segundo plano y se usan la próxima vez que se abre el
// recortador (cuando se cierran todas sus ventanas), para no mezclar versiones a mitad de trabajo.
//
// La lista de archivos y la versión las escribe `node tools/generar-precache.mjs`: hay que
// correrlo antes de publicar (si no, los usuarios siguen con la versión vieja).

// <precache> (generado: no editar a mano)
const VERSION = '129d209a7a5a';
const ARCHIVOS = [
  "./",
  "css/app.css",
  "iconos/icono-192.png",
  "iconos/icono-512.png",
  "iconos/icono.svg",
  "index.html",
  "js/core/analisis.js",
  "js/core/clasificar.js",
  "js/core/constantes.js",
  "js/core/correcciones.js",
  "js/core/deteccion.js",
  "js/core/dientes.js",
  "js/core/exif.js",
  "js/core/exportar.js",
  "js/core/geometria.js",
  "js/core/guardar.js",
  "js/core/imagen.js",
  "js/core/nombres.js",
  "js/core/pipeline.js",
  "js/core/pptx.js",
  "js/core/recorte.js",
  "js/core/tipos.js",
  "js/core/vendor.js",
  "js/main.js",
  "js/ui/_stub_pipeline.js",
  "js/ui/cargar.js",
  "js/ui/comun.js",
  "js/ui/editor.js",
  "js/ui/guardar.js",
  "js/ui/paciente.js",
  "js/ui/presentacion.js",
  "js/ui/revisar.js",
  "js/ui/tomas.js",
  "js/worker/analisis.worker.js",
  "manifest.webmanifest",
  "vendor/exifr.mjs",
  "vendor/jszip.min.js",
  "vendor/mediapipe/vision_bundle.mjs",
  "vendor/mediapipe/wasm/vision_wasm_internal.js",
  "vendor/mediapipe/wasm/vision_wasm_internal.wasm",
  "vendor/mediapipe/wasm/vision_wasm_module_internal.js",
  "vendor/mediapipe/wasm/vision_wasm_module_internal.wasm",
  "vendor/mediapipe/wasm/vision_wasm_nosimd_internal.js",
  "vendor/mediapipe/wasm/vision_wasm_nosimd_internal.wasm",
  "vendor/modelos/blaze_face_short_range.tflite",
  "vendor/modelos/face_landmarker.task",
  "vendor/modelos/hand_landmarker.task",
  "vendor/modelos/selfie_multiclass_256x256.tflite",
  "vendor/piexif.js",
  "vendor/pptxgen.bundle.js",
];
// </precache>

const CACHE = `recortador-${VERSION}`;

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ARCHIVOS.map((url) => new Request(url, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil((async () => {
    for (const clave of await caches.keys()) {
      if (clave.startsWith('recortador-') && clave !== CACHE) await caches.delete(clave);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request;
  if (pedido.method !== 'GET' || new URL(pedido.url).origin !== self.location.origin) return;
  evento.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const guardada = await cache.match(pedido, { ignoreSearch: true });
    if (guardada) return guardada;
    try {
      const respuesta = await fetch(pedido);
      if (respuesta.ok && respuesta.type === 'basic') cache.put(pedido, respuesta.clone());
      return respuesta;
    } catch (error) {
      if (pedido.mode === 'navigate') {
        const inicio = await cache.match('./') || await cache.match('index.html');
        if (inicio) return inicio;
      }
      throw error;
    }
  })());
});
