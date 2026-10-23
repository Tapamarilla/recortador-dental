// Flujo de pantallas y estado de la sesión.
// Orden: Cargar fotos → Paciente → Elegir tomas → Revisar recortes → Guardar → Presentación.
// Las fotos se cargan primero para poder mostrar la foto de identificación (la tarjeta escrita a
// mano) en grande junto al formulario del paciente.
import { h, olvidarImagenes } from './ui/comun.js';
import * as cargar from './ui/cargar.js';
import * as paciente from './ui/paciente.js';
import * as tomas from './ui/tomas.js';
import * as revisar from './ui/revisar.js';
import * as guardar from './ui/guardar.js';
import * as presentacion from './ui/presentacion.js';

const PANTALLAS = [cargar, paciente, tomas, revisar, guardar, presentacion];
const parametros = new URLSearchParams(location.search);
const demo = parametros.has('demo');

// ---------- Módulos del análisis y de la salida (se cargan al usarlos) ----------
// Con ?demo el análisis se reemplaza por un sustituto sin MediaPipe (solo para probar la
// interfaz); la salida (exportar, guardar, pptx…) es siempre la real.
const RUTAS = {
  pipeline: './core/pipeline.js',
  exportar: './core/exportar.js',
  nombres: './core/nombres.js',
  guardar: './core/guardar.js',
  pptx: './core/pptx.js',
  correcciones: './core/correcciones.js',
};
const modulos = {};
function modulo(nombre) {
  const ruta = demo && nombre === 'pipeline' ? './ui/_stub_pipeline.js' : RUTAS[nombre];
  modulos[ruta] ??= import(ruta).catch((e) => {
    delete modulos[ruta];
    throw e;
  });
  return modulos[ruta];
}
const llamar = (nombre, funcion) => async (...args) => (await modulo(nombre))[funcion](...args);

const api = {
  analizarFotos: llamar('pipeline', 'analizarFotos'),
  reclasificar: llamar('pipeline', 'reclasificar'),
  recorteAutomatico: llamar('pipeline', 'recorteAutomatico'),
  cargarImagenCompleta: llamar('pipeline', 'cargarImagenCompleta'),
  exportarRecorte: llamar('exportar', 'exportarRecorte'),
  nombresDeSalida: llamar('nombres', 'nombresDeSalida'),
  elegirCarpeta: llamar('guardar', 'elegirCarpeta'),
  guardarArchivos: llamar('guardar', 'guardarArchivos'),
  crearPresentacion: llamar('pptx', 'crearPresentacion'),
  crearCorrecciones: llamar('correcciones', 'crearCorrecciones'),
};

// ---------- Estado ----------
const CLAVE_DOCTOR = 'recortador.ultimoDoctor';

function nuevaSesion() {
  let doctor = '';
  try {
    doctor = localStorage.getItem(CLAVE_DOCTOR) || '';
  } catch {}
  return { paciente: '', doctor, fotos: [], espacios: [], extras: [], modo: 'automatico' };
}

const app = {
  api,
  demo,
  sesion: nuevaSesion(),
  indice: 0,
  version: 0, // sube cada vez que cambia algo que afecta a los recortes
  carpeta: null, // carpeta elegida en "Guardar" (File System Access)
  salida: null, // { version, archivos: [{ espacioId, nombre, blob }] } ya exportados
};
window.recortador = app; // para depurar desde la consola

app.foto = (id) => app.sesion.fotos.find((f) => f.id === id) || null;
app.espacio = (id) => app.sesion.espacios.find((e) => e.id === id) || null;
app.cambio = () => {
  app.version++;
};

app.guardarDoctor = (doctor) => {
  try {
    localStorage.setItem(CLAVE_DOCTOR, doctor);
  } catch {}
};

app.reiniciar = () => {
  for (const f of app.sesion.fotos) if (f.miniaturaUrl) URL.revokeObjectURL(f.miniaturaUrl);
  olvidarImagenes();
  app.sesion = nuevaSesion();
  app.salida = null;
  app.cambio();
};

// Recalcula los espacios tras cambiar tipos, conservando lo que el usuario ya eligió o editó.
// `forzar` = { fotoId } para que esa foto quede como la elegida de su espacio.
app.reclasificar = async ({ forzar } = {}) => {
  const anteriores = new Map(app.sesion.espacios.map((e) => [e.id, e]));
  const nuevos = await api.reclasificar(app.sesion.fotos);
  for (const e of nuevos) {
    const a = anteriores.get(e.id);
    if (a && a.elegida && e.candidatas.includes(a.elegida)) {
      Object.assign(e, {
        elegida: a.elegida,
        recorteAuto: a.recorteAuto,
        recorte: a.recorte,
        nivelAuto: a.nivelAuto,
        confianza: a.confianza,
        volteo: a.volteo,
      });
    }
    if (forzar && e.candidatas.includes(forzar.fotoId) && e.elegida !== forzar.fotoId) {
      e.elegida = forzar.fotoId;
      e.recorteAuto = null;
    }
    if (forzar && e.elegida === forzar.fotoId) {
      e.recorteAuto = null; // el tipo cambió: hay que volver a calcular el recorte
      e.volteo = undefined;
    }
    if (e.elegida && !e.recorteAuto) await calcularRecorte(e);
  }
  app.sesion.espacios = nuevos;
  app.cambio();
};

async function calcularRecorte(espacio) {
  const foto = app.foto(espacio.elegida);
  const r = await api.recorteAutomatico(foto, foto.tipo);
  espacio.recorteAuto = r.recorte;
  espacio.recorte = { ...r.recorte };
  espacio.nivelAuto = r.angulo;
  espacio.confianza = r.confianza;
  espacio.volteo = undefined;
}

// El usuario elige otra toma para un espacio.
app.elegirToma = async (espacioId, fotoId) => {
  const e = app.espacio(espacioId);
  if (!e || e.elegida === fotoId) return;
  e.elegida = fotoId;
  await calcularRecorte(e);
  app.cambio();
};

// El usuario cambia el tipo de una foto.
app.cambiarTipo = async (fotoId, tipo, { forzarElegida = false } = {}) => {
  const foto = app.foto(fotoId);
  if (!foto || foto.tipo === tipo) return;
  foto.tipo = tipo; // reclasificar recalcula foto.volteoAuto para el tipo nuevo
  await app.reclasificar(forzarElegida ? { forzar: { fotoId } } : {});
};

// ---------- Mensajes ----------
const aviso = document.getElementById('aviso');
let temporizadorAviso = 0;
app.avisar = (texto, clase = 'info') => {
  clearTimeout(temporizadorAviso);
  aviso.replaceChildren(
    h('p', {}, texto),
    h('button', { class: 'boton secundario pequeno', type: 'button', onclick: () => (aviso.hidden = true) }, 'Entendido'),
  );
  aviso.className = 'aviso ' + clase;
  aviso.hidden = false;
  if (clase !== 'error') temporizadorAviso = setTimeout(() => (aviso.hidden = true), 7000);
};

// Muestra un mensaje amable y deja el detalle técnico solo en la consola.
app.fallo = (error, texto = 'Algo no salió bien. Por favor, intente de nuevo.') => {
  console.error(error);
  app.avisar(texto, 'error');
};

// Capa de espera para tareas que tardan.
const espera = document.getElementById('espera');
app.conEspera = async (texto, tarea) => {
  espera.querySelector('p').textContent = texto;
  espera.hidden = false;
  try {
    return await tarea();
  } finally {
    espera.hidden = true;
  }
};

window.addEventListener('error', (e) => {
  if (String(e.message).includes('ResizeObserver')) return; // aviso inofensivo del navegador
  app.fallo(e.error || e.message);
});
window.addEventListener('unhandledrejection', (e) => app.fallo(e.reason));

// ---------- Navegación ----------
const contenedor = document.getElementById('pantalla');
const botonAtras = document.getElementById('atras');
const botonSiguiente = document.getElementById('siguiente');
const ayudaNav = document.getElementById('ayuda-nav');
const listaPasos = document.getElementById('pasos');

function dibujarPasos() {
  listaPasos.replaceChildren(
    ...PANTALLAS.map((p, i) =>
      h('li', { class: i === app.indice ? 'actual' : i < app.indice ? 'hecho' : '', 'aria-current': i === app.indice ? 'step' : null },
        h('span', { class: 'numero' }, String(i + 1)), ' ', p.paso),
    ),
  );
}

app.actualizarNav = () => {
  const p = PANTALLAS[app.indice];
  botonAtras.hidden = app.indice === 0;
  botonSiguiente.hidden = app.indice === PANTALLAS.length - 1;
  const estado = p.puedeSeguir ? p.puedeSeguir(app) : true;
  botonSiguiente.setAttribute('aria-disabled', estado === true ? 'false' : 'true');
  botonSiguiente.classList.toggle('apagado', estado !== true);
  ayudaNav.textContent = estado === true ? '' : estado;
};

app.irA = (indice) => {
  PANTALLAS[app.indice].desmontar?.(app);
  aviso.hidden = true;
  app.indice = Math.max(0, Math.min(PANTALLAS.length - 1, indice));
  const p = PANTALLAS[app.indice];
  document.title = `${p.titulo} · Recortador de fotos dentales`;
  contenedor.replaceChildren();
  dibujarPasos();
  try {
    p.montar(contenedor, app);
  } catch (e) {
    app.fallo(e, 'No se pudo mostrar esta pantalla. Pruebe con "Atrás" y luego "Siguiente".');
  }
  app.actualizarNav();
  window.scrollTo(0, 0);
  contenedor.focus({ preventScroll: true });
};

app.siguiente = () => {
  const p = PANTALLAS[app.indice];
  const estado = p.puedeSeguir ? p.puedeSeguir(app) : true;
  if (estado !== true) {
    app.avisar(estado, 'info');
    return;
  }
  app.irA(app.indice + 1);
};

botonAtras.addEventListener('click', () => app.irA(app.indice - 1));
botonSiguiente.addEventListener('click', () => app.siguiente());

// ---------- Inicio ----------
if (demo) document.body.classList.add('modo-demo');
window.__recortadorListo = true;
document.getElementById('cargando')?.remove();
app.irA(0);

// Service worker (funcionar sin internet). En localhost no se registra salvo con ?sw, para no
// servir archivos viejos mientras se desarrolla y porque el lanzador local no lo necesita.
const esLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
if ('serviceWorker' in navigator && (!esLocal || parametros.has('sw'))) {
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Service worker no registrado', e));
}
