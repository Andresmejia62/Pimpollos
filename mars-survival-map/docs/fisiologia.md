# Fisiología del astronauta y gasto de energía

Código: `src/engine/physiology.js` (modelo), `src/gameplay/game.js` (integración), `src/ui/profile.js` (pantalla de perfil).

Antes de la primera misión se elige el perfil: **masa corporal, estatura, edad, sexo, VO₂max y traje**. El perfil cambia la velocidad, el salto, el oxígeno, la batería y la fatiga.

## Variables derivadas del perfil
| Variable | Fórmula | Fuente |
|---|---|---|
| Metabolismo basal (BMR) | `10·m + 6,25·h − 5·edad + (5 hombre / −161 mujer)` kcal/día | Mifflin-St Jeor (1990) |
| Superficie corporal | `0,007184 · m^0,425 · h^0,725` (m²) | DuBois y DuBois (1916) |
| Longitud de pierna | `0,53 · estatura` | Winter, *Biomechanics and Motor Control of Human Movement* |
| Velocidad máx. de marcha | `√(Fr · g · L)`, Fr = 0,5 (transición a correr); en el juego Fr = 0,35 | Número de Froude (Alexander 1989; Kram et al. 1997) |
| FC máxima | `208 − 0,7 · edad` | Tanaka et al. (2001) |
| FC durante la EVA | `FC_reposo + %VO₂R · (FC_max − FC_reposo)` | Swain y Leutholtz (1997) |
| Peso en Marte | `(m_cuerpo + m_traje) · 3,721 N` | NASA Mars Fact Sheet |

En Marte una persona alta camina más rápido que una baja: con g = 3,721 m/s² la velocidad máxima de marcha de una pierna de 93 cm es 1,31 m/s (en la Tierra, 2,13 m/s).

## Gasto metabólico al caminar (W)
Ecuación de Pandolf et al. (1977) para marcha con carga, adaptada a 0,379 g:

```
M = 1,3·BMR + 2·(W+L)·(L/W)²·gr                           (de pie, sosteniendo el traje)
  + K_traje · η·(W+L)·(1,5·v² + 0,35·v·G·gr) · f_loc      (locomoción; G = pendiente en %)
```
- `W` masa corporal, `L` masa del traje, `v` velocidad real (m/s), `gr = 3,721/9,807 = 0,379`.
- `f_loc = 0,4 + 0,6·gr`: el coste de la marcha horizontal no baja en proporción a la gravedad (Farley y McMahon 1992; Griffin et al. 1999).
- `K_traje = 1,2`: un traje presurizado obliga a vencer el par de las articulaciones (Norcross et al. 2010, NASA/TP-2010-216139).
- **Bajadas** (G < 0): se descuenta parte del término de pendiente, sin bajar del 55 % del coste en llano (frenar también cuesta). Simplificación inspirada en Santee et al. (2003).
- **Terreno** (`η`, coeficiente de Pandolf), a partir de la capa espectral CRISM: regolito firme 1,2 · crestas boxwork 1,5 · arena de duna 2,1.
- Traje fuera del rango de estatura de NASA (157,5–190,5 cm): +8 %.

## De W a recursos del juego
| Recurso | Cálculo |
|---|---|
| O₂ consumido | `VO₂ (L/min) = M · 60 / 20 100` (1 L de O₂ ≈ 20,1 kJ); 1,429 g/L |
| CO₂ producido | `0,85 · VO₂` (cociente respiratorio), 1,977 g/L |
| Agua del sublimador | 80 % de `M` en calor / 2,83 MJ/kg |
| Capacidad de O₂ del traje | 8 h del astronauta de referencia caminando en llano × `rules.json → oxygen.metabolic_calibration` (1,10) |
| Batería | base × (0,85 + 0,15·M/M_ref) × (1 + frío); el término de frío escala con la superficie corporal y baja si el cuerpo produce más calor |
| Fatiga | por encima del 55 % del VO₂max se acumula (`(p − 0,55) · 0,1` por segundo de Marte); por debajo se recupera. Al 100 % la marcha baja un 45 % |
| Dosis | dosis absorbida real (µGy) de la capa RAD; dosis equivalente con Q = 3,05 (0,64 mSv/día ÷ 0,21 mGy/día, Hassler et al. 2014) |
| VO₂ en pantalla | se suaviza con una constante de 1,5 s reales (≈ 21 s en Marte), parecida a la cinética real del VO₂ |

## Calibración
Se simuló la ruta A* completa (7,2 km, de la base al Refugio Sur): el astronauta de referencia (75 kg, 175 cm, 38 años, VO₂max 45, traje de 50 kg) gasta lo mismo que la regla v1 (~65 % de O₂). Otros perfiles, solo caminando:

| Perfil | Tiempo | O₂ gastado | kcal | Fatiga máx. |
|---|---|---|---|---|
| Referencia | 17,3 min | 65 % | 1 741 | 4 % |
| 56 kg · 160 cm | 18,4 min | 57 % | 1 529 | 14 % |
| 92 kg · 190 cm | 16,6 min | 73 % | 1 939 | 6 % |
| Atleta (VO₂max 58) | 17,2 min | 63 % | 1 675 | 0 % |
| Traje Apollo A7LB (91 kg) | 23,3 min | 103 % → necesita el rover | 2 748 | 83 % |
| VO₂max 28 | 21,5 min | 65 % | 1 726 | 68 % |
| 115 kg | 17,3 min | 81 % | 2 159 | 0 % |

## Límites del modelo
- Pandolf se validó en la Tierra; las correcciones para gravedad reducida y traje son aproximadas.
- El reloj del juego está comprimido (×14) y la distancia también: la velocidad "real" que se usa para el metabolismo es la de diseño del perfil, no la del mundo del juego.
- No se modelan deshidratación, ritmo circadiano ni aclimatación.
