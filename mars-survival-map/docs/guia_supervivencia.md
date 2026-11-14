# Guía de supervivencia en Marte — Mount Sharp

> Guía para jugadores (también sirve como texto para la pantalla de ayuda y el pitch). Cada regla del juego sale de un dato real de NASA; abajo se explica de dónde.

## Tus tres barras
| Barra | Qué la gasta | Cómo recuperarla |
|---|---|---|
| **O₂ Oxígeno** | El tiempo. Caminar cuesta arriba la gasta más rápido. | Rover Tumbo (hasta 60 %), hábitat o Refugio Sur (100 %). |
| **⚡ Energía** | La calefacción del traje. Cuanto más frío el suelo, más gasto. Escanear cuesta 2 %. | Rover, hábitat o Refugio Sur. |
| **⛨ Integridad** | Radiación acumulada y resbalones en pendientes de 18–25°. | No se recupera durante la caminata. ¡Cuídala! |

Si el oxígeno o la integridad llegan a cero, la misión falla. Si la energía llega a cero, el traje entra en modo mínimo: caminas lento y respiras más.

## Las capas de datos (teclas 1–4)
| Tecla | Capa | Cómo leerla | Dato real detrás |
|---|---|---|---|
| 1 | **Pendiente** | Liso = fácil · puntos = lento · **rayas = no se puede pasar (>25°)** | Modelo de elevación HiRISE + CTX (MRO), alineado con Curiosity |
| 2 | **Radiación** | Liso = más protegido · rayas = expuesto | Dosis medida por RAD (Curiosity) + cuánto cielo ves |
| 3 | **Temperatura** | Liso = templado · rayas = muy frío (< −45 °C) | Rango diario de REMS (Curiosity) + inercia térmica de THEMIS (arena o roca) |
| 4 | **Espectral** | Colores = minerales: cian arcillas, lila sulfatos, blanco vetas boxwork, azul dunas | Mapas minerales CRISM (MRO), confirmados por Curiosity |
| R | **Ruta sugerida** | Línea en el minimapa: el camino más seguro, no el más corto | Algoritmo A* sobre todas las capas |

## Cinco reglas para volver vivo
1. **Las rayas mandan.** Si la capa muestra rayas, rodea. Los escalones entre capas de roca casi siempre tienen una rampa cerca.
2. **Media barra = media vuelta.** Cuando el oxígeno baje del 50 %, la vuelta empieza a ser más importante que el siguiente objetivo.
3. **El sol es tu calefactor.** Las laderas orientadas al sol están más calientes; el fondo de los canales y la cara en sombra de los cráteres, mucho más frías.
4. **Tormenta solar = refugio.** Con el aviso tienes 30 segundos. Los refugios (rover Tumbo, hábitat y Refugio Sur) bloquean casi toda la radiación. Si no llegas, mete el cuerpo en un canal o cráter: el terreno tapa parte del cielo.
5. **La Tierra no te va a salvar.** Sus mensajes tardan 14 minutos. Decide con tus capas.

## ¿Es realista?
- **Radiación:** en la superficie de Marte, RAD midió unos 0,21 mGy/día (≈0,64 mSv/día de dosis equivalente), del orden de 100 veces la radiación natural promedio en la Tierra (≈0,007 mSv/día). **En el juego la exageramos** para que se note en una partida de 20 minutos; en la realidad el riesgo es acumulativo durante meses. Las tormentas solares sí pueden multiplicar la dosis de forma brusca, y por eso los planes reales incluyen refugios.
- **Temperatura:** REMS registró en el cráter Gale cambios de temperatura del suelo de más de 80 °C en un solo sol.
- **Pendientes:** los rovers y los astronautas evitan pendientes de más de ~25–30°, donde la arena suelta hace resbalar.
- **Tiempo:** el juego corre 14 veces más rápido que la realidad: 1 segundo real = 14 segundos en Marte.
