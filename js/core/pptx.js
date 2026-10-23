// Presentación .pptx con PptxGenJS (sección 8 de la especificación).
//
// Medidas en EMU tomadas de las 5 presentaciones de referencia (referencia/presentaciones/).
// Los marcos (rectángulos) son idénticos en las 5; las fotos las colocó el doctor a mano y quedan
// a unos pocos miles de EMU de su marco, así que aquí cada foto va centrada en su marco, con la
// altura del marco y el ancho que da su proporción (como en las referencias).
// PptxGenJS toma como EMU cualquier número ≥ 100, así que todo se pasa en EMU.
//
// Espacio sin foto: se deja el marco vacío (así se ve qué falta y se puede pegar a mano).

import { cargarJSZip, cargarPptxGenJS } from './vendor.js';

// Diapositiva 16:9 de 12192000 × 6858000 EMU (13,333 × 7,5 pulgadas) = LAYOUT_WIDE de PptxGenJS.
export const DIAPOSITIVA = { ancho: 12192000, alto: 6858000 };

const RETRATO = { w: 3855600, h: 5400000 };
const INTRAORAL = { w: 3841200, h: 2880000 };

// Marcos por espacio (posición medida en las referencias).
export const MARCOS = {
  reposo: { diapositiva: 1, x: 228599, y: 1080000, ...RETRATO },
  sonrisa: { diapositiva: 1, x: 4168200, y: 1080000, ...RETRATO },
  perfil: { diapositiva: 1, x: 8107801, y: 1080000, ...RETRATO },
  io_lateral_1: { diapositiva: 2, x: 212581, y: 540000, ...INTRAORAL },
  io_frontal: { diapositiva: 2, x: 4147910, y: 540000, ...INTRAORAL },
  io_lateral_2: { diapositiva: 2, x: 8075821, y: 540000, ...INTRAORAL },
  io_oclusal_inf: { diapositiva: 2, x: 1934997, y: 3709058, ...INTRAORAL },
  io_oclusal_sup: { diapositiva: 2, x: 6381315, y: 3709058, ...INTRAORAL },
};

// Cuadros de texto de la diapositiva 1 (Calibri 18 pt, "ajustar la forma al texto").
export const TEXTOS = {
  paciente: { x: 540000, y: 392083, w: 4193365, h: 369332 },
  doctor: { x: 7635564, y: 338295, w: 4193365, h: 369332 },
};

const FUENTE = 'Calibri';
const TAMANO_PT = 18;
const LINEA_MARCO_PT = 1; // 12700 EMU: estilo de línea 2 del tema de Office (lnRef idx="2")
const IDIOMA = 'es-VE';

/**
 * @param {{ paciente: string, doctor: string, imagenes: Object<string, Blob>, extras?: Blob[] }} datos
 * @returns {Promise<Blob>} archivo .pptx
 */
export async function crearPresentacion({ paciente, doctor, imagenes = {}, extras = [] }) {
  const PptxGenJS = await cargarPptxGenJS();
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.theme = { headFontFace: 'Calibri Light', bodyFontFace: FUENTE };
  pptx.title = `Paciente: ${String(paciente ?? '').trim()}`;

  // Diapositiva 1: retratos.
  const d1 = nuevaDiapositiva(pptx);
  d1.addText([
    { text: 'PACIENTE', options: { bold: false } },
    { text: `: ${mayusculas(paciente)}`, options: { bold: true } },
  ], opcionesTexto(TEXTOS.paciente));
  d1.addText([
    { text: mayusculas(doctor), options: { bold: true } },
  ], opcionesTexto(TEXTOS.doctor));

  // Diapositiva 2: intraorales.
  const d2 = nuevaDiapositiva(pptx);
  const diapositivas = { 1: d1, 2: d2 };

  for (const [espacioId, marco] of Object.entries(MARCOS)) {
    const diapositiva = diapositivas[marco.diapositiva];
    const blob = imagenes[espacioId];
    if (blob) {
      const img = await prepararImagen(blob);
      diapositiva.addImage({ data: img.data, ...encajarEnMarco(img.ancho / img.alto, marco) });
    }
    diapositiva.addShape(pptx.ShapeType.rect, {
      x: marco.x, y: marco.y, w: marco.w, h: marco.h,
      line: { color: pptx.SchemeColor.text1, width: LINEA_MARCO_PT },
    });
  }

  // Diapositivas 3 en adelante: imágenes adicionales a la altura completa, centradas.
  for (const blob of extras) {
    const img = await prepararImagen(blob);
    const d = nuevaDiapositiva(pptx);
    d.addImage({ data: img.data, ...encajarEnDiapositiva(img.ancho / img.alto) });
  }

  const datos = await pptx.write({ outputType: 'arraybuffer' });
  return await corregirPaquete(datos);
}

const TIPO_PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/**
 * Arreglo sobre el XML que genera PptxGenJS 4.0.1:
 * con varios trozos de texto en un mismo párrafo ("PACIENTE" + ": NOMBRE") escribe un <a:pPr>
 * delante de cada trozo, y el esquema solo admite uno al principio del párrafo. Se deja solo el
 * del principio.
 */
async function corregirPaquete(datos) {
  const JSZip = await cargarJSZip();
  const zip = await JSZip.loadAsync(datos);
  const diapositivas = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  for (const nombre of diapositivas) {
    const xml = await zip.file(nombre).async('string');
    zip.file(nombre, corregirXmlDiapositiva(xml));
  }
  return await zip.generateAsync({ type: 'blob', mimeType: TIPO_PPTX, compression: 'DEFLATE' });
}

/** Ver corregirPaquete. Exportada para las pruebas. */
export function corregirXmlDiapositiva(xml) {
  return xml.replace(/<a:p>([\s\S]*?)<\/a:p>/g, (parrafo, cuerpo) => {
    const primerRun = cuerpo.search(/<a:(r|br|fld)>/);
    if (primerRun < 0) return parrafo;
    const resto = cuerpo.slice(primerRun).replace(/<a:pPr\b[^>]*\/>|<a:pPr\b[^>]*>[\s\S]*?<\/a:pPr>/g, '');
    return `<a:p>${cuerpo.slice(0, primerRun)}${resto}</a:p>`;
  });
}

function nuevaDiapositiva(pptx) {
  const d = pptx.addSlide();
  d.background = { color: 'FFFFFF' };
  return d;
}

function opcionesTexto(caja) {
  return {
    x: caja.x, y: caja.y, w: caja.w, h: caja.h,
    fontFace: FUENTE, fontSize: TAMANO_PT, color: '000000', lang: IDIOMA,
    align: 'left', valign: 'top', fit: 'resize', wrap: true,
  };
}

/** Mayúsculas conservando tildes ("José Pérez" → "JOSÉ PÉREZ"). */
export function mayusculas(texto) {
  return String(texto ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleUpperCase('es');
}

/**
 * Caja de la foto dentro de su marco: misma altura que el marco y ancho según su proporción,
 * centrada en el marco (así están en las referencias: la foto 5:7 mide 3857143 EMU de ancho en
 * un marco de 3855600). Si la proporción se aparta más de un 1 % de la del marco, la foto se
 * encaja entera dentro del marco (sin deformarla).
 */
export function encajarEnMarco(proporcion, marco) {
  const propMarco = marco.w / marco.h;
  let w;
  let h;
  if (Math.abs(proporcion / propMarco - 1) <= 0.01) {
    h = marco.h;
    w = marco.h * proporcion;
  } else if (proporcion > propMarco) {
    w = marco.w;
    h = marco.w / proporcion;
  } else {
    h = marco.h;
    w = marco.h * proporcion;
  }
  return {
    x: Math.round(marco.x + (marco.w - w) / 2),
    y: Math.round(marco.y + (marco.h - h) / 2),
    w: Math.round(w),
    h: Math.round(h),
  };
}

/** Altura completa de la diapositiva, centrada en horizontal (o ancho completo si es muy ancha). */
export function encajarEnDiapositiva(proporcion) {
  let h = DIAPOSITIVA.alto;
  let w = h * proporcion;
  if (w > DIAPOSITIVA.ancho) { w = DIAPOSITIVA.ancho; h = w / proporcion; }
  return {
    x: Math.round((DIAPOSITIVA.ancho - w) / 2),
    y: Math.round((DIAPOSITIVA.alto - h) / 2),
    w: Math.round(w),
    h: Math.round(h),
  };
}

// ---------------------------------------------------------------------------------------------
// Imágenes

/**
 * Lee el tamaño de la imagen (de la cabecera, sin decodificarla) y la pasa a data URL.
 * PowerPoint no aplica la orientación EXIF: un JPEG con orientación ≠ 1 se reescribe ya girado.
 * Formatos que PowerPoint no admite bien (WebP, AVIF, BMP…) se convierten a PNG en el navegador.
 */
async function prepararImagen(blob) {
  let bytes = new Uint8Array(await blob.arrayBuffer());
  let info = tamanoDeCabecera(bytes);
  const girada = info?.tipo === 'jpeg' && info.orientacion > 1;
  if ((!info || girada) && typeof createImageBitmap === 'function') {
    const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    try {
      const lienzo = new OffscreenCanvas(bmp.width, bmp.height);
      lienzo.getContext('2d').drawImage(bmp, 0, 0);
      const tipo = girada ? 'jpeg' : 'png';
      const nuevo = await lienzo.convertToBlob({ type: `image/${tipo}`, quality: 0.95 });
      lienzo.width = 0; lienzo.height = 0;
      bytes = new Uint8Array(await nuevo.arrayBuffer());
      info = { tipo, ancho: bmp.width, alto: bmp.height };
    } finally {
      bmp.close();
    }
  }
  if (!info) throw new Error('Formato de imagen no reconocido');
  return { ...info, data: `data:image/${info.tipo};base64,${aBase64(bytes)}` };
}

function aBase64(bytes) {
  let texto = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    texto += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(texto);
}

/**
 * Tamaño en píxeles tal como se verá (JPEG con orientación EXIF 5..8 → ancho y alto cambiados).
 * @returns {{tipo:'jpeg'|'png'|'gif', ancho:number, alto:number, orientacion?:number}|null}
 */
export function tamanoDeCabecera(b) {
  // PNG
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { tipo: 'png', ancho: v.getUint32(16), alto: v.getUint32(20) };
  }
  // GIF
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return { tipo: 'gif', ancho: b[6] | (b[7] << 8), alto: b[8] | (b[9] << 8) };
  }
  // JPEG
  if (b[0] === 0xff && b[1] === 0xd8) {
    let orientacion = 1;
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      const largo = (b[i + 2] << 8) | b[i + 3];
      if (m === 0xe1) orientacion = orientacionExif(b, i + 4, largo - 2) || orientacion;
      if ((m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        const alto = (b[i + 5] << 8) | b[i + 6];
        const ancho = (b[i + 7] << 8) | b[i + 8];
        return orientacion >= 5
          ? { tipo: 'jpeg', ancho: alto, alto: ancho, orientacion }
          : { tipo: 'jpeg', ancho, alto, orientacion };
      }
      i += 2 + largo;
    }
  }
  return null;
}

function orientacionExif(b, inicio, largo) {
  try {
    if (String.fromCharCode(b[inicio], b[inicio + 1], b[inicio + 2], b[inicio + 3]) !== 'Exif') return 0;
    const t = inicio + 6;
    const v = new DataView(b.buffer, b.byteOffset + t, Math.min(largo - 6, b.length - t));
    const le = v.getUint16(0) === 0x4949;
    const ifd = v.getUint32(4, le);
    const n = v.getUint16(ifd, le);
    for (let k = 0; k < n; k++) {
      const e = ifd + 2 + k * 12;
      if (v.getUint16(e, le) === 0x0112) return v.getUint16(e + 8, le);
    }
  } catch { /* EXIF roto: sin orientación */ }
  return 0;
}
