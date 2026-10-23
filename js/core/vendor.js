// Carga de las librerías UMD de app/vendor/ (PptxGenJS, JSZip, piexif) desde módulos ES.
//
// Por qué no un `import` directo: esos archivos no son módulos ES. `pptxgen.bundle.js` declara
// `var PptxGenJS` en el ámbito de nivel superior (en un módulo quedaría privado, no global) y
// `piexif.js` asigna `window.piexif` desde código no estricto. Por eso:
//   - En el navegador (hilo principal) se insertan como <script> clásico, una sola vez, y se
//     toma la variable global que dejan (`PptxGenJS`, `JSZip`, `piexif`).
//   - En un worker clásico se usa importScripts; en un worker de módulo, fetch + Function.
//   - En Node (pruebas) se usan los mismos paquetes desde node_modules (misma versión).
// Todas las funciones devuelven una promesa y guardan el resultado (se carga una sola vez).

const BASE = new URL('../../vendor/', import.meta.url);

const LIBRERIAS = {
  PptxGenJS: { archivo: 'pptxgen.bundle.js', global: 'PptxGenJS', paquete: 'pptxgenjs' },
  JSZip: { archivo: 'jszip.min.js', global: 'JSZip', paquete: 'jszip' },
  piexif: { archivo: 'piexif.js', global: 'piexif', paquete: 'piexifjs' },
};

const cargadas = new Map();

const esNode = typeof process !== 'undefined' && !!process.versions?.node && typeof document === 'undefined';

function cargarScript(url) {
  return new Promise((ok, falla) => {
    const s = document.createElement('script');
    s.src = url;
    s.async = false;
    s.onload = () => ok();
    s.onerror = () => falla(new Error(`No se pudo cargar ${url}`));
    document.head.appendChild(s);
  });
}

async function cargarEnNavegador({ archivo, global }) {
  if (globalThis[global]) return globalThis[global];
  const url = new URL(archivo, BASE).href;
  if (typeof document !== 'undefined') {
    await cargarScript(url);
  } else if (typeof importScripts === 'function') {
    importScripts(url); // eslint-disable-line no-undef
  } else {
    // Worker de módulo: se evalúa como script clásico con `window`/`self` apuntando al global.
    const codigo = await (await fetch(url)).text();
    // eslint-disable-next-line no-new-func
    new Function('window', `${codigo}\n;if (typeof ${global} !== 'undefined') self.${global} = ${global};`)(globalThis);
  }
  if (!globalThis[global]) throw new Error(`${archivo} no definió ${global}`);
  return globalThis[global];
}

async function cargarEnNode({ paquete, global }) {
  const modulo = await import(paquete);
  const valor = modulo.default ?? modulo;
  return global === 'piexif' && valor.piexif ? valor.piexif : valor;
}

function cargar(nombre) {
  if (!cargadas.has(nombre)) {
    const lib = LIBRERIAS[nombre];
    const promesa = (esNode ? cargarEnNode(lib) : cargarEnNavegador(lib));
    promesa.catch(() => cargadas.delete(nombre)); // permite reintentar si falló
    cargadas.set(nombre, promesa);
  }
  return cargadas.get(nombre);
}

/** @returns {Promise<any>} el constructor PptxGenJS */
export const cargarPptxGenJS = () => cargar('PptxGenJS');
/** @returns {Promise<any>} el constructor JSZip */
export const cargarJSZip = () => cargar('JSZip');
/** @returns {Promise<any>} el objeto piexif (load, dump, ImageIFD, ExifIFD…) */
export const cargarPiexif = () => cargar('piexif');
