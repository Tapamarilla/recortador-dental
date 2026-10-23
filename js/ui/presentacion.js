// Pantalla 6: crear la presentación .pptx con los recortes y, opcionalmente, imágenes adicionales.
import { ESPACIOS } from '../core/tipos.js';
import { h, preguntar, descargar, nombreSeguro, hayCarpetas } from './comun.js';
import { prepararRecortes, confirmarSobrescribir, pedirCarpeta } from './guardar.js';

export const paso = 'Presentación';
export const titulo = 'Crear presentación';

const urlsExtras = new Map(); // File → object URL de su miniatura

export function montar(contenedor, app) {
  const s = app.sesion;
  const entrada = h('input', { type: 'file', multiple: true, accept: 'image/*', hidden: true });
  const listaExtras = h('div', { class: 'lista-extras' });
  const estado = h('div', { class: 'progreso', hidden: true }, h('p', { 'aria-live': 'polite' }), h('progress', { max: 1, value: 0 }));
  const resultado = h('div', { class: 'resultado', 'aria-live': 'polite' });
  new MutationObserver(() => resultado.firstChild && resultado.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
    .observe(resultado, { childList: true });
  const botonCrear = h('button', { class: 'boton principal grande', type: 'button', onclick: () => crear() }, 'Crear presentación');

  const dibujarExtras = () => {
    if (!s.extras.length) {
      listaExtras.replaceChildren(h('p', { class: 'nota' }, 'No agregó imágenes adicionales. Es opcional.'));
      return;
    }
    listaExtras.replaceChildren(...s.extras.map((archivo, i) => {
      if (!urlsExtras.has(archivo)) urlsExtras.set(archivo, URL.createObjectURL(archivo));
      return h('div', { class: 'tarjeta-extra' },
        h('img', { src: urlsExtras.get(archivo), alt: archivo.name }),
        h('p', { class: 'nombre-archivo' }, `Diapositiva ${i + 3}: ${archivo.name}`),
        h('button', {
          class: 'boton secundario pequeno', type: 'button',
          onclick: () => {
            s.extras.splice(i, 1);
            dibujarExtras();
          },
        }, 'Quitar'),
      );
    }));
  };
  entrada.addEventListener('change', () => {
    s.extras.push(...[...entrada.files].filter((f) => f.type.startsWith('image/')));
    entrada.value = '';
    dibujarExtras();
  });

  const progreso = (texto, i, n) => {
    estado.hidden = false;
    estado.querySelector('p').textContent = texto;
    estado.querySelector('progress').max = n || 1;
    estado.querySelector('progress').value = i;
  };

  async function crear() {
    resultado.replaceChildren();
    botonCrear.disabled = true;
    try {
      let carpeta = app.carpeta;
      if (!carpeta && hayCarpetas()) {
        carpeta = await pedirCarpeta(app);
        if (!carpeta) return;
      }
      const recortes = await prepararRecortes(app, (i, n) => progreso(`Preparando foto ${Math.min(i + 1, n)} de ${n}`, i, n));
      const enPresentacion = new Set(ESPACIOS.filter((e) => e.lugar).map((e) => e.id));
      const imagenes = {};
      for (const r of recortes) if (enPresentacion.has(r.espacioId)) imagenes[r.espacioId] = r.blob;
      progreso('Armando la presentación…', 0, 1);
      const pptx = await app.api.crearPresentacion({ paciente: s.paciente.trim(), doctor: s.doctor.trim(), imagenes, extras: [...s.extras] });
      const nombre = `${nombreSeguro(s.paciente) || 'Presentación'}.pptx`;
      if (carpeta) {
        const r = await app.api.guardarArchivos(carpeta, [{ nombre, blob: pptx }], { confirmarSobrescribir });
        estado.hidden = true;
        if (r === false || r?.cancelado === true) {
          resultado.replaceChildren(h('p', { class: 'mensaje info' }, 'No se guardó la presentación.'));
          return;
        }
        resultado.replaceChildren(h('p', { class: 'mensaje exito' },
          `Listo. La presentación «${nombre}» quedó guardada en la carpeta «${carpeta.name}». Ya puede abrirla con PowerPoint.`));
      } else {
        descargar(pptx, nombre);
        estado.hidden = true;
        resultado.replaceChildren(h('p', { class: 'mensaje exito' },
          `Listo. La presentación «${nombre}» se descargó en la carpeta Descargas. Ya puede abrirla con PowerPoint.`));
      }
    } catch (error) {
      estado.hidden = true;
      app.fallo(error, 'No se pudo crear la presentación. Pruebe de nuevo.');
    } finally {
      botonCrear.disabled = false;
    }
  }

  const otroPaciente = async () => {
    const si = await preguntar('¿Empezar con otro paciente? Lo que no haya guardado de este paciente se perderá.', {
      si: 'Sí, otro paciente', no: 'No, seguir aquí',
    });
    if (!si) return;
    for (const url of urlsExtras.values()) URL.revokeObjectURL(url);
    urlsExtras.clear();
    app.reiniciar();
    app.irA(0);
  };

  contenedor.append(
    h('h1', {}, 'Crear la presentación'),
    h('p', { class: 'explicacion' }, 'La diapositiva 1 lleva los retratos y la diapositiva 2 las fotos intraorales.'),
    h('section', { class: 'bloque' },
      h('h2', {}, 'Imágenes adicionales (radiografías u otras)'),
      h('p', {}, 'Cada imagen va en su propia diapositiva, sin recortar.'),
      h('button', { class: 'boton secundario', type: 'button', onclick: () => entrada.click() }, 'Agregar imágenes adicionales'),
      entrada,
      listaExtras,
    ),
    h('div', { class: 'fila-botones' }, botonCrear),
    estado,
    resultado,
    h('section', { class: 'bloque final' },
      h('h2', {}, '¿Terminó con este paciente?'),
      h('button', { class: 'boton secundario', type: 'button', onclick: otroPaciente }, 'Empezar con otro paciente'),
    ),
  );
  dibujarExtras();
}
