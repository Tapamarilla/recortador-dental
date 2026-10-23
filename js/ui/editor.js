// Editor de un recorte (pantalla completa sobre "Revisar recortes").
//
// Cómo se muestra: la foto se dibuja girada para que el marco de recorte se vea siempre
// derecho. Lo que se guarda sigue el contrato: Recorte = { cx, cy, ancho, alto, angulo } en
// píxeles de la foto original orientada, con `angulo` = ángulo del marco dentro del original.
// El ángulo se reparte en dos partes: angulo = k·90 + fino (fotos de celular giradas 90° o 180°).
// "Girar a la izquierda/derecha" cambia k; el deslizador "Enderezar" (−10°…+10°) ajusta solo
// `fino` y muestra cuánto gira la FOTO en pantalla (positivo = sentido del reloj), que es −fino.
//
// El volteo elegido aquí se guarda en `espacio.volteo` ('ninguno' | 'horizontal' | 'vertical' |
// 'ambos') solo si difiere del predeterminado de la foto (volteoAuto ?? volteoDe(tipo)); si no,
// queda `undefined`.
import {
  h, numero, selectorTipo, etiquetaEspacio, dibujarRecorte, cargarMiniatura, cargarImagenMedia,
  volteoEfectivo, volteoPredeterminado, volteoTieneH, volteoTieneV, componerVolteo,
} from './comun.js';

const GIRO_MAX = 10; // grados, ajuste fino alrededor del múltiplo de 90°

// angulo = cuartos·90 + fino, con fino en [−45, 45] y cuartos en −1..2 (−90°, 0°, 90°, 180°).
function partesAngulo(angulo) {
  let cuartos = Math.round(angulo / 90);
  const fino = angulo - cuartos * 90;
  cuartos = ((cuartos % 4) + 4) % 4; // 0..3
  if (cuartos === 3) cuartos = -1;
  return { cuartos, fino };
}
const RADIO_ESQUINA = 34; // px en pantalla; generoso para dedos y para pulso poco firme
const MARGEN = 18;

export function abrirEditor(app, espacioId) {
  return new Promise((resolver) => {
    const editor = new Editor(app, espacioId, resolver);
    editor.abrir();
  });
}

class Editor {
  constructor(app, espacioId, alCerrar) {
    this.app = app;
    this.alCerrar = alCerrar;
    this.historial = [];
    this.arrastre = null;
    this.pendiente = 0;
    this.cargar(espacioId);
  }

  cargar(espacioId) {
    this.espacio = this.app.espacio(espacioId);
    this.foto = this.app.foto(this.espacio.elegida);
    this.trabajo = { recorte: { ...this.espacio.recorte }, volteo: this.espacio.volteo };
    this.historial = [];
    this.imagen = null;
    const foto = this.foto;
    cargarMiniatura(foto).then((img) => {
      if (this.foto === foto && !this.imagen) {
        this.imagen = img;
        this.dibujar();
      }
    }).catch((e) => console.warn(e));
    cargarImagenMedia(foto, this.app.api).then((img) => {
      if (this.foto === foto) {
        this.imagen = img;
        this.dibujar();
      }
    }).catch((e) => console.warn('No se pudo cargar la foto en tamaño medio', e));
  }

  // ---------- Interfaz ----------
  abrir() {
    this.app.editorAbierto = this; // para depurar desde la consola
    this.fondo = [...document.querySelectorAll('body > header, body > main, body > footer')];
    this.fondo.forEach((el) => (el.inert = true));
    this.raiz = h('div', { class: 'editor', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'editor-titulo' });
    document.body.append(this.raiz);
    document.body.classList.add('con-editor');
    this.construir();
    this.raiz.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.listo();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        this.deshacer();
      }
    });
  }

  construir() {
    const ancho = this.trabajo.recorte.ancho;
    const alto = this.trabajo.recorte.alto;
    this.lienzo = h('canvas', {
      class: 'lienzo-editor', tabindex: '0',
      'aria-label': 'Foto con el marco de recorte. Arrastre el marco para moverlo, o una esquina para cambiar su tamaño. También puede usar las flechas del teclado.',
    });
    this.previa = h('canvas', { class: 'vista-previa' });
    const ladoPrevia = 220;
    const ppp = Math.min(2, window.devicePixelRatio || 1);
    const pw = ancho >= alto ? ladoPrevia : Math.round(ladoPrevia * 0.78 * (ancho / alto));
    const ph = Math.round(pw * (alto / ancho));
    this.previa.width = Math.round(pw * ppp);
    this.previa.height = Math.round(ph * ppp);
    this.previa.style.width = pw + 'px';
    this.previa.style.height = ph + 'px';

    this.textoGiro = h('output', { class: 'valor-giro', 'aria-live': 'polite' });
    this.textoCuartos = h('p', { class: 'estado-cuartos', 'aria-live': 'polite' });
    this.deslizador = h('input', {
      type: 'range', min: String(-GIRO_MAX), max: String(GIRO_MAX), step: '0.1', id: 'giro',
      'aria-label': 'Enderezar: grados de giro de la foto',
    });
    let enGesto = false;
    this.deslizador.addEventListener('input', () => {
      if (!enGesto) {
        this.guardarPaso();
        enGesto = true;
      }
      this.girarA(-Number(this.deslizador.value));
    });
    this.deslizador.addEventListener('change', () => (enGesto = false));

    this.botonDeshacer = h('button', { class: 'boton secundario', type: 'button', onclick: () => this.deshacer() }, '↶ Deshacer');
    this.botonH = h('button', { class: 'boton alternar', type: 'button', onclick: () => this.voltear('h') }, 'Voltear horizontal');
    this.botonV = h('button', { class: 'boton alternar', type: 'button', onclick: () => this.voltear('v') }, 'Voltear vertical');
    this.textoVolteo = h('p', { class: 'estado-volteo' });

    this.raiz.replaceChildren(
      h('div', { class: 'editor-barra' },
        h('h1', { id: 'editor-titulo' }, 'Corregir: ', etiquetaEspacio(this.espacio.id)),
        h('div', { class: 'fila-botones' },
          this.botonDeshacer,
          h('button', { class: 'boton secundario', type: 'button', onclick: () => this.restablecer() }, 'Restablecer automático'),
          h('button', { class: 'boton principal', type: 'button', onclick: () => this.listo() }, '✔ Listo'),
        ),
      ),
      h('div', { class: 'editor-cuerpo' },
        h('div', { class: 'editor-zona' },
          h('div', { class: 'editor-lienzo' }, this.lienzo),
          h('p', { class: 'ayuda-lienzo' }, 'Arrastre el marco para moverlo. Arrastre una esquina para agrandarlo o achicarlo.'),
        ),
        h('div', { class: 'editor-panel' },
          h('section', { class: 'panel-previa' }, h('h2', {}, 'Así quedará'), this.previa),
          h('section', {},
            h('h2', {}, h('label', { for: 'giro' }, 'Enderezar')),
            h('div', { class: 'fila-giro' },
              h('button', { class: 'boton secundario', type: 'button', 'aria-label': 'Girar la foto 1 grado a la izquierda', onclick: () => this.girarPaso(-1) }, '−1°'),
              this.textoGiro,
              h('button', { class: 'boton secundario', type: 'button', 'aria-label': 'Girar la foto 1 grado a la derecha', onclick: () => this.girarPaso(1) }, '+1°'),
            ),
            this.deslizador,
            this.textoCuartos,
            h('div', { class: 'fila-cuartos' },
              h('button', { class: 'boton secundario', type: 'button', onclick: () => this.girarCuarto(-1) }, '↺ Girar a la izquierda'),
              h('button', { class: 'boton secundario', type: 'button', onclick: () => this.girarCuarto(1) }, '↻ Girar a la derecha'),
            ),
          ),
          h('section', {}, h('h2', {}, 'Voltear'), h('div', { class: 'fila-volteo' }, this.botonH, this.botonV), this.textoVolteo),
          h('section', {},
            selectorTipo(this.foto.tipo, (tipo) => this.cambiarTipo(tipo), { etiqueta: 'Tipo de foto', sinIdentificacion: true }),
          ),
        ),
      ),
    );

    this.lienzo.addEventListener('pointerdown', (e) => this.alPresionar(e));
    this.lienzo.addEventListener('pointermove', (e) => this.alMover(e));
    this.lienzo.addEventListener('pointerup', (e) => this.alSoltar(e));
    this.lienzo.addEventListener('pointercancel', (e) => this.alSoltar(e));
    this.lienzo.addEventListener('keydown', (e) => this.alTeclear(e));
    this.observador?.disconnect();
    this.observador = new ResizeObserver(() => this.ajustarLienzo());
    this.observador.observe(this.lienzo.parentElement);
    this.actualizarControles();
    this.raiz.querySelector('.boton.principal').focus();
  }

  ajustarLienzo() {
    const caja = this.lienzo.parentElement.getBoundingClientRect();
    const ppp = window.devicePixelRatio || 1;
    this.lienzo.width = Math.max(1, Math.round(caja.width * ppp));
    this.lienzo.height = Math.max(1, Math.round(caja.height * ppp));
    this.lienzo.style.width = caja.width + 'px';
    this.lienzo.style.height = caja.height + 'px';
    this.dibujar();
  }

  actualizarControles() {
    const { cuartos, fino } = partesAngulo(this.trabajo.recorte.angulo);
    const giro = -fino;
    this.deslizador.value = String(Math.round(giro * 10) / 10);
    this.textoGiro.textContent = `${numero(Math.abs(giro) < 0.05 ? 0 : giro)}°`;
    // La foto gira −angulo en pantalla: cuartos = 1 ⇒ 90° a la izquierda.
    this.textoCuartos.textContent = {
      0: 'Foto sin girar.',
      1: 'Foto girada 90° a la izquierda.',
      '-1': 'Foto girada 90° a la derecha.',
      2: 'Foto girada 180° (cabeza abajo).',
    }[cuartos];
    const v = this.volteoActual();
    this.botonH.setAttribute('aria-pressed', String(volteoTieneH(v)));
    this.botonV.setAttribute('aria-pressed', String(volteoTieneV(v)));
    this.textoVolteo.textContent = {
      ninguno: 'Ahora: sin voltear.',
      horizontal: 'Ahora: volteada en horizontal.',
      vertical: 'Ahora: volteada en vertical.',
      ambos: 'Ahora: volteada en horizontal y en vertical.',
    }[v];
    this.botonDeshacer.disabled = !this.historial.length;
    this.dibujar();
  }

  // ---------- Geometría de la vista ----------
  volteoActual() {
    return volteoEfectivo({ volteo: this.trabajo.volteo }, this.foto);
  }

  vista() {
    const W = this.foto.ancho;
    const H = this.foto.alto;
    const a = (this.trabajo.recorte.angulo * Math.PI) / 180;
    const cw = this.lienzo.width / (window.devicePixelRatio || 1);
    const ch = this.lienzo.height / (window.devicePixelRatio || 1);
    const bw = W * Math.abs(Math.cos(a)) + H * Math.abs(Math.sin(a));
    const bh = W * Math.abs(Math.sin(a)) + H * Math.abs(Math.cos(a));
    const s = Math.max(1e-6, Math.min((cw - 2 * MARGEN) / bw, (ch - 2 * MARGEN) / bh));
    return { a, s, ox: cw / 2, oy: ch / 2, icx: W / 2, icy: H / 2 };
  }

  // Imagen (px del original) → pantalla (px CSS del lienzo).
  aPantalla(v, x, y) {
    const dx = x - v.icx;
    const dy = y - v.icy;
    const c = Math.cos(-v.a);
    const s = Math.sin(-v.a);
    return { x: v.ox + v.s * (c * dx - s * dy), y: v.oy + v.s * (s * dx + c * dy) };
  }

  // Pantalla → imagen.
  aImagen(v, X, Y) {
    const qx = (X - v.ox) / v.s;
    const qy = (Y - v.oy) / v.s;
    const c = Math.cos(v.a);
    const s = Math.sin(v.a);
    return { x: v.icx + c * qx - s * qy, y: v.icy + s * qx + c * qy };
  }

  // Marco en pantalla: rectángulo derecho.
  marcoEnPantalla(v) {
    const r = this.trabajo.recorte;
    const c = this.aPantalla(v, r.cx, r.cy);
    const mw = (r.ancho * v.s) / 2;
    const mh = (r.alto * v.s) / 2;
    return { x0: c.x - mw, y0: c.y - mh, x1: c.x + mw, y1: c.y + mh, cx: c.x, cy: c.y };
  }

  esquinas(m) {
    return [{ x: m.x0, y: m.y0 }, { x: m.x1, y: m.y0 }, { x: m.x1, y: m.y1 }, { x: m.x0, y: m.y1 }];
  }

  // ---------- Dibujo ----------
  dibujar() {
    if (this.pendiente) return;
    this.pendiente = requestAnimationFrame(() => {
      this.pendiente = 0;
      this.dibujarAhora();
    });
  }

  dibujarAhora() {
    if (!this.lienzo?.isConnected) return;
    const ctx = this.lienzo.getContext('2d');
    const ppp = window.devicePixelRatio || 1;
    ctx.setTransform(ppp, 0, 0, ppp, 0, 0);
    const cw = this.lienzo.width / ppp;
    const ch = this.lienzo.height / ppp;
    ctx.fillStyle = '#2f3338';
    ctx.fillRect(0, 0, cw, ch);
    const v = this.vista();
    if (this.imagen) {
      ctx.save();
      ctx.translate(v.ox, v.oy);
      ctx.scale(v.s, v.s);
      ctx.rotate(-v.a);
      ctx.translate(-v.icx, -v.icy);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this.imagen, 0, 0, this.foto.ancho, this.foto.alto);
      ctx.restore();
    }
    const m = this.marcoEnPantalla(v);
    // Oscurecer lo que queda fuera del recorte.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.beginPath();
    ctx.rect(0, 0, cw, ch);
    ctx.rect(m.x0, m.y0, m.x1 - m.x0, m.y1 - m.y0);
    ctx.fill('evenodd');
    // Guías de tercios.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 3; i++) {
      const x = m.x0 + ((m.x1 - m.x0) * i) / 3;
      const y = m.y0 + ((m.y1 - m.y0) * i) / 3;
      ctx.moveTo(x, m.y0);
      ctx.lineTo(x, m.y1);
      ctx.moveTo(m.x0, y);
      ctx.lineTo(m.x1, y);
    }
    ctx.stroke();
    // Borde del marco.
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffff';
    ctx.strokeRect(m.x0, m.y0, m.x1 - m.x0, m.y1 - m.y0);
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#000000';
    ctx.strokeRect(m.x0 - 2, m.y0 - 2, m.x1 - m.x0 + 4, m.y1 - m.y0 + 4);
    // Esquinas grandes.
    const L = Math.min(30, (m.x1 - m.x0) / 3, (m.y1 - m.y0) / 3);
    ctx.lineCap = 'square';
    for (const [i, p] of this.esquinas(m).entries()) {
      const sx = i === 0 || i === 3 ? 1 : -1;
      const sy = i < 2 ? 1 : -1;
      for (const [color, ancho] of [['#000000', 11], ['#ffffff', 7]]) {
        ctx.strokeStyle = color;
        ctx.lineWidth = ancho;
        ctx.beginPath();
        ctx.moveTo(p.x + sx * L, p.y);
        ctx.lineTo(p.x, p.y);
        ctx.lineTo(p.x, p.y + sy * L);
        ctx.stroke();
      }
    }
    dibujarRecorte(this.previa, this.imagen, this.foto, this.trabajo.recorte, this.volteoActual());
  }

  // ---------- Restricciones ----------
  extension(r) {
    const a = (r.angulo * Math.PI) / 180;
    const c = Math.abs(Math.cos(a));
    const s = Math.abs(Math.sin(a));
    return { mx: (r.ancho * c + r.alto * s) / 2, my: (r.ancho * s + r.alto * c) / 2 };
  }

  cabe(r) {
    const { mx, my } = this.extension(r);
    const t = 0.5;
    return r.cx - mx >= -t && r.cy - my >= -t && r.cx + mx <= this.foto.ancho + t && r.cy + my <= this.foto.alto + t;
  }

  // Mete el marco dentro de la foto: primero lo achica si no cabe, después lo mueve.
  encajar(r) {
    const W = this.foto.ancho;
    const H = this.foto.alto;
    let { mx, my } = this.extension(r);
    const f = Math.min(1, W / (2 * mx), H / (2 * my));
    if (f < 1) {
      r.ancho *= f;
      r.alto *= f;
      mx *= f;
      my *= f;
    }
    r.cx = Math.min(Math.max(r.cx, mx), W - mx);
    r.cy = Math.min(Math.max(r.cy, my), H - my);
    return r;
  }

  anchoMinimo() {
    const r = this.trabajo.recorte;
    const lado = Math.min(this.foto.ancho, this.foto.alto) * 0.12;
    return r.ancho >= r.alto ? lado : lado * (r.ancho / r.alto);
  }

  // ---------- Acciones ----------
  guardarPaso() {
    this.historial.push({ recorte: { ...this.trabajo.recorte }, volteo: this.trabajo.volteo });
    if (this.historial.length > 200) this.historial.shift();
    this.botonDeshacer.disabled = false;
  }

  deshacer() {
    const paso = this.historial.pop();
    if (!paso) return;
    this.trabajo = { recorte: { ...paso.recorte }, volteo: paso.volteo };
    this.actualizarControles();
  }

  restablecer() {
    this.guardarPaso();
    this.trabajo = { recorte: { ...this.espacio.recorteAuto }, volteo: undefined };
    this.actualizarControles();
  }

  // Fija la parte fina del ángulo del marco (−10…+10) sin tocar el múltiplo de 90°.
  girarA(fino) {
    const { cuartos } = partesAngulo(this.trabajo.recorte.angulo);
    fino = Math.max(-GIRO_MAX, Math.min(GIRO_MAX, Math.round(fino * 10) / 10));
    this.trabajo.recorte.angulo = cuartos * 90 + fino;
    this.encajar(this.trabajo.recorte);
    this.actualizarControles();
  }

  girarPaso(grados) {
    this.guardarPaso();
    // La foto gira +grados ⇒ el marco, −grados.
    this.girarA(partesAngulo(this.trabajo.recorte.angulo).fino - grados);
  }

  // Gira la foto 90° (sentido: −1 izquierda, +1 derecha). El marco conserva su proporción y su
  // centro; si no cabe en la foto girada, se achica.
  girarCuarto(sentido) {
    this.guardarPaso();
    const { cuartos, fino } = partesAngulo(this.trabajo.recorte.angulo);
    const nuevo = partesAngulo((cuartos - sentido) * 90).cuartos; // foto a la derecha ⇒ marco −90°
    const r = this.trabajo.recorte;
    r.angulo = nuevo * 90 + fino;
    // Achicar alrededor del mismo centro hasta que quepa (sin bajar del tamaño mínimo);
    // `encajar` termina de meterlo si el centro está demasiado cerca del borde.
    const { mx, my } = this.extension(r);
    const f = Math.min(1, r.cx / mx, (this.foto.ancho - r.cx) / mx, r.cy / my, (this.foto.alto - r.cy) / my);
    const g = Math.max(f, Math.min(1, this.anchoMinimo() / r.ancho));
    r.ancho *= g;
    r.alto *= g;
    this.encajar(r);
    this.actualizarControles();
  }

  voltear(eje) {
    this.guardarPaso();
    const v = this.volteoActual();
    const hz = eje === 'h' ? !volteoTieneH(v) : volteoTieneH(v);
    const vt = eje === 'v' ? !volteoTieneV(v) : volteoTieneV(v);
    this.trabajo.volteo = componerVolteo(hz, vt);
    this.actualizarControles();
  }

  async cambiarTipo(tipo) {
    const app = this.app;
    const foto = this.foto;
    // reclasificar recalcula foto.volteoAuto (el volteo propuesto) para el tipo nuevo.
    try {
      await app.conEspera('Cambiando el tipo de foto…', () => app.cambiarTipo(foto.id, tipo, { forzarElegida: true }));
    } catch (error) {
      app.fallo(error, 'No se pudo cambiar el tipo de la foto. Intente de nuevo.');
      this.construir();
      return;
    }
    const nuevo = app.sesion.espacios.find((e) => e.elegida === foto.id);
    if (nuevo) nuevo.volteo = undefined;
    if (!nuevo) {
      this.cerrar();
      app.avisar('La foto quedó en «Fotos sin usar». Puede elegir otra en «Elegir tomas».', 'info');
      return;
    }
    this.cargar(nuevo.id);
    this.construir();
    this.ajustarLienzo();
    app.avisar(`La foto ahora está en «${etiquetaEspacio(nuevo.id)}».`, 'info');
  }

  listo() {
    const v = this.volteoActual();
    this.espacio.recorte = { ...this.trabajo.recorte };
    this.espacio.volteo = v === volteoPredeterminado(this.foto) ? undefined : v;
    this.app.cambio();
    this.cerrar();
  }

  cerrar() {
    this.app.editorAbierto = null;
    this.observador?.disconnect();
    this.raiz.remove();
    document.body.classList.remove('con-editor');
    this.fondo.forEach((el) => (el.inert = false));
    this.alCerrar();
  }

  // ---------- Puntero (ratón, lápiz y dedo) ----------
  posicion(e) {
    const caja = this.lienzo.getBoundingClientRect();
    return { x: e.clientX - caja.left, y: e.clientY - caja.top };
  }

  queHay(p) {
    const v = this.vista();
    const m = this.marcoEnPantalla(v);
    const radio = Math.min(RADIO_ESQUINA, (m.x1 - m.x0) / 3, (m.y1 - m.y0) / 3);
    const esquinas = this.esquinas(m);
    for (let i = 0; i < 4; i++) {
      if (Math.hypot(p.x - esquinas[i].x, p.y - esquinas[i].y) <= Math.max(radio, 18)) return { tipo: 'esquina', i, v, m };
    }
    if (p.x >= m.x0 && p.x <= m.x1 && p.y >= m.y0 && p.y <= m.y1) return { tipo: 'mover', v, m };
    return null;
  }

  alPresionar(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const p = this.posicion(e);
    const hit = this.queHay(p);
    if (!hit) return;
    e.preventDefault();
    this.lienzo.setPointerCapture(e.pointerId);
    const antes = { recorte: { ...this.trabajo.recorte }, volteo: this.trabajo.volteo };
    this.arrastre = { ...hit, inicio: p, recorte0: { ...this.trabajo.recorte }, antes, movio: false, id: e.pointerId };
    if (hit.tipo === 'esquina') {
      const esquinas = this.esquinas(hit.m);
      const opuesta = esquinas[(hit.i + 2) % 4];
      const propia = esquinas[hit.i];
      this.arrastre.fija = opuesta;
      this.arrastre.sx = Math.sign(propia.x - opuesta.x) || 1;
      this.arrastre.sy = Math.sign(propia.y - opuesta.y) || 1;
    }
  }

  alMover(e) {
    const p = this.posicion(e);
    const a = this.arrastre;
    if (!a || a.id !== e.pointerId) {
      const hit = this.queHay(p);
      this.lienzo.style.cursor = !hit ? 'default'
        : hit.tipo === 'mover' ? 'move'
          : hit.i % 2 === 0 ? 'nwse-resize' : 'nesw-resize';
      return;
    }
    if (!a.movio) {
      if (Math.hypot(p.x - a.inicio.x, p.y - a.inicio.y) < 2) return;
      a.movio = true;
      this.historial.push(a.antes);
    }
    const v = a.v;
    const r = this.trabajo.recorte;
    if (a.tipo === 'mover') {
      const dX = (p.x - a.inicio.x) / v.s;
      const dY = (p.y - a.inicio.y) / v.s;
      const c = Math.cos(v.a);
      const s = Math.sin(v.a);
      r.cx = a.recorte0.cx + c * dX - s * dY;
      r.cy = a.recorte0.cy + s * dX + c * dY;
      const { mx, my } = this.extension(r);
      r.cx = Math.min(Math.max(r.cx, mx), this.foto.ancho - mx);
      r.cy = Math.min(Math.max(r.cy, my), this.foto.alto - my);
    } else {
      const prop = a.recorte0.ancho / a.recorte0.alto;
      const deseado = Math.max(a.sx * (p.x - a.fija.x), a.sy * (p.y - a.fija.y) * prop) / v.s;
      const minimo = this.anchoMinimo();
      const desde = (ancho) => {
        const alto = ancho / prop;
        const centro = this.aImagen(v, a.fija.x + (a.sx * ancho * v.s) / 2, a.fija.y + (a.sy * alto * v.s) / 2);
        return { cx: centro.x, cy: centro.y, ancho, alto, angulo: r.angulo };
      };
      let ancho = Math.max(minimo, deseado);
      if (!this.cabe(desde(ancho))) {
        // El mayor tamaño que todavía cabe dentro de la foto, con la esquina opuesta fija.
        let bajo = minimo;
        let alto = ancho;
        if (!this.cabe(desde(bajo))) return;
        for (let k = 0; k < 30; k++) {
          const medio = (bajo + alto) / 2;
          if (this.cabe(desde(medio))) bajo = medio;
          else alto = medio;
        }
        ancho = bajo;
      }
      Object.assign(r, desde(ancho));
    }
    this.botonDeshacer.disabled = false;
    this.dibujar();
  }

  alSoltar(e) {
    if (!this.arrastre || this.arrastre.id !== e.pointerId) return;
    this.arrastre = null;
    this.actualizarControles();
  }

  // Teclado: flechas mueven el marco; + y − cambian su tamaño.
  alTeclear(e) {
    const r = this.trabajo.recorte;
    const paso = (e.shiftKey ? 0.05 : 0.01) * this.foto.ancho;
    const movs = { ArrowLeft: [-paso, 0], ArrowRight: [paso, 0], ArrowUp: [0, -paso], ArrowDown: [0, paso] };
    if (movs[e.key]) {
      e.preventDefault();
      this.guardarPaso();
      // Las flechas siguen la pantalla (donde el marco se ve derecho).
      const [dx, dy] = movs[e.key];
      const a = (r.angulo * Math.PI) / 180;
      r.cx += Math.cos(a) * dx - Math.sin(a) * dy;
      r.cy += Math.sin(a) * dx + Math.cos(a) * dy;
      this.encajar(r);
      this.actualizarControles();
    } else if (e.key === '+' || e.key === '-') {
      e.preventDefault();
      this.guardarPaso();
      const f = e.key === '+' ? 1.03 : 1 / 1.03;
      const ancho = Math.max(this.anchoMinimo(), r.ancho * f);
      r.alto *= ancho / r.ancho;
      r.ancho = ancho;
      this.encajar(r);
      this.actualizarControles();
    }
  }
}
