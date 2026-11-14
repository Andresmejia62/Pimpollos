# Historia — Expedición Aeolis-1

## Premisa (en una frase)
Eres **EVA-1**, especialista de superficie de la primera tripulación humana en el cráter Gale, y tienes una caminata de un día para recoger las pruebas de que Marte tuvo agua durante cientos de millones de años, sin morir en el intento.

## Contexto
- **Dónde:** ladera norte del Monte Sharp (Aeolis Mons), en el centro del cráter Gale. Es la misma zona que Curiosity explora desde 2012.
- **Cuándo:** Sol 212 de la expedición, en un futuro cercano. Los humanos llegan a donde el rover ya marcó el camino.
- **Por qué importa:** Curiosity encontró arcillas, sulfatos, azufre puro y boxwork. Cada uno cuenta un capítulo de la historia del agua: lagos, el lento secado y agua subterránea que siguió circulando mucho después. EVA-1 viene a confirmar y muestrear esos capítulos con sus propias manos.
- **Lo que está en juego:** los recursos del traje son limitados, el Sol puede lanzar una tormenta de partículas en cualquier momento y la Tierra contesta con 14 minutos de retraso. Hay que decidir con datos, no con instinto.

## Personajes
| Personaje | Rol | Voz |
|---|---|---|
| **EVA-1** (jugador) | Especialista de superficie. No se le da nombre ni género para que cualquiera se identifique. | No habla; actúa. |
| **Yara** | CAPCOM en la Base Aeolis. Guía la misión y celebra cada hallazgo. | Cálida, directa, frases cortas. |
| **SOMA** | IA del traje. Vigila oxígeno, energía e integridad, y explica las capas de datos. | Precisa, calmada; en peligro se vuelve imperativa. |
| **Control Tierra** | Científicos en la Tierra. Siempre hablan con retraso. | Formal; sus mensajes llegan "tarde" a propósito. |
| **Tumbo** | Rover de apoyo. Es refugio intermedio y recarga a medias. | (Sin voz; es un lugar). |
| **Refugio Sur** | Módulo presurizado al borde del boxwork. Es el final de la caminata. | (Sin voz; es un lugar). |

## Estructura (5 misiones)
| # | Misión | Objetivo (M3) | Peligro principal | Capa que enseña | Capítulo del agua |
|---|---|---|---|---|---|
| 1 | Primeros pasos en Aeolis | `obj_arcillas` | Pendiente / escalones | Pendiente | Lagos antiguos |
| 2 | Tormenta en el horizonte | `obj_sulfatos` | Tormenta solar | Radiación | El secado |
| 3 | Piedras amarillas | `obj_azufre` | Frío del canal | Temperatura | Ríos y canales |
| 4 | La red bajo la piedra | `obj_boxwork` | Distancia / oxígeno | Espectral | Agua subterránea |
| 5 | Refugio Sur | `refugio_sur` | Oxígeno restante | Ruta sugerida (A*) | — |

Cada objetivo está sobre una parada real de Curiosity, y el orden sigue la geografía real de norte a sur (≈6,4 km en línea recta, unos 500 m de subida). Curva de dificultad: cada misión introduce **una** capa y **un** peligro nuevos. La 5 los combina todos.

## Tono
Optimista y científico, con tensión real. Nada de monstruos ni de alienígenas: el peligro es el propio planeta. Cada vez que el jugador aprende algo de Marte, lo aprende por haberlo vivido.
