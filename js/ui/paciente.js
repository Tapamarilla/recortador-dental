// Pantalla 2: nombre del paciente y doctor(a), con la foto de identificación en grande al lado
// para copiar los datos de la tarjeta escrita a mano.
import { h } from './comun.js';

export const paso = 'Paciente';
export const titulo = 'Paciente';

const CLAVE_DOCTORES = 'recortador.doctores';
let urlTarjeta = null;

export function puedeSeguir(app) {
  return app.sesion.paciente.trim() ? true : 'Escriba el nombre del paciente para seguir.';
}

function doctoresRecientes() {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_DOCTORES) || '[]');
  } catch {
    return [];
  }
}

function recordarDoctor(app, doctor) {
  doctor = doctor.trim();
  if (!doctor) return;
  app.guardarDoctor(doctor);
  try {
    const lista = [doctor, ...doctoresRecientes().filter((d) => d !== doctor)].slice(0, 10);
    localStorage.setItem(CLAVE_DOCTORES, JSON.stringify(lista));
  } catch {}
}

export function montar(contenedor, app) {
  const s = app.sesion;
  const tarjeta = s.fotos.find((f) => f.tipo === 'identificacion');

  const nombre = h('input', {
    id: 'campo-paciente', type: 'text', autocomplete: 'off', spellcheck: 'false', value: s.paciente,
    placeholder: 'Por ejemplo: José Pérez',
    oninput: () => {
      s.paciente = nombre.value;
      app.cambio();
      app.actualizarNav();
    },
    onkeydown: (e) => e.key === 'Enter' && doctor.focus(),
  });
  const doctor = h('input', {
    id: 'campo-doctor', type: 'text', autocomplete: 'off', spellcheck: 'false', value: s.doctor, list: 'doctores-recientes',
    placeholder: 'Por ejemplo: DRA. YELITXA BLASINO',
    oninput: () => {
      s.doctor = doctor.value;
      app.cambio();
    },
    onchange: () => recordarDoctor(app, doctor.value),
    onkeydown: (e) => e.key === 'Enter' && app.siguiente(),
  });

  const formulario = h('div', { class: 'formulario' },
    h('div', { class: 'campo' }, h('label', { for: 'campo-paciente' }, 'Nombre del paciente'), nombre),
    h('div', { class: 'campo' }, h('label', { for: 'campo-doctor' }, 'Doctor(a)'), doctor,
      h('datalist', { id: 'doctores-recientes' }, ...doctoresRecientes().map((d) => h('option', { value: d })))),
    h('p', { class: 'nota' }, 'Escriba los nombres como deben aparecer en la presentación. El último doctor(a) usado queda recordado.'),
  );

  let lado;
  if (tarjeta) {
    if (urlTarjeta) URL.revokeObjectURL(urlTarjeta);
    // El archivo original (no la miniatura) para que la letra de la tarjeta se lea bien.
    urlTarjeta = URL.createObjectURL(tarjeta.archivo);
    const imagen = h('img', { class: 'foto-tarjeta', src: urlTarjeta, alt: 'Foto de identificación del paciente con su tarjeta' });
    lado = h('figure', { class: 'tarjeta-identificacion' },
      h('button', { class: 'boton-imagen', type: 'button', title: 'Ver más grande', onclick: () => verGrande(urlTarjeta) }, imagen),
      h('figcaption', {},
        h('span', {}, 'Foto de la tarjeta del paciente'),
        h('button', { class: 'boton secundario pequeno', type: 'button', onclick: () => verGrande(urlTarjeta) }, 'Ver más grande')),
    );
  } else {
    lado = h('div', { class: 'tarjeta-identificacion vacia' },
      h('p', {}, 'No se encontró la foto de la tarjeta con los datos del paciente.'),
      h('p', {}, 'Puede escribir los datos igual.'));
  }

  contenedor.append(h('h1', {}, 'Datos del paciente'), h('div', { class: 'paciente' }, formulario, lado));
  setTimeout(() => (s.paciente ? doctor : nombre).focus(), 0);
}

export function desmontar(app) {
  recordarDoctor(app, app.sesion.doctor || '');
}

// Vista a pantalla completa. Un clic amplía la foto en ese punto (para leer la letra de la
// tarjeta); otro clic la vuelve a ajustar a la pantalla.
function verGrande(url) {
  const anterior = document.activeElement;
  const cerrar = () => {
    capa.remove();
    anterior?.focus?.();
  };
  const imagen = h('img', { src: url, alt: 'Foto de la tarjeta del paciente en grande' });
  const capa = h('div', { class: 'ver-grande', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Foto de la tarjeta en grande' },
    imagen,
    h('div', { class: 'ver-grande-barra' },
      h('p', {}, 'Haga clic en la foto para acercar o alejar'),
      h('button', { class: 'boton principal', type: 'button', onclick: cerrar }, 'Cerrar')),
  );
  let ampliada = false;
  const ajustar = () => {
    const ancho = imagen.naturalWidth || 1;
    const alto = imagen.naturalHeight || 1;
    const encaje = Math.min(window.innerWidth / ancho, window.innerHeight / alto);
    const escala = ampliada ? Math.max(encaje * 2.5, Math.min(1, encaje * 4)) : encaje;
    imagen.style.width = `${Math.round(ancho * escala)}px`;
    imagen.style.height = `${Math.round(alto * escala)}px`;
    imagen.style.marginTop = ampliada ? '0' : `${Math.max(0, (window.innerHeight - alto * escala) / 2)}px`;
    capa.classList.toggle('ampliada', ampliada);
  };
  imagen.addEventListener('load', ajustar);
  imagen.addEventListener('click', (e) => {
    const caja = imagen.getBoundingClientRect();
    const fx = (e.clientX - caja.left) / caja.width;
    const fy = (e.clientY - caja.top) / caja.height;
    ampliada = !ampliada;
    ajustar();
    if (ampliada) {
      capa.scrollLeft = fx * imagen.offsetWidth - window.innerWidth / 2;
      capa.scrollTop = fy * imagen.offsetHeight - window.innerHeight / 2;
    }
  });
  capa.addEventListener('keydown', (e) => e.key === 'Escape' && cerrar());
  document.body.append(capa);
  if (imagen.complete) ajustar();
  capa.querySelector('button').focus();
}
