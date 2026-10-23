// Pantalla 5: guardar los recortes numerados en una carpeta (o descargar un .zip).
import { h, volteoEfectivo, etiquetaEspacio, preguntar, hayCarpetas, nombreSeguro } from './comun.js';
import { nombreCorrecciones } from '../core/nombres.js';

export const paso = 'Guardar';
export const titulo = 'Guardar';

// Espacios con foto y recorte, en el orden de ESPACIOS (el de app.sesion.espacios).
function espaciosListos(app) {
  return app.sesion.espacios.filter((e) => e.elegida && e.recorte);
}

export async function nombres(app) {
  return app.api.nombresDeSalida(app.sesion.paciente.trim(), espaciosListos(app));
}

// Exporta los recortes a resolución completa (de a uno, para no llenar la memoria).
// Se reutilizan mientras no cambie nada de la sesión.
export async function prepararRecortes(app, alAvanzar = () => {}) {
  const clave = `${app.version}|${app.sesion.paciente.trim()}`;
  if (app.salida?.clave === clave) return app.salida.archivos;
  const lista = await nombres(app);
  const archivos = [];
  for (const [i, { espacioId, nombre }] of lista.entries()) {
    alAvanzar(i, lista.length);
    const espacio = app.espacio(espacioId);
    const foto = app.foto(espacio.elegida);
    const blob = await app.api.exportarRecorte(foto, espacio.recorte, volteoEfectivo(espacio, foto), { calidad: 0.95 });
    archivos.push({ espacioId, nombre, blob });
  }
  alAvanzar(lista.length, lista.length);
  app.salida = { clave, archivos };
  return archivos;
}

export function confirmarSobrescribir(nombresExistentes) {
  const lista = h('ul', { class: 'lista-archivos corta' }, ...nombresExistentes.slice(0, 8).map((n) => h('li', {}, n)),
    nombresExistentes.length > 8 ? h('li', {}, `y ${nombresExistentes.length - 8} más`) : null);
  return preguntar(
    nombresExistentes.length === 1
      ? 'En esa carpeta ya hay un archivo con el mismo nombre. ¿Quiere reemplazarlo?'
      : `En esa carpeta ya hay ${nombresExistentes.length} archivos con los mismos nombres. ¿Quiere reemplazarlos?`,
    { si: 'Sí, reemplazar', no: 'No, cancelar', detalle: lista },
  );
}

// Pide la carpeta. Devuelve null si el usuario cancela.
export async function pedirCarpeta(app) {
  try {
    const carpeta = await app.api.elegirCarpeta();
    if (carpeta) app.carpeta = carpeta;
    return carpeta;
  } catch (error) {
    if (error?.name === 'AbortError') return null;
    throw error;
  }
}

function cancelado(resultado) {
  return resultado === false || resultado?.cancelado === true;
}

export function montar(contenedor, app) {
  const lista = h('ul', { class: 'lista-archivos' }, h('li', {}, 'Calculando nombres…'));
  const estado = h('div', { class: 'progreso', hidden: true },
    h('p', { 'aria-live': 'polite' }), h('progress', { max: 1, value: 0 }));
  const resultado = h('div', { class: 'resultado', 'aria-live': 'polite' });
  new MutationObserver(() => resultado.firstChild && resultado.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
    .observe(resultado, { childList: true });
  const botones = h('div', { class: 'fila-botones' });

  contenedor.append(
    h('h1', {}, 'Guardar los recortes'),
    h('p', { class: 'explicacion' }, 'Se guardarán estas fotos, en tamaño original:'),
    lista,
    botones,
    estado,
    resultado,
  );

  nombres(app).then((ns) => {
    lista.replaceChildren(...ns.map(({ espacioId, nombre }) =>
      h('li', {}, h('strong', {}, nombre), h('span', { class: 'detalle' }, ` — ${etiquetaEspacio(espacioId)}`))));
  }).catch((error) => {
    lista.replaceChildren(h('li', {}, 'No se pudieron preparar los nombres de los archivos.'));
    console.error(error);
  });

  const ocupar = (si) => botones.querySelectorAll('button').forEach((b) => (b.disabled = si));
  const progreso = (texto, i, n) => {
    estado.hidden = false;
    estado.querySelector('p').textContent = texto;
    const barra = estado.querySelector('progress');
    barra.max = n || 1;
    barra.value = i;
  };

  const guardar = async (modo) => {
    resultado.replaceChildren();
    ocupar(true);
    try {
      let carpeta = null;
      if (modo === 'elegir' || (modo === 'carpeta' && !app.carpeta)) {
        carpeta = await pedirCarpeta(app);
        if (!carpeta) return;
      } else if (modo === 'carpeta') {
        carpeta = app.carpeta;
      }
      const archivos = await prepararRecortes(app, (i, n) => progreso(`Preparando foto ${Math.min(i + 1, n)} de ${n}`, i, n));
      const todos = archivos.map(({ nombre, blob }) => ({ nombre, blob }));
      try {
        const correcciones = await app.api.crearCorrecciones(app.sesion);
        todos.push({ nombre: nombreCorrecciones(app.sesion.paciente), blob: new Blob([JSON.stringify(correcciones, null, 2)], { type: 'application/json' }) });
      } catch (error) {
        console.warn('No se pudo preparar correcciones.json', error); // no es imprescindible para el doctor
      }
      progreso(carpeta ? 'Guardando en la carpeta…' : 'Preparando el archivo .zip…', archivos.length, archivos.length);
      const r = await app.api.guardarArchivos(carpeta, todos, { confirmarSobrescribir, nombreZip: `${nombreSeguro(app.sesion.paciente) || 'Recortes'}.zip` });
      estado.hidden = true;
      if (cancelado(r)) {
        resultado.replaceChildren(h('p', { class: 'mensaje info' }, 'No se guardó nada. Puede elegir otra carpeta.'));
        return;
      }
      app.guardado = { version: app.version, carpeta: carpeta?.name ?? null };
      resultado.replaceChildren(h('p', { class: 'mensaje exito' }, carpeta
        ? `Listo. Se guardaron ${archivos.length} fotos en la carpeta «${carpeta.name}». Pulse «Siguiente» para crear la presentación.`
        : `Listo. Se descargó un archivo .zip con ${archivos.length} fotos (está en la carpeta Descargas). Pulse «Siguiente» para crear la presentación.`));
      dibujarBotones();
    } catch (error) {
      estado.hidden = true;
      app.fallo(error, 'No se pudieron guardar las fotos. Revise que la carpeta exista y pruebe de nuevo.');
    } finally {
      ocupar(false);
    }
  };

  const dibujarBotones = () => {
    const b = [];
    if (hayCarpetas()) {
      if (app.carpeta) {
        b.push(
          h('button', { class: 'boton principal', type: 'button', onclick: () => guardar('carpeta') }, `Guardar en «${app.carpeta.name}»`),
          h('button', { class: 'boton secundario', type: 'button', onclick: () => guardar('elegir') }, 'Elegir otra carpeta'),
        );
      } else {
        b.push(h('button', { class: 'boton principal', type: 'button', onclick: () => guardar('elegir') }, 'Elegir carpeta y guardar'));
      }
      b.push(h('button', { class: 'boton secundario', type: 'button', onclick: () => guardar('zip') }, 'Descargar .zip'));
    } else {
      b.push(h('button', { class: 'boton principal', type: 'button', onclick: () => guardar('zip') }, 'Descargar .zip'));
      contenedor.querySelector('.nota-zip') || botones.before(h('p', { class: 'nota nota-zip' },
        'Este navegador no permite elegir una carpeta. Las fotos se descargarán juntas en un archivo .zip.'));
    }
    botones.replaceChildren(...b);
  };
  dibujarBotones();
}
