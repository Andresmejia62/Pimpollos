# Prueba de principio a fin (automática)

Fecha: 2026-11-14. Un bot juega la campaña completa dentro del navegador llamando a la misma lógica del juego
(`Game.update` y `Companion.update`, a 30 pasos por segundo), sin atajos: sigue la ruta A* con una dirección
suavizada (como un jugador que mantiene W), escanea cada objetivo, se refugia en la tormenta solar, rescata a
EVA-2 (mantiene F) y va al refugio más cercano cuando el O₂ baja de 25 % o la batería de 20 %.

## Resultado con el traje marciano ligero (50 kg)
| Perfil | Resultado | Tiempo real | Recargas | Puntos |
|---|---|---|---|---|
| Referencia (75 kg, 175 cm, VO₂max 45) | ✅ 5/5 misiones | 21,9 min | 1 (Refugio Sur) | 1129 |
| 56 kg · 160 cm | ✅ | 23,4 min | 1 | 1079 |
| 92 kg · 190 cm | ✅ | 22,1 min | 1 | 1127 |
| VO₂max 28 (baja condición física) | ✅ | 27,8 min | 1 | 1034 |
| Traje Apollo A7LB (91 kg) | ❌ sin O₂ en la misión 4 | 45,4 min | 3 | — |
| Traje xEMU (145 kg) | ❌ sin O₂ en la misión 3 | 27,4 min | 3 | — |

En todas las partidas exitosas EVA-2 quedó atrapado en Gediz Vallis y fue rescatado, y la tormenta solar de la misión 2 se superó.
Los trajes pesados son "modo muy difícil": la pantalla de perfil lo avisa.

## Lo que encontró la prueba
- Un bot que corrige el rumbo hacia el siguiente punto del A* cada fotograma va a ~4,5 m/s de media (zigzaguea y
  pierde agarre con la gravedad de Marte); con la dirección suavizada va a ~6,6 m/s. Jugadores que giran mucho tardarán más.
- La línea recta de la planificación suele ser intransitable (pendientes > 25°): la ruta A* es ~18 % más larga.

## Pendiente: pruebas con personas
Esta prueba no sustituye a las pruebas de `docs/pruebas_usabilidad.md` con 2-3 personas (comprensión del HUD,
de las capas y de la planificación). Hay que hacerlas.
