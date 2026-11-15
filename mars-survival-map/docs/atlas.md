# Atlas de Marte (mapa grande) y tracking

Tecla **M** en el juego (o el botón *Atlas de Marte* en la portada). El juego se pausa mientras está abierto. Código: `src/ui/atlas.js`, `src/geo.js`; datos en `public/atlas/` generados con `node data/scripts/build_atlas.mjs`.

## Tres niveles de datos reales, una sola proyección
Todo usa coordenadas **planetocéntricas, longitud Este 0–360°** (convención IAU/USGS) en proyección equirectangular.

| Nivel | Producto | Resolución | Archivo |
|---|---|---|---|
| Global | MGS MOLA MEGDR `megt90n000eb` (NASA PDS Geosciences), promediado | 8 px/° (~7,4 km) | `mola_global.z` (3 MB) |
| Cráter Gale | MGS MOLA MEGDR `megt00n000gb`, recorte 2,0–8,5° S, 134,5–141,5° E (descarga por HTTP Range) | 64 px/° (~925 m) | `mola_gale.z` (0,2 MB) |
| Zona EVA | DTM HiRISE + CTX del juego (`public/layers/dem.bin`) + ortoimagen CTX | 6 m/px | ya existente |

**Validación:** MOLA da −4 505 m en el punto de aterrizaje de Curiosity; el rover midió −4 501 m (`atlas.json → check`).

Formato `.z`: elevación cuantizada (4 m global, 1 m Gale), diferencia con el píxel de la izquierda en zigzag, dos planos de bytes, zlib. El navegador lo descomprime con `DecompressionStream` y calcula el relieve sombreado; por eso se puede leer la elevación en cualquier punto.

## Vista 3D (por defecto)
El atlas abre como un **globo 3D** de Marte (`src/ui/atlas3d.js`); el botón **3D** vuelve al mapa plano y conserva la posición.
- **Tres mallas con la misma elevación real:** el globo (MOLA, celdas de 0,5°), el cráter Gale (MOLA 64 px/°, una celda por píxel) y la zona EVA (DTM HiRISE+CTX con la ortoimagen CTX encima). Al acercarse se ve el relieve en 3D.
- **Exageración vertical** configurable (auto, ×1 real, ×3, ×10, ×25). En automático va de ×12 con el planeta entero a ×1,5–2 de cerca. La lectura bajo el cursor indica siempre el valor en uso; las elevaciones que se muestran son las reales.
- **Retícula lat/lon pegada al relieve** (se dibuja en el shader), con el ecuador y el meridiano 0°/180° resaltados y el paso adaptado al zoom.
- **Controles:** arrastrar gira el globo, la rueda acerca, botón derecho o Ctrl+arrastrar inclina y rota la vista (hasta 80°).
- Todo lo demás funciona igual que en 2D: lectura de latitud, longitud y elevación bajo el cursor (rayo contra el relieve), clic en marcadores, zonas de fenómenos como círculos reales sobre la esfera, traza de Curiosity, tu traza, la regla y el perfil de elevación.

## Qué muestra
- **Lectura bajo el cursor:** latitud/longitud (decimal y DMS), elevación (con el producto de origen), presión estimada, columna de aire (g/cm², el "escudo" contra la radiación) y si el agua puede ser líquida.
  - Presión: `P = 610 Pa · e^(−h / 11,1 km)` (atmósfera isoterma; varía ±12 % con la estación).
  - Agua: líquida solo si P > 611,7 Pa (punto triple); punto de ebullición por Clausius-Clapeyron.
  - En la zona EVA además: pendiente, dosis GCR, temperatura del suelo a la hora actual y mineral CRISM.
- **Modos:** relieve hipsométrico, tono marciano y presión superficial (con la isolínea del punto triple).
- **40 rasgos** con coordenadas del USGS Gazetteer o de NASA/JPL: cráteres, volcanes, llanuras, cañones, casquetes polares y 10 misiones en superficie (`features.json`).
- **10 fenómenos naturales** con zonas en el mapa, cuándo ocurren, el riesgo para una EVA y **cómo protegerse**: tormentas de polvo, remolinos, radiación GCR/SPE, géiseres de CO₂, RSL, avalanchas polares, martemotos, impactos recientes, frío/presión baja y percloratos.
- **Curiosity:** traza completa 2012–hoy (MMGIS, 1 389 paradas) y 22 perforaciones de sol 2488 a 4718 (`msl_drills.json`; posición = parada real del rover en ese sol).
- **Tu traza (tracking):** un punto cada 12 m o cada 2 min de Marte con tiempo, posición, elevación, gasto metabólico y O₂. Perfil de elevación con distancia, desnivel y pendiente máxima. **Exportar traza CSV** (lat, lon Este, elevación sobre el areoide).
- **Regla:** Mayús+clic (o botón *Regla*) en dos puntos: distancia de círculo máximo (R = 3 389,5 km), rumbo inicial y perfil de elevación entre ellos.

## Telemetría en el HUD (tecla I)
- **NAV:** latitud y longitud con 5 decimales (~0,3 m), elevación, presión, rumbo, velocidad real, pendiente y distancia/rumbo/desnivel al objetivo.
- **BIO:** potencia metabólica, VO₂ y % del VO₂max, frecuencia cardíaca, O₂ restante (g y horas al ritmo actual), kcal, O₂ y CO₂ acumulados, dosis (µGy y µSv), coeficiente de terreno y fatiga. Ver `docs/fisiologia.md`.
