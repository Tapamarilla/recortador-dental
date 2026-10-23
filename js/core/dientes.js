// Máscara y cajas de dientes y encías (fotos intraorales), y rasgos para reconocer la vista.
// Funciones puras sobre un ImageData pequeño ({ data, width, height }), sin DOM.

const r4 = (v) => Math.round(v * 1e4) / 1e4;

export const DIENTE = 1, MUCOSA = 2;

// Clasifica cada píxel: 1 = diente (claro, poco saturado, tono marfil: el verde casi igual al rojo y
// el azul menor; los brillos del labio y el plástico de los retractores son neutros o rosados),
// 2 = encía/mucosa/labio (rosa o rojo saturado), 0 = otra cosa. El umbral de brillo se adapta a la
// exposición de la foto (percentil 97, porque los dientes suelen ser lo más claro).
export function mascaraDientes(img) {
  const { data, width: w, height: h } = img;
  const n = w * h;
  const V = new Uint8Array(n);
  const hist = new Uint32Array(256);
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    const v = Math.max(data[i], data[i + 1], data[i + 2]);
    V[j] = v; hist[v]++;
  }
  let acum = 0, p97 = 255;
  for (let v = 0; v < 256; v++) { acum += hist[v]; if (acum >= n * 0.97) { p97 = v; break; } }
  const umbralV = Math.max(90, p97 * 0.6);
  const m = new Uint8Array(n);
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const max = V[j], min = Math.min(r, g, b);
    const sat = max ? (max - min) / max : 0;
    if (max >= umbralV && sat < 0.4 && g >= 0.75 * r && b <= 0.97 * g) m[j] = DIENTE;
    else if (r > 70 && sat > 0.25 && r > g * 1.2 && r > b * 1.05) m[j] = MUCOSA;
  }
  return m;
}

// Componentes conexas (4 vecinos) de los píxeles con valor `clase`. Devuelve la etiqueta de cada
// píxel (0 = ninguna) y, por componente, { n, x0, y0, x1, y1, borde } (borde = píxeles en el borde
// de la imagen).
export function componentes(m, w, h, clase = 1) {
  const etiqueta = new Int32Array(w * h);
  const comps = [null];
  const pila = new Int32Array(w * h);
  for (let inicio = 0; inicio < w * h; inicio++) {
    if (m[inicio] !== clase || etiqueta[inicio]) continue;
    const id = comps.length;
    const c = { n: 0, x0: w, y0: h, x1: -1, y1: -1, borde: 0 };
    let tope = 0;
    pila[tope++] = inicio; etiqueta[inicio] = id;
    while (tope) {
      const k = pila[--tope];
      const x = k % w, y = (k / w) | 0;
      c.n++;
      if (x < c.x0) c.x0 = x;
      if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y;
      if (y > c.y1) c.y1 = y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) c.borde++;
      if (x > 0 && m[k - 1] === clase && !etiqueta[k - 1]) { etiqueta[k - 1] = id; pila[tope++] = k - 1; }
      if (x < w - 1 && m[k + 1] === clase && !etiqueta[k + 1]) { etiqueta[k + 1] = id; pila[tope++] = k + 1; }
      if (y > 0 && m[k - w] === clase && !etiqueta[k - w]) { etiqueta[k - w] = id; pila[tope++] = k - w; }
      if (y < h - 1 && m[k + w] === clase && !etiqueta[k + w]) { etiqueta[k + w] = id; pila[tope++] = k + w; }
    }
    comps.push(c);
  }
  return { etiqueta, comps };
}

// Erosiona una máscara binaria con un cuadrado de lado 2r+1.
function erosionar(mask, w, h, r) {
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let ok = 1;
      for (let dx = x - r; dx <= x + r && ok; dx++) if (dx < 0 || dx >= w || !mask[y * w + dx]) ok = 0;
      tmp[y * w + x] = ok;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let ok = 1;
      for (let dy = y - r; dy <= y + r && ok; dy++) if (dy < 0 || dy >= h || !tmp[dy * w + x]) ok = 0;
      out[y * w + x] = ok;
    }
  }
  return out;
}

// Dientes "limpios": descarta lo que toca el borde de la foto (retractores, labios, dientes fuera
// del espejo, arcada opuesta). Antes de buscar manchas se erosiona la máscara para cortar los
// puentes finos (brillos del labio, borde del retractor) que unen los dientes con el borde; las
// manchas que quedan se reconstruyen dentro de la máscara original.
export function dientesLimpios(m, w, h, r = 2) {
  const n = w * h;
  const base = new Uint8Array(n);
  for (let k = 0; k < n; k++) if (m[k] === DIENTE) base[k] = 1;
  const ero = erosionar(base, w, h, r);
  const { etiqueta, comps } = componentes(ero, w, h, 1);
  // Erosionado con r, tocar el borde = estar a menos de r + 1 píxeles del borde de la foto.
  const vale = comps.map((c) => c && c.n >= 2 && c.x0 > r && c.y0 > r && c.x1 < w - 1 - r && c.y1 < h - 1 - r);
  let semilla = new Uint8Array(n);
  for (let k = 0; k < n; k++) if (vale[etiqueta[k]]) semilla[k] = 1;
  // Reconstrucción: dilatar r + 1 pasos sin salir de la máscara original.
  const limpio = semilla;
  for (let paso = 0; paso <= r; paso++) {
    const prev = limpio.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const k = y * w + x;
        if (prev[k] || !base[k]) continue;
        if ((x > 0 && prev[k - 1]) || (x < w - 1 && prev[k + 1]) || (y > 0 && prev[k - w]) || (y < h - 1 && prev[k + w])) limpio[k] = 1;
      }
    }
  }
  semilla = null;
  return { limpio };
}

// Caja normalizada entre los percentiles q y 1 − q de los píxeles marcados (null si hay pocos).
export function cajaPercentil(mask, w, h, q = 0.05) {
  const hx = new Uint32Array(w), hy = new Uint32Array(h);
  let n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      hx[x]++; hy[y]++; n++;
    }
  }
  if (n < 20) return null;
  const P = (hist, qq) => { let a = 0; for (let i = 0; i < hist.length; i++) { a += hist[i]; if (a >= n * qq) return i; } return hist.length - 1; };
  return { x0: r4(P(hx, q) / w), y0: r4(P(hy, q) / h), x1: r4((P(hx, 1 - q) + 1) / w), y1: r4((P(hy, 1 - q) + 1) / h) };
}

// Dilata una máscara binaria con un cuadrado de lado 2r+1.
function dilatar(mask, w, h, r) {
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      for (let dx = Math.max(0, x - r); dx <= Math.min(w - 1, x + r); dx++) tmp[y * w + dx] = 1;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!tmp[y * w + x]) continue;
      for (let dy = Math.max(0, y - r); dy <= Math.min(h - 1, y + r); dy++) out[dy * w + x] = 1;
    }
  }
  return out;
}

// Arcada principal: los dientes de una arcada quedan casi pegados entre sí, así que al dilatar un
// poco la máscara forman una sola mancha; los de la arcada opuesta o fuera del espejo quedan
// separados. Devuelve la máscara de los dientes limpios que caen en la mancha más grande.
export function arcadaPrincipal(limpio, w, h, r = 6) {
  const dil = dilatar(limpio, w, h, r);
  const { etiqueta, comps } = componentes(dil, w, h, 1);
  // La mancha que más dientes contiene (no la más grande dilatada).
  const cuenta = new Array(comps.length).fill(0);
  for (let k = 0; k < w * h; k++) if (limpio[k]) cuenta[etiqueta[k]]++;
  let id = 0;
  for (let i = 1; i < comps.length; i++) if (cuenta[i] > cuenta[id]) id = i;
  const out = new Uint8Array(w * h);
  if (!id) return out;
  for (let k = 0; k < w * h; k++) if (limpio[k] && etiqueta[k] === id) out[k] = 1;
  return out;
}

// Manchas de diente sueltas: las manchas de la máscara (sin erosionar) que no tocan el borde y no
// son enormes. Más estricta que dientesLimpios (pierde los dientes unidos al borde por un brillo),
// pero sus manchas siguen siendo dientes sueltos, que es lo que miden los rasgos de la vista.
export function manchasSueltas(m, w, h) {
  const { etiqueta, comps } = componentes(m, w, h, DIENTE);
  const vale = comps.map((c) => c && c.borde === 0 && c.n >= 4 && c.n < 0.06 * w * h);
  const sueltas = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) if (vale[etiqueta[k]]) sueltas[k] = 1;
  return sueltas;
}

// Rasgos intraorales de una foto: cajas candidatas para el recorte y rasgos de la vista.
//   dientes: caja de los dientes limpios.
//   sueltos: caja de las manchas de diente sueltas.
//   arco: caja de la arcada principal (sin la arcada opuesta ni los dientes fuera del espejo).
//   boca: caja de dientes limpios + encía/mucosa (todo lo rosado, incluido el labio interno).
export function rasgosDientes(img) {
  const { width: w, height: h } = img;
  const n = w * h;
  const m = mascaraDientes(img);
  const { limpio } = dientesLimpios(m, w, h);
  const sueltas = manchasSueltas(m, w, h);
  const boca = new Uint8Array(n);
  let nd = 0;
  for (let k = 0; k < n; k++) {
    if (limpio[k]) nd++;
    if (limpio[k] || m[k] === MUCOSA) boca[k] = 1;
  }
  return {
    frac: r4(nd / n),
    dientes: cajaPercentil(limpio, w, h, 0.05),
    sueltos: cajaPercentil(sueltas, w, h, 0.05),
    arco: cajaPercentil(arcadaPrincipal(limpio, w, h), w, h, 0.02),
    boca: cajaPercentil(boca, w, h, 0.05),
    vista: rasgosVista(img, m, sueltas),
  };
}

// Rasgos para reconocer la vista intraoral (frontal, lateral, oclusal) sin depender del orden.
export function rasgosVista(img, m, limpio) {
  const { data, width: w, height: h } = img;
  const n = w * h;
  // Dientes que tocan el borde izquierdo o derecho (dientes reales fuera del espejo en laterales)
  // o el de abajo (arcada opuesta en oclusales).
  const { etiqueta, comps } = componentes(m, w, h, DIENTE);
  let bordeIzq = 0, bordeDer = 0, bordeAbajo = 0;
  for (let k = 0; k < n; k++) {
    const c = comps[etiqueta[k]];
    if (!c || !c.borde || c.n >= 0.06 * n) continue;
    if (c.x0 === 0) bordeIzq++;
    if (c.x1 === w - 1) bordeDer++;
    if (c.y1 === h - 1) bordeAbajo++;
  }
  const hx = new Float64Array(w), hy = new Float64Array(h);
  let t = 0, centro = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!limpio[y * w + x]) continue;
      hx[x]++; hy[y]++; t++;
      // Zona central de la mitad de abajo: vacía en las oclusales (paladar o lengua).
      if (y > h * 0.45 && x > w * 0.35 && x < w * 0.65) centro++;
    }
  }
  const pc = (hist, q) => { let a = 0; for (let i = 0; i < hist.length; i++) { a += hist[i]; if (a >= t * q) return i / hist.length; } return 1; };
  // Centro horizontal de los dientes pesando cada mancha por su área al cuadrado: domina la zona
  // de los dientes grandes (incisivos y canino). En la lateral 1 quedan a la izquierda del espejo;
  // en la lateral 2, a la derecha.
  let g1 = 0, g0 = 0;
  for (const c of componentes(limpio, w, h, 1).comps) {
    if (!c) continue;
    g1 += ((c.x0 + c.x1 + 1) / 2 / w) * c.n * c.n; g0 += c.n * c.n;
  }
  // Asimetría izquierda-derecha del color (frontal y oclusales son casi simétricas).
  let asim = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w >> 1; x++) {
      const i = (y * w + x) * 4, j = (y * w + (w - 1 - x)) * 4;
      asim += Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) + Math.abs(data[i + 2] - data[j + 2]);
    }
  }
  // Oscuridad en la franja de arriba (nariz/sombra en la oclusal superior) y en las esquinas.
  let oscArriba = 0, oscEsq = 0, nArr = 0, nEsq = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = Math.max(data[i], data[i + 1], data[i + 2]);
      if (y < h * 0.12) { nArr++; if (v < 60) oscArriba++; }
      if ((x < w * 0.15 || x >= w * 0.85) && (y < h * 0.2 || y >= h * 0.8)) { nEsq++; if (v < 60) oscEsq++; }
    }
  }
  return {
    dientes: r4(t / n),
    altoDientes: t ? r4(pc(hy, 0.9) - pc(hy, 0.1)) : 0,
    anchoDientes: t ? r4(pc(hx, 0.9) - pc(hx, 0.1)) : 0,
    cyDientes: t ? r4(pc(hy, 0.5)) : 0.5,
    cxDientes: t ? r4(pc(hx, 0.5)) : 0.5,
    cxGrandes: g0 ? r4(g1 / g0) : 0.5,
    centroVacio: t ? r4(1 - centro / t) : 0.5,
    bordeIzq: r4(bordeIzq / n), bordeDer: r4(bordeDer / n), bordeAbajo: r4(bordeAbajo / n),
    asimetria: r4(asim / (n / 2) / 765),
    oscArriba: r4(oscArriba / nArr), oscEsquinas: r4(oscEsq / nEsq),
  };
}
