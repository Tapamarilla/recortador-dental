// Pantalla 3: elegir la toma que se usa en cada espacio y corregir el tipo de cualquier foto.
import { ESPACIOS, TIPOS } from '../core/tipos.js';
import { h, imagenMiniatura, selectorTipo } from './comun.js';

export const paso = 'Tomas';
export const titulo = 'Elegir tomas';

export function puedeSeguir(app) {
  return app.sesion.espacios.some((e) => e.elegida) ? true : 'Todavía no hay fotos elegidas. Asigne un tipo a las fotos de «Fotos sin usar».';
}

export function montar(contenedor, app) {
  const cuerpo = h('div', { class: 'tomas' });
  contenedor.append(
    h('h1', {}, 'Elegir tomas'),
    h('p', { class: 'explicacion' },
      'La foto con ', h('strong', { class: 'texto-elegida' }, 'borde verde'),
      ' es la que se va a usar. Para usar otra toma, haga clic en ella. Si una foto está en el lugar equivocado, cambie su tipo debajo de la foto.'),
    cuerpo,
  );

  const dibujar = () => {
    const desplazamiento = window.scrollY;
    cuerpo.replaceChildren(...ESPACIOS.map((def) => filaEspacio(app, def, alCambiar)), seccionSinUsar(app, alCambiar));
    window.scrollTo(0, desplazamiento);
    app.actualizarNav();
  };
  const alCambiar = async (texto, tarea, mensajeError) => {
    try {
      await app.conEspera(texto, tarea);
    } catch (error) {
      app.fallo(error, mensajeError);
    }
    dibujar();
  };
  dibujar();
}

function filaEspacio(app, def, alCambiar) {
  const espacio = app.espacio(def.id);
  const candidatas = (espacio?.candidatas || []).map((id) => app.foto(id)).filter(Boolean);
  const nitidezMax = Math.max(...candidatas.map((f) => f.nitidez ?? 0));
  const titulo = h('h2', {}, def.etiqueta, def.lugar ? null : h('span', { class: 'nota-titulo' }, ' · no va en la presentación'));

  if (!candidatas.length) {
    return h('section', { class: 'fila-espacio vacia' }, titulo,
      h('p', { class: 'sin-fotos' }, 'No hay fotos de este tipo. Puede asignar una en «Fotos sin usar», más abajo.'));
  }

  const tarjetas = candidatas.map((foto) => {
    const elegida = espacio.elegida === foto.id;
    const elegir = () => alCambiar('Preparando el recorte…', () => app.elegirToma(def.id, foto.id), 'No se pudo cambiar la toma. Intente de nuevo.');
    return h('div', { class: 'tarjeta-toma' + (elegida ? ' elegida' : '') },
      h('button', {
        class: 'boton-toma', type: 'button', 'aria-pressed': elegida ? 'true' : 'false',
        'aria-label': `${foto.nombre}${elegida ? ', elegida' : ', elegir esta toma'}`,
        onclick: elegida ? null : elegir,
      },
        h('span', { class: 'marco-miniatura' }, imagenMiniatura(foto, foto.nombre)),
        h('span', { class: 'estado-toma' }, elegida ? '✔ Elegida' : 'Usar esta'),
      ),
      h('p', { class: 'detalle-toma' },
        def.tipos.length > 1 ? h('span', { class: 'tipo-toma' }, TIPOS[foto.tipo]?.etiqueta) : null,
        candidatas.length > 1 && (foto.nitidez ?? 0) === nitidezMax ? h('span', { class: 'mas-nitida' }, 'La más nítida') : null,
        h('span', { class: 'nombre-archivo' }, foto.nombre),
      ),
      selectorTipo(foto.tipo, (tipo) =>
        alCambiar('Actualizando…', () => app.cambiarTipo(foto.id, tipo), 'No se pudo cambiar el tipo de la foto. Intente de nuevo.'),
      { etiqueta: 'Tipo' }),
    );
  });
  return h('section', { class: 'fila-espacio' }, titulo, h('div', { class: 'fila-tomas' }, ...tarjetas));
}

function seccionSinUsar(app, alCambiar) {
  const usadas = new Set(app.sesion.espacios.flatMap((e) => e.candidatas));
  const sinUsar = app.sesion.fotos.filter((f) => !usadas.has(f.id));
  const titulo = h('h2', {}, `Fotos sin usar (${sinUsar.length})`);
  if (!sinUsar.length) return h('section', { class: 'fila-espacio sin-usar' }, titulo, h('p', {}, 'Todas las fotos tienen un lugar.'));
  return h('section', { class: 'fila-espacio sin-usar' }, titulo,
    h('p', {}, 'Estas fotos no se van a usar. Para usar una, elija su tipo.'),
    h('div', { class: 'fila-tomas' },
      ...sinUsar.map((foto) =>
        h('div', { class: 'tarjeta-toma sin-usar' },
          h('span', { class: 'marco-miniatura' }, imagenMiniatura(foto)),
          h('p', { class: 'detalle-toma' }, h('span', { class: 'nombre-archivo' }, foto.nombre)),
          selectorTipo(foto.tipo, (tipo) =>
            alCambiar('Actualizando…', () => app.cambiarTipo(foto.id, tipo), 'No se pudo cambiar el tipo de la foto. Intente de nuevo.'),
          { etiqueta: 'Tipo' }),
        ),
      ),
    ),
  );
}
