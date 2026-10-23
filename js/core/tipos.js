// Tipos de foto, espacios de la presentación y reglas fijas (sección 5 de la especificación).
// Módulo compartido por el análisis, la interfaz y la exportación. Sin dependencias.

export const PROPORCION_RETRATO = 5 / 7; // ancho / alto (vertical)
export const PROPORCION_INTRAORAL = 4 / 3; // ancho / alto (horizontal)

// Tipos que puede tener una foto.
export const TIPOS = {
  identificacion: { etiqueta: 'Foto de identificación', grupo: 'retrato', proporcion: null, volteo: 'ninguno' },
  frente_reposo: { etiqueta: 'Frente en reposo', grupo: 'retrato', proporcion: PROPORCION_RETRATO, volteo: 'ninguno' },
  frente_sonrisa: { etiqueta: 'Frente sonriendo', grupo: 'retrato', proporcion: PROPORCION_RETRATO, volteo: 'ninguno' },
  // "izq"/"der" = hacia dónde mira la cara (la nariz) dentro de la imagen.
  perfil_izq: { etiqueta: 'Perfil (mira a la izquierda)', grupo: 'retrato', proporcion: PROPORCION_RETRATO, volteo: 'ninguno' },
  perfil_der: { etiqueta: 'Perfil (mira a la derecha)', grupo: 'retrato', proporcion: PROPORCION_RETRATO, volteo: 'ninguno' },
  tres_cuartos: { etiqueta: 'Tres cuartos', grupo: 'retrato', proporcion: PROPORCION_RETRATO, volteo: 'ninguno' },
  io_frontal: { etiqueta: 'Intraoral frontal', grupo: 'intraoral', proporcion: PROPORCION_INTRAORAL, volteo: 'ninguno' },
  io_lateral_1: { etiqueta: 'Intraoral lateral 1', grupo: 'intraoral', proporcion: PROPORCION_INTRAORAL, volteo: 'horizontal' },
  io_lateral_2: { etiqueta: 'Intraoral lateral 2', grupo: 'intraoral', proporcion: PROPORCION_INTRAORAL, volteo: 'horizontal' },
  io_oclusal_inf: { etiqueta: 'Oclusal inferior', grupo: 'intraoral', proporcion: PROPORCION_INTRAORAL, volteo: 'vertical' },
  io_oclusal_sup: { etiqueta: 'Oclusal superior', grupo: 'intraoral', proporcion: PROPORCION_INTRAORAL, volteo: 'horizontal' },
  otra: { etiqueta: 'No usar', grupo: 'otra', proporcion: null, volteo: 'ninguno' },
};

// Orden de captura de las intraorales (igual en los 5 pacientes de referencia).
export const ORDEN_INTRAORAL = ['io_frontal', 'io_lateral_1', 'io_lateral_2', 'io_oclusal_inf', 'io_oclusal_sup'];

// Espacios de salida, en el orden de numeración de los archivos (sección 7.5).
// `tipos`: tipos de foto que pueden ocupar el espacio (el primero es el preferido).
// `lugar`: posición en la presentación, o null si no va en ella.
export const ESPACIOS = [
  { id: 'reposo', etiqueta: 'Frente en reposo', tipos: ['frente_reposo'], lugar: { diapositiva: 1, posicion: 'izquierda' } },
  { id: 'sonrisa', etiqueta: 'Frente sonriendo', tipos: ['frente_sonrisa'], lugar: { diapositiva: 1, posicion: 'centro' } },
  // Pendiente de confirmar con el doctor: en las referencias eligió perfiles de ambos lados.
  { id: 'perfil', etiqueta: 'Perfil', tipos: ['perfil_izq', 'perfil_der'], lugar: { diapositiva: 1, posicion: 'derecha' } },
  { id: 'io_lateral_1', etiqueta: 'Lateral 1', tipos: ['io_lateral_1'], lugar: { diapositiva: 2, posicion: 'arriba_izquierda' } },
  { id: 'io_frontal', etiqueta: 'Frontal', tipos: ['io_frontal'], lugar: { diapositiva: 2, posicion: 'arriba_centro' } },
  { id: 'io_lateral_2', etiqueta: 'Lateral 2', tipos: ['io_lateral_2'], lugar: { diapositiva: 2, posicion: 'arriba_derecha' } },
  { id: 'io_oclusal_inf', etiqueta: 'Oclusal inferior', tipos: ['io_oclusal_inf'], lugar: { diapositiva: 2, posicion: 'abajo_izquierda' } },
  { id: 'io_oclusal_sup', etiqueta: 'Oclusal superior', tipos: ['io_oclusal_sup'], lugar: { diapositiva: 2, posicion: 'abajo_derecha' } },
  { id: 'tres_cuartos', etiqueta: 'Tres cuartos (extra)', tipos: ['tres_cuartos'], lugar: null },
];

export function espacioDeTipo(tipo) {
  return ESPACIOS.find((e) => e.tipos.includes(tipo)) || null;
}

export function proporcionDe(tipo) {
  return TIPOS[tipo]?.proporcion ?? null;
}

export function volteoDe(tipo) {
  return TIPOS[tipo]?.volteo ?? 'ninguno';
}

export function seRecorta(tipo) {
  return proporcionDe(tipo) != null;
}
