# Mars Survival Map

**NASA Space Apps Challenge · Interplanetary Survival Guide: Martian Map**

Simulador web 3D (Three.js) de una caminata marciana en el Monte Sharp, dentro del cráter Gale. Juegas como EVA-1, la primera persona en caminar por donde va Curiosity. Tienes que completar los objetivos científicos que analizó Curiosity y llegar al Refugio Sur usando un HUD con capas de datos de NASA: pendiente, radiación, temperatura y minerales.

Equipo: Andres Eduardo Mejia Castro (líder), Erick Antonio Arana Espinoza, Jesser Jadiel Rodriguez Chavarria, Raul Natanael Valverde Ruiz.

## Estado
| Parte | Responsable | Estado |
|---|---|---|
| Recorte geográfico (`data/region.json`) | M3 | Confirmado con la traza de Curiosity |
| Capas + reglas + objetivos (`public/layers/`) | M3 | **Datos reales**: DTM CTX+HiRISE validado contra Curiosity, minerales CRISM e inercia térmica THEMIS |
| Historia, misiones, diálogos, alertas, datos curiosos (`public/story/`, `docs/`) | M4 | v1 lista (ES/EN) |
| Wireframes del HUD (7 pantallas), guion del video | M4 | v1 lista: `docs/wireframes/index.html`, `docs/guion_video.md` |
| Terreno y modelos (`public/models/`) | M1 | Pendiente |
| Motor web (`src/`) | M2 | v1 jugable: terreno 3D real, HUD, 5 misiones, tormenta solar, A*, ES/EN |

## Jugar
```bash
npm install
npm run dev        # http://127.0.0.1:5173  (añade ?debug=1 para FPS y atajos)
npm run build      # genera dist/ para GitHub Pages o Netlify
```
Controles: **W A S D** caminar · **ratón** mirar (clic para capturar o arrastrar) · **rueda** distancia de cámara · **1–4** capas · **R** ruta A* · **H** guía de capas · **M** atlas de Marte · **I** telemetría · **Esc** pausa.

**Dos modos** en la portada:
- **Comenzar EVA (modo juego):** la campaña de 5 misiones con sus objetivos científicos, la tormenta solar y el puntaje.
- **Modo libre (simulación):** sin objetivo predefinido. Con **G** defines en el mapa tu destino, tu punto de salida y puntos de paso, y comparas las rutas y su consumo; al llegar se mide el punto (elevación, pendiente, temperatura, dosis y mineral). Con **O** se abre el panel de simulación: hora local, tormenta solar (**T**), recarga (**K**), teletransporte a cualquier sitio, qué recursos se gastan (O₂, batería, traje), EVA-2, rover, perfil, contadores y traza CSV. Código: `src/ui/sim.js` y `Game.startFree()` en `src/gameplay/game.js`.

Antes de la primera misión se elige el **perfil fisiológico** del astronauta (masa, estatura, edad, sexo, VO₂max, traje): cambia la velocidad, el oxígeno, la batería y la fatiga (`docs/fisiologia.md`). El **atlas** (tecla M) es un mapa de todo Marte con elevación real MOLA, cráteres, misiones, fenómenos naturales con medidas de protección, la traza de Curiosity y tu propia traza exportable (`docs/atlas.md`).
Atajos con `?debug=1`: **T** tormenta solar · **N** saltar cerca del objetivo · **K** recargar recursos.

### Motor (`src/`)
| Archivo | Qué hace |
|---|---|
| `src/data.js` | Carga capas (`public/layers`) e historia (`public/story`) |
| `src/engine/world.js` | Cuadrícula de M3: altura (`dem.bin`) y capas (`grid.bin`) por posición |
| `src/engine/scene.js` | Terreno 3D desde el DEM real (malla 768×768, ~8 m) con shader de capas, cielo, rocas, marcadores y ruta |
| `src/engine/astronaut.js` | Astronauta: usa `public/models/astronaut.glb` de M1 si existe; si no, un modelo de primitivas |
| `src/engine/controls.js` | Teclado, ratón y cámara en tercera persona |
| `src/gameplay/game.js` | Recursos, misiones, escaneo, tormenta, refugios y puntaje según `rules.json` |
| `src/gameplay/alerts.js` | Condiciones de `alerts.json` |
| `src/gameplay/pathfinding.js` | A* sobre la cuadrícula de costos (512×512, celdas de 12 m) |
| `src/ui/hud.js` | HUD de los wireframes, minimapa, brújula, diálogos y telemetría NAV/BIO (tecla I) |
| `src/ui/atlas.js` | Atlas de Marte: MOLA global + Gale + zona EVA, fenómenos, regla, perfil de elevación, exportar traza |
| `src/ui/intro.js` | Cinemática de llegada tras "Comenzar EVA": la nave cruza el espacio hacia Marte (relieve MOLA), entra con plasma, falla el paracaídas y se estrella en Gale (terreno real). Se puede saltar |
| `src/ui/atlas3d.js` | Vista 3D del atlas: globo de Marte con relieve MOLA, Gale y la zona EVA como mallas 3D, retícula en el shader y exageración vertical configurable |
| `src/ui/profile.js` | Pantalla del perfil fisiológico |
| `src/engine/physiology.js` | Gasto metabólico (Pandolf a 0,379 g), VO₂, FC, fatiga |
| `src/geo.js` | Lat/lon ↔ mundo, distancias de círculo máximo, presión y agua líquida |
| `src/engine/marsrover.js` | Rover conducible estilo Curiosity/Perseverance: 6 ruedas, rocker-bogie que sigue el terreno, mástil, brazo y MMRTG |
| `src/ui/screens.js` | Pantalla de carga (pasos reales de carga, "Marte ahora") y menú de pausa con pestañas |
| `src/ui/planner.js`, `src/gameplay/planner.js` | Planificación antes de salir: compara rutas (A*, línea recta, con escala en un refugio, propia), perfil de elevación y estimación de O₂, batería, fatiga y dosis |
| `src/gameplay/companion.js` | EVA-2: compañero que te sigue, hace una medición secundaria en cada objetivo y puede quedar atrapado (rescate con F) |
| `src/spaceweather.js` | Pronóstico de clima espacial con NASA DONKI (en vivo → copia guardada → evento real de referencia de mayo de 2024) |
| `src/engine/planets.js` | Planetas en el cielo de Gale: posiciones reales de hoy (JPL), magnitud y extinción por polvo; la Tierra con la Luna |
| `src/marsclock.js` | Marte en tiempo real: Ls, sol de Curiosity, hora local en Gale (Mars24) y distancia Tierra–Marte (JPL) |

El terreno se genera directo del DEM (plan B del documento de estructura), así que el juego no depende de `terrain.glb`. Si M1 entrega `astronaut.glb` en `public/models/`, el juego lo carga solo.

**Balance probado:** una partida automática siguiendo la ruta A* completa las 5 misiones en ~20 min reales y termina con ~26 % de oxígeno. Un jugador que se desvíe necesita los refugios.

## Contratos entre miembros
- **Cuadrícula única:** 1024×1024 px, 6 m/px, 6,144 km de lado (de Glen Torridon a la región boxwork). La fila 0 es el borde norte y la columna 0 el borde oeste. Ver `public/layers/region.json`.
- **Mundo 3D:** metros, origen en el centro, `x` = Este, `z` = Sur, `y` = elevación − `y_ref_m`. Las fórmulas de píxel a mundo están en `region.json -> world`.
- **Capas:** `public/layers/layers.json` dice qué archivo es cada capa y cómo decodificarlo (`valor = min + pixel/255*(max-min)`).
- **Reglas:** `public/layers/rules.json` (explicado en `docs/reglas.md`).
- **Misiones:** `public/story/missions.json` usa los `id` de `public/layers/objectives.json`.

## Para cada miembro
- **M1 (Blender):** usar `public/layers/dem16.png` como heightmap (16 bits) con un modificador Displace; la intensidad es `max - min` de `layers.json -> dem` (en metros). Unir `slope_blocked.png` con las rocas y cráteres para hacer `collision_map.png` (blanco = bloqueado).
- **M2 (web):** el HUD a implementar está en `docs/wireframes/index.html` (con notas por componente). Se puede empezar ya con `dem16.png`, `optical.png`, las capas `*_overlay.png`, `cost_256.png` para A* y los JSON de `public/story/`.

## Regenerar las capas (M3)
```bash
python3 -m pip install rasterio
python3 data/scripts/fetch_nasa.py            # descarga solo el recorte desde USGS (~23 MB)
python3 data/scripts/build_layers.py          # capas reales (~10 s); --source synthetic para el placeholder
```
Texturas HD del terreno (ortoimágenes HiRISE de 1 m igualadas a CTX + normales y oclusión del DTM HiRISE):
```bash
python3 data/scripts/build_textures.py        # genera public/textures/ (requiere numpy, rasterio, Pillow)
```
Clima espacial (opcional, guarda una copia de DONKI para jugar sin red; clave gratis en api.nasa.gov):
```bash
NASA_API_KEY=tu_clave node data/scripts/fetch_donki.mjs
```
Para usar DONKI en vivo con tu clave en el navegador: `VITE_NASA_API_KEY=tu_clave npm run dev`.

Atlas (solo Node, sin dependencias; descarga ~43 MB de MOLA a `data/raw/mola/`, que no se sube a git):
```bash
node data/scripts/build_atlas.mjs             # genera public/atlas/ (MOLA global y Gale, traza y perforaciones de Curiosity)
```
Genera `public/layers/*`, `data/processed/report.json` (estadísticas y chequeo de que se pueden alcanzar todos los objetivos) y `data/processed/preview.png`.
Requisitos: Python 3, numpy, Pillow y rasterio.

## Documentación
- `docs/historia.md`: premisa, personajes y estructura de las misiones
- `docs/guia_supervivencia.md`: guía para el jugador y explicación de qué tan realista es
- `docs/sistema_visual.md`: paleta, tipografía, código de peligro y layout del HUD
- `docs/reglas.md`: del dato NASA a la regla del juego
- `docs/fuentes.md`: productos NASA y cómo procesarlos
- `docs/atlas.md`: atlas de Marte, telemetría y tracking (MOLA, Gazetteer, MMGIS)
- `docs/fisiologia.md`: modelo de gasto de energía según el perfil del astronauta
- `docs/prueba_completa.md`: partida automática de principio a fin (resultados por perfil)
- `docs/wireframes/index.html`: wireframes interactivos del HUD (servir la carpeta del proyecto, p. ej. `python3 -m http.server`, y abrir `/docs/wireframes/`)
- `docs/guion_video.md`: guion del video de 2 min, subtítulos EN y lista de capturas

## Fuentes NASA
Ver `docs/fuentes.md`: DTM CTX y HiRISE (MRO, USGS Astrogeology), traza de Curiosity (NASA/JPL), RAD (Hassler et al. 2014) y REMS (MSL).
