// Worker de módulo que analiza fotos fuera del hilo principal (MediaPipe con GPU si se puede).
// Mensaje de entrada: { id, archivo } (File). Respuesta: { id, ok, resultado | error }.
// `resultado` es lo que devuelve analizarArchivo (incluye la miniatura como Blob).
import { analizarArchivo } from '../core/analisis.js';

self.onmessage = async (e) => {
  const { id, archivo } = e.data || {};
  try {
    const resultado = await analizarArchivo(archivo);
    self.postMessage({ id, ok: true, resultado });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message || err) });
  }
};
