// Utilidades compartidas por las pantallas: creación de elementos, selector de tipo,
// volteo efectivo de un espacio, dibujo de un recorte y caché de imágenes para mostrar.
import { TIPOS, ESPACIOS, volteoDe } from '../core/tipos.js';

// Crea un elemento: h('button', { class: 'boton', onclick }, 'Texto', otroNodo).
export function h(etiqueta, atributos = {}, ...hijos) {
  const el = document.createElement(etiqueta);
  for (const [clave, valor] of Object.entries(atributos || {})) {
    if (valor == null || valor === false) continue;
    if (clave.startsWith('on') && typeof valor === 'function') el.addEventListener(clave.slice(2), valor);
    else if (clave === 'class') el.className = valor;
    else if (clave === 'dataset') Object.assign(el.dataset, valor);
    else if (clave in el && typeof valor !== 'string') el[clave] = valor;
    else el.setAttribute(clave, valor === true ? '' : valor);
  }
  for (const hijo of hijos.flat()) {
    if (hijo == null || hijo === false) continue;
    el.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
  }
  return el;
}

// Número con coma decimal, como se escribe en español.
export function numero(valor, decimales = 1) {
  return valor.toLocaleString('es', { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
}

// ---------- Volteo ----------
// Volteo predeterminado de una foto: el que propone el análisis para esa foto (`volteoAuto`;
// por ejemplo, una lateral sin espejo no se voltea) o, si no hay, el de su tipo (volteoDe).
// Si el usuario lo cambia en el editor queda guardado en `espacio.volteo` y tiene prioridad.
// Valores: 'ninguno' | 'horizontal' | 'vertical' | 'ambos' ('ambos' = horizontal + vertical).
export function volteoPredeterminado(foto) {
  return foto?.volteoAuto ?? volteoDe(foto?.tipo);
}

export function volteoEfectivo(espacio, foto) {
  return espacio?.volteo ?? volteoPredeterminado(foto);
}

export function volteoTieneH(volteo) {
  return volteo === 'horizontal' || volteo === 'ambos';
}

export function volteoTieneV(volteo) {
  return volteo === 'vertical' || volteo === 'ambos';
}

export function componerVolteo(horizontal, vertical) {
  if (horizontal && vertical) return 'ambos';
  if (horizontal) return 'horizontal';
  if (vertical) return 'vertical';
  return 'ninguno';
}

// ---------- Selector de tipo ----------
// Orden en que se ofrecen los tipos (retratos, intraorales, y al final "No usar").
const ORDEN_TIPOS = [
  'frente_reposo', 'frente_sonrisa', 'perfil_izq', 'perfil_der', 'tres_cuartos',
  'io_frontal', 'io_lateral_1', 'io_lateral_2', 'io_oclusal_inf', 'io_oclusal_sup',
  'identificacion', 'otra',
];

export function selectorTipo(valor, alCambiar, { etiqueta = 'Tipo de foto', sinIdentificacion = false } = {}) {
  const id = 'tipo-' + Math.random().toString(36).slice(2, 9);
  const select = h('select', { id, class: 'selector-tipo' });
  const grupos = { retrato: h('optgroup', { label: 'Retratos' }), intraoral: h('optgroup', { label: 'Intraorales' }), otra: h('optgroup', { label: 'Otras' }) };
  for (const clave of ORDEN_TIPOS) {
    if (sinIdentificacion && clave === 'identificacion' && valor !== 'identificacion') continue;
    const tipo = TIPOS[clave];
    const grupo = clave === 'identificacion' ? grupos.otra : grupos[tipo.grupo] || grupos.otra;
    grupo.append(h('option', { value: clave }, tipo.etiqueta));
  }
  select.append(grupos.retrato, grupos.intraoral, grupos.otra);
  select.value = valor in TIPOS ? valor : 'otra';
  select.addEventListener('change', () => alCambiar(select.value));
  return h('div', { class: 'campo-tipo' }, h('label', { for: id }, etiqueta), select);
}

export function etiquetaTipo(tipo) {
  return TIPOS[tipo]?.etiqueta ?? 'Sin tipo';
}

export function etiquetaEspacio(id) {
  return ESPACIOS.find((e) => e.id === id)?.etiqueta ?? id;
}

// ---------- Dibujo de un recorte ----------
// Dibuja en `canvas` el resultado final de `recorte` (convención del contrato) con el volteo
// aplicado. `imagen` puede estar a cualquier escala: se estira al tamaño completo de la foto.
export function dibujarRecorte(canvas, imagen, foto, recorte, volteo) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  if (!imagen || !recorte) return;
  const k = W / recorte.ancho;
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(W / 2, H / 2);
  ctx.scale(volteoTieneH(volteo) ? -1 : 1, volteoTieneV(volteo) ? -1 : 1);
  ctx.scale(k, k);
  ctx.rotate((-recorte.angulo * Math.PI) / 180);
  ctx.translate(-recorte.cx, -recorte.cy);
  ctx.drawImage(imagen, 0, 0, foto.ancho, foto.alto);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// ---------- Caché de imágenes para mostrar ----------
const miniaturas = new Map(); // fotoId → Promise<HTMLImageElement>
const medias = new Map(); // fotoId → Promise<ImageBitmap> (lado mayor LADO_MEDIO)
const LADO_MEDIO = 1600;
const MAX_MEDIAS = 12;

export function cargarMiniatura(foto) {
  if (!miniaturas.has(foto.id)) {
    miniaturas.set(foto.id, new Promise((ok, mal) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = mal;
      img.src = foto.miniaturaUrl;
    }));
  }
  return miniaturas.get(foto.id);
}

// Copia de tamaño medio (para el editor y las vistas previas nítidas). Se libera la imagen
// completa enseguida para no acumular lienzos grandes en memoria.
export function cargarImagenMedia(foto, api) {
  if (medias.has(foto.id)) {
    const p = medias.get(foto.id);
    medias.delete(foto.id);
    medias.set(foto.id, p); // la más usada pasa al final
    return p;
  }
  const promesa = (async () => {
    const completa = await api.cargarImagenCompleta(foto);
    const escala = Math.min(1, LADO_MEDIO / Math.max(completa.width, completa.height));
    if (escala === 1) return completa;
    const media = await createImageBitmap(completa, {
      resizeWidth: Math.round(completa.width * escala),
      resizeHeight: Math.round(completa.height * escala),
      resizeQuality: 'high',
    });
    completa.close?.();
    return media;
  })();
  promesa.catch(() => medias.delete(foto.id));
  medias.set(foto.id, promesa);
  while (medias.size > MAX_MEDIAS) {
    const [clave, vieja] = medias.entries().next().value;
    medias.delete(clave);
    vieja.then((b) => b.close?.()).catch(() => {});
  }
  return promesa;
}

export function olvidarImagenes() {
  for (const p of medias.values()) p.then((b) => b.close?.()).catch(() => {});
  medias.clear();
  miniaturas.clear();
}

// Dibuja primero con la miniatura (rápido) y luego, si se puede, con la copia media (nítida).
export async function dibujarRecorteProgresivo(canvas, foto, recorte, volteo, api) {
  try {
    dibujarRecorte(canvas, await cargarMiniatura(foto), foto, recorte, volteo);
  } catch (e) {
    console.warn('No se pudo dibujar la miniatura', e);
  }
  try {
    const media = await cargarImagenMedia(foto, api);
    if (canvas.isConnected) dibujarRecorte(canvas, media, foto, recorte, volteo);
  } catch (e) {
    console.warn('No se pudo cargar la imagen media', e);
  }
}

// Tarjeta de foto (miniatura + nombre), base de las cuadrículas.
export function imagenMiniatura(foto, textoAlt) {
  return h('img', { src: foto.miniaturaUrl, alt: textoAlt || foto.nombre, decoding: 'async', draggable: 'false' });
}

// Pregunta con dos botones grandes. Devuelve true si el usuario acepta.
export function preguntar(texto, { si = 'Sí', no = 'No', detalle = null } = {}) {
  return new Promise((ok) => {
    const dialogo = h('dialog', { class: 'dialogo' },
      h('p', { class: 'dialogo-texto' }, texto),
      detalle,
      h('div', { class: 'dialogo-botones' },
        h('button', { class: 'boton secundario', type: 'button', onclick: () => cerrar(false) }, no),
        h('button', { class: 'boton principal', type: 'button', onclick: () => cerrar(true) }, si),
      ),
    );
    function cerrar(valor) {
      dialogo.close();
      dialogo.remove();
      ok(valor);
    }
    dialogo.addEventListener('cancel', (e) => {
      e.preventDefault();
      cerrar(false);
    });
    document.body.append(dialogo);
    dialogo.showModal();
  });
}

// Descarga un archivo con el navegador (respaldo cuando no se puede elegir carpeta).
export function descargar(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: nombre, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Quita los caracteres que Windows no acepta en nombres de archivo.
export function nombreSeguro(texto) {
  return texto.replace(/[\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
}

export function hayCarpetas() {
  return typeof window.showDirectoryPicker === 'function';
}
