// Pantalla 1: cargar las fotos del paciente (archivos o carpeta) y elegir el modo.
import { h, imagenMiniatura, selectorTipo, preguntar } from './comun.js';

export const paso = 'Fotos';
export const titulo = 'Cargar fotos';

const EXTENSIONES = /\.(jpe?g|png|webp)$/i;
let procesando = false;

export function puedeSeguir(app) {
  if (procesando) return 'Espere a que terminen de procesarse las fotos.';
  return app.sesion.fotos.length ? true : 'Primero cargue las fotos del paciente.';
}

export function montar(contenedor, app) {
  if (app.sesion.fotos.length) montarCargadas(contenedor, app);
  else montarVacia(contenedor, app);
}

// ---------- Antes de cargar ----------
function montarVacia(contenedor, app) {
  const s = app.sesion;
  const entradaFotos = h('input', { type: 'file', multiple: true, accept: 'image/jpeg,image/png,image/webp', hidden: true });
  const entradaCarpeta = h('input', { type: 'file', multiple: true, webkitdirectory: true, hidden: true });
  const recibir = (lista) => procesar(contenedor, app, lista);
  entradaFotos.addEventListener('change', () => recibir([...entradaFotos.files]));
  entradaCarpeta.addEventListener('change', () => recibir([...entradaCarpeta.files]));

  const opcionModo = (valor, titulo, texto) =>
    h('label', { class: 'opcion-modo' },
      h('input', { type: 'radio', name: 'modo', value: valor, checked: s.modo === valor, onchange: () => (s.modo = valor) }),
      h('span', { class: 'opcion-texto' }, h('strong', {}, titulo), h('span', {}, texto)),
    );

  const zona = h('div', { class: 'zona-soltar', id: 'zona-soltar' },
    h('p', { class: 'zona-titulo' }, 'Arrastre aquí la carpeta o las fotos del paciente'),
    h('p', {}, 'o use uno de estos botones:'),
    h('div', { class: 'fila-botones centrada' },
      h('button', { class: 'boton principal', type: 'button', onclick: () => entradaFotos.click() }, 'Elegir fotos'),
      h('button', { class: 'boton principal', type: 'button', onclick: () => entradaCarpeta.click() }, 'Elegir carpeta'),
    ),
    entradaFotos, entradaCarpeta,
  );
  zona.addEventListener('dragover', (e) => {
    e.preventDefault();
    zona.classList.add('encima');
  });
  zona.addEventListener('dragleave', () => zona.classList.remove('encima'));
  zona.addEventListener('drop', async (e) => {
    e.preventDefault();
    zona.classList.remove('encima');
    try {
      recibir(await archivosSoltados(e.dataTransfer));
    } catch (error) {
      app.fallo(error, 'No se pudieron leer las fotos que soltó. Pruebe con el botón «Elegir fotos».');
    }
  });

  contenedor.append(
    h('h1', {}, 'Cargar las fotos del paciente'),
    h('fieldset', { class: 'modos' },
      h('legend', {}, '¿Cómo quiere ordenar las fotos?'),
      opcionModo('automatico', 'Automático (recomendado)', 'La aplicación reconoce sola cada foto.'),
      opcionModo('manual', 'Manual', 'Usted indica qué es cada foto, o las trae ya separadas en carpetas con el nombre del tipo.'),
    ),
    zona,
    h('div', { class: 'progreso', id: 'progreso', hidden: true },
      h('p', { id: 'progreso-texto', 'aria-live': 'polite' }, ''),
      h('progress', { id: 'progreso-barra', max: 1, value: 0 }),
    ),
  );
}

// Recorre carpetas soltadas. A los archivos de carpetas se les agrega la ruta relativa
// (webkitRelativePath) para que el modo manual reconozca los nombres de carpeta.
async function archivosSoltados(dt) {
  const entradas = [...dt.items].map((it) => it.webkitGetAsEntry?.()).filter(Boolean);
  if (!entradas.length) return [...dt.files];
  const archivos = [];
  async function recorrer(entrada, ruta) {
    if (entrada.isFile) {
      const archivo = await new Promise((ok, mal) => entrada.file(ok, mal));
      if (ruta) Object.defineProperty(archivo, 'webkitRelativePath', { value: ruta + archivo.name });
      archivos.push(archivo);
    } else if (entrada.isDirectory) {
      const lector = entrada.createReader();
      for (;;) {
        const lote = await new Promise((ok, mal) => lector.readEntries(ok, mal));
        if (!lote.length) break;
        for (const hijo of lote) await recorrer(hijo, ruta + entrada.name + '/');
      }
    }
  }
  for (const entrada of entradas) await recorrer(entrada, '');
  return archivos;
}

async function procesar(contenedor, app, lista) {
  const archivos = lista.filter((f) => EXTENSIONES.test(f.name));
  if (!archivos.length) {
    app.avisar('No se encontraron fotos (archivos .jpg o .png). Revise la carpeta elegida.', 'error');
    return;
  }
  const zona = contenedor.querySelector('#zona-soltar');
  const caja = contenedor.querySelector('#progreso');
  const texto = contenedor.querySelector('#progreso-texto');
  const barra = contenedor.querySelector('#progreso-barra');
  zona.classList.add('deshabilitada');
  zona.querySelectorAll('button').forEach((b) => (b.disabled = true));
  contenedor.querySelectorAll('.modos input').forEach((b) => (b.disabled = true));
  caja.hidden = false;
  texto.textContent = `Preparando ${archivos.length} fotos…`;
  barra.removeAttribute('value'); // barra "en movimiento" hasta el primer avance
  procesando = true;
  app.actualizarNav();
  try {
    const { fotos, espacios } = await app.api.analizarFotos(archivos, {
      modo: app.sesion.modo,
      onProgreso(i, n) {
        texto.textContent = `Procesando foto ${Math.min(i + 1, n)} de ${n}`;
        barra.max = n;
        barra.value = i;
      },
    });
    app.sesion.fotos = fotos;
    app.sesion.espacios = espacios;
    app.cambio();
    procesando = false;
    if (app.sesion.modo === 'automatico') {
      app.irA(1);
      app.avisar(`Listo: se procesaron ${fotos.length} fotos.`, 'exito');
    } else {
      contenedor.replaceChildren();
      montarCargadas(contenedor, app);
      app.actualizarNav();
    }
  } catch (error) {
    procesando = false;
    app.fallo(error, 'No se pudieron procesar las fotos. Cierre el recortador, vuelva a abrirlo e intente otra vez.');
    contenedor.replaceChildren();
    montarVacia(contenedor, app);
    app.actualizarNav();
  }
}

// ---------- Después de cargar ----------
function montarCargadas(contenedor, app) {
  const s = app.sesion;
  const reiniciar = async () => {
    const si = await preguntar('¿Empezar de nuevo con otras fotos? Se perderán los cambios hechos a este paciente.', {
      si: 'Sí, empezar de nuevo', no: 'No, seguir',
    });
    if (!si) return;
    const modo = s.modo;
    app.reiniciar();
    app.sesion.modo = modo;
    app.irA(0);
  };

  contenedor.append(
    h('h1', {}, 'Fotos cargadas'),
    h('div', { class: 'resumen-carga' },
      h('p', {}, `Hay ${s.fotos.length} fotos cargadas de este paciente.`),
      h('button', { class: 'boton secundario', type: 'button', onclick: reiniciar }, 'Cargar otras fotos'),
    ),
  );

  if (s.modo !== 'manual') {
    contenedor.append(h('p', {}, 'Pulse «Siguiente» para continuar.'));
    return;
  }

  const rejilla = h('div', { class: 'rejilla-fotos' });
  const dibujar = () => {
    rejilla.replaceChildren(
      ...s.fotos.map((foto) =>
        h('div', { class: 'tarjeta-foto' + (foto.tipo === 'otra' ? '' : ' con-tipo') },
          h('div', { class: 'marco-miniatura' }, imagenMiniatura(foto)),
          h('p', { class: 'nombre-archivo' }, foto.nombre),
          selectorTipo(foto.tipo, async (tipo) => {
            try {
              await app.conEspera('Actualizando…', () => app.cambiarTipo(foto.id, tipo));
            } catch (error) {
              app.fallo(error, 'No se pudo cambiar el tipo de la foto. Intente de nuevo.');
            }
            dibujar();
          }, { etiqueta: '¿Qué foto es?' }),
        ),
      ),
    );
  };
  dibujar();
  contenedor.append(
    h('h2', {}, 'Indique qué es cada foto'),
    h('p', {}, 'Elija el tipo debajo de cada foto. Las que no va a usar pueden quedar en «No usar».'),
    rejilla,
  );
}
