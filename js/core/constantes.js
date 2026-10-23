// GENERADO por tools/calibrar.mjs el 2026-10-23. No editar a mano: volver a calibrar.
// Constantes del análisis medidas sobre los recortes de referencia del doctor
// (datos_recortes_referencia.json, 5 pacientes). Ver tools/resultados/calibracion.md.
export const CONSTANTES = {
  "generado": "2026-10-23",
  "clasificacion": {
    "umbralSonrisa": 0.5,
    "yawTresCuartos": 20,
    "yawPerfil": 65,
    "rosaMaxRetrato": 0.4,
    "rosaMinIntraoral": 0.28
  },
  "vistas": {
    "temperatura": 1,
    "rasgos": [
      "asimetria",
      "cxDientes",
      "cxGrandes",
      "bordeDer",
      "bordeIzq",
      "centroVacio",
      "oscArriba",
      "altoDientes",
      "oscEsquinas"
    ],
    "clases": {
      "io_frontal": {
        "media": [
          0.0864,
          0.4099,
          0.4076,
          0.0062,
          0.0074,
          0.6967,
          0.0894,
          0.3877,
          0.3315
        ],
        "desvio": [
          0.0217,
          0.1456,
          0.1382,
          0.015,
          0.015,
          0.2699,
          0.0759,
          0.2199,
          0.1977
        ]
      },
      "io_lateral_1": {
        "media": [
          0.2621,
          0.3416,
          0.2913,
          0.0318,
          0.0091,
          0.7066,
          0.1451,
          0.3859,
          0.1717
        ],
        "desvio": [
          0.0482,
          0.0953,
          0.0751,
          0.015,
          0.0163,
          0.1422,
          0.1477,
          0.1675,
          0.1349
        ]
      },
      "io_lateral_2": {
        "media": [
          0.2593,
          0.6062,
          0.6442,
          0.0014,
          0.0272,
          0.6138,
          0.1223,
          0.2415,
          0.1492
        ],
        "desvio": [
          0.0347,
          0.0853,
          0.0963,
          0.015,
          0.0197,
          0.1423,
          0.109,
          0.1211,
          0.0957
        ]
      },
      "io_oclusal_inf": {
        "media": [
          0.1541,
          0.3603,
          0.3893,
          0.0063,
          0.0063,
          0.9309,
          0.2851,
          0.4596,
          0.1316
        ],
        "desvio": [
          0.0334,
          0.1447,
          0.1435,
          0.0167,
          0.015,
          0.0937,
          0.2791,
          0.1618,
          0.1488
        ]
      },
      "io_oclusal_sup": {
        "media": [
          0.1334,
          0.5497,
          0.5888,
          0.0111,
          0.0153,
          0.9548,
          0.7403,
          0.5002,
          0.3033
        ],
        "desvio": [
          0.0292,
          0.1514,
          0.1088,
          0.015,
          0.0174,
          0.0681,
          0.1799,
          0.0842,
          0.1349
        ]
      }
    }
  },
  "segmentacion": {
    "alfa": 1,
    "ventana": 2,
    "tiempoSinFecha": 0,
    "mezclaUniforme": 0.1,
    "lambda": 10,
    "costoCambio": 1,
    "penalSalto": 8,
    "tau": 0.05,
    "temperatura": 8
  },
  "grupos": {
    "maxSegundos": 60,
    "maxDistancia": 0.15
  },
  "retrato": {
    "frente": {
      "nivelar": true,
      "altoPorMentonArriba": 1.1334,
      "mentonV": 0.906,
      "uCentroDesdeOjos": -0.0067,
      "altoPorOjosMenton": 2.2308
    },
    "tres_cuartos": {
      "nivelar": false,
      "altoPorMentonArriba": 1.268,
      "mentonV": 0.8071,
      "uCentroDesdeNariz": 0.2792,
      "altoPorOjosMenton": 2.5984
    },
    "perfil": {
      "altoPorMentonArriba": 1.1606,
      "mentonV": 0.8793,
      "narizU": 0.0648
    }
  },
  "intraoral": {
    "io_frontal": {
      "fuente": "boca",
      "medida": "max",
      "peso": 1,
      "pesoTam": 1,
      "dx": -0.0015,
      "dy": 0.0084,
      "anchoPorCaja": 0.7657,
      "previo": {
        "cx": 0.506,
        "cy": 0.503,
        "ancho": 0.617
      }
    },
    "io_lateral_1": {
      "fuente": "boca",
      "medida": "max",
      "peso": 1,
      "pesoTam": 1,
      "dx": -0.0623,
      "dy": 0.0254,
      "anchoPorCaja": 0.8309,
      "previo": {
        "cx": 0.465,
        "cy": 0.532,
        "ancho": 0.727
      }
    },
    "io_lateral_2": {
      "fuente": "boca",
      "medida": "max",
      "peso": 1,
      "pesoTam": 1,
      "dx": 0.0662,
      "dy": 0.0288,
      "anchoPorCaja": 0.8444,
      "previo": {
        "cx": 0.548,
        "cy": 0.52,
        "ancho": 0.742
      }
    },
    "io_oclusal_inf": {
      "fuente": "boca",
      "medida": "max",
      "peso": 1,
      "pesoTam": 1,
      "dx": 0.0053,
      "dy": -0.068,
      "anchoPorCaja": 0.9167,
      "previo": {
        "cx": 0.501,
        "cy": 0.437,
        "ancho": 0.82
      }
    },
    "io_oclusal_sup": {
      "fuente": "sueltos",
      "medida": "ancho",
      "peso": 1,
      "pesoTam": 1,
      "dx": -0.0021,
      "dy": -0.0049,
      "anchoPorCaja": 1.2685,
      "previo": {
        "cx": 0.533,
        "cy": 0.473,
        "ancho": 0.773
      }
    }
  },
  "respaldo": {
    "altoRetrato": 0.66,
    "anchoIntraoral": 0.75
  }
};
