// Pantalla 4: miniaturas grandes del resultado de cada espacio, ordenadas como en la
// presentación. Clic en una abre el editor.
import { ESPACIOS, TIPOS } from '../core/tipos.js';
import { h, dibujarRecorteProgresivo, volteoEfectivo } from './comun.js';
import { abrirEditor } from './editor.js';

export const paso = 'Revisar';
export const titulo = 'Revisar recortes';

const CONFIANZA_BAJA = 0.5;
const ALTO_RETRATO = 300; // px en pantalla
const ANCHO_INTRAORAL = 290;

export function puedeSeguir(app) {
  return app.sesion.espacios.some((e) => e.elegida && e.recorte) ? true : 'No hay recortes para guardar. Vuelva a «Elegir tomas».';
}

// Grupos en el orden y la forma de la presentación.
const GRUPOS = [
  { titulo: 'Diapositiva 1 · Retratos', filas: [['reposo', 'sonrisa', 'perfil']] },
  { titulo: 'Diapositiva 2 · Intraorales', filas: [['io_lateral_1', 'io_frontal', 'io_lateral_2'], ['io_oclusal_inf', 'io_oclusal_sup']] },
  { titulo: 'Extra · no va en la presentación', filas: [['tres_cuartos']], soloSiHay: true },
];

export function montar(contenedor, app) {
  const cuerpo = h('div', { class: 'revisar' });
  contenedor.append(
    h('h1', {}, 'Revisar recortes'),
    h('p', { class: 'explicacion' }, 'Así quedarán las fotos. Si alguna no está bien, haga clic en ella para corregirla.'),
    cuerpo,
  );

  const dibujar = () => {
    cuerpo.replaceChildren();
    for (const grupo of GRUPOS) {
      if (grupo.soloSiHay && !grupo.filas.flat().some((id) => app.espacio(id)?.elegida)) continue;
      cuerpo.append(
        h('section', { class: 'grupo-revisar' },
          h('h2', {}, grupo.titulo),
          ...grupo.filas.map((fila) => h('div', { class: 'fila-revisar' }, ...fila.map((id) => tarjeta(app, id, abrir)))),
        ),
      );
    }
    app.actualizarNav();
  };
  const abrir = async (espacioId) => {
    const desplazamiento = window.scrollY;
    try {
      await abrirEditor(app, espacioId);
    } catch (error) {
      app.fallo(error, 'No se pudo abrir el editor. Intente de nuevo.');
    }
    dibujar();
    window.scrollTo(0, desplazamiento);
  };
  dibujar();
}

function tarjeta(app, espacioId, abrir) {
  const def = ESPACIOS.find((e) => e.id === espacioId);
  const espacio = app.espacio(espacioId);
  // Vertical u horizontal según el recorte (o, si no hay foto, según el tipo del espacio).
  const proporcion = espacio?.recorte ? espacio.recorte.ancho / espacio.recorte.alto
    : TIPOS[def.tipos[0]].proporcion;
  const ancho = proporcion < 1 ? Math.round(ALTO_RETRATO * proporcion) : ANCHO_INTRAORAL;
  const alto = proporcion < 1 ? ALTO_RETRATO : Math.round(ANCHO_INTRAORAL / proporcion);

  if (!espacio?.elegida || !espacio.recorte) {
    return h('div', { class: 'tarjeta-revisar vacia' },
      h('div', { class: 'hueco', style: `width:${ancho}px;height:${alto}px` }, h('span', {}, 'Sin foto')),
      h('p', { class: 'etiqueta-revisar' }, def.etiqueta));
  }

  const foto = app.foto(espacio.elegida);
  const canvas = h('canvas', { class: 'vista-recorte', style: `width:${ancho}px;height:${alto}px` });
  const ppp = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(ancho * ppp);
  canvas.height = Math.round(alto * ppp);
  dibujarRecorteProgresivo(canvas, foto, espacio.recorte, volteoEfectivo(espacio, foto), app.api);

  const revisar = (espacio.confianza ?? 1) < CONFIANZA_BAJA;
  const editado = esEditado(espacio);
  return h('div', { class: 'tarjeta-revisar' + (revisar && !editado ? ' a-revisar' : '') },
    h('button', { class: 'boton-revisar', type: 'button', 'aria-label': `${def.etiqueta}: corregir recorte`, onclick: () => abrir(espacioId) },
      canvas,
      h('span', { class: 'accion-revisar' }, 'Corregir'),
    ),
    h('p', { class: 'etiqueta-revisar' }, def.etiqueta),
    editado
      ? h('p', { class: 'marca-editado' }, '✔ Ajustado por usted')
      : revisar ? h('p', { class: 'marca-revisar' }, 'Revise este recorte') : null,
  );
}

function esEditado(e) {
  if (e.volteo != null) return true;
  const a = e.recorteAuto;
  const b = e.recorte;
  if (!a || !b) return false;
  return ['cx', 'cy', 'ancho', 'alto', 'angulo'].some((k) => Math.abs((a[k] ?? 0) - (b[k] ?? 0)) > 1e-6);
}
