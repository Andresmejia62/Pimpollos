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
Controles: **W A S D** caminar · **ratón** mirar (clic para capturar o arrastrar) · **rueda** distancia de cámara · **1–4** capas · **R** ruta A* · **H** guía de capas · **M** minimapa grande · **Esc** pausa.
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
| `src/ui/hud.js` | HUD de los wireframes, minimapa, brújula, diálogos |

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
Genera `public/layers/*`, `data/processed/report.json` (estadísticas y chequeo de que se pueden alcanzar todos los objetivos) y `data/processed/preview.png`.
Requisitos: Python 3, numpy, Pillow y rasterio.

## Documentación
- `docs/historia.md`: premisa, personajes y estructura de las misiones
- `docs/guia_supervivencia.md`: guía para el jugador y explicación de qué tan realista es
- `docs/sistema_visual.md`: paleta, tipografía, código de peligro y layout del HUD
- `docs/reglas.md`: del dato NASA a la regla del juego
- `docs/fuentes.md`: productos NASA y cómo procesarlos
- `docs/wireframes/index.html`: wireframes interactivos del HUD (servir la carpeta del proyecto, p. ej. `python3 -m http.server`, y abrir `/docs/wireframes/`)
- `docs/guion_video.md`: guion del video de 2 min, subtítulos EN y lista de capturas

## Fuentes NASA
Ver `docs/fuentes.md`: DTM CTX y HiRISE (MRO, USGS Astrogeology), traza de Curiosity (NASA/JPL), RAD (Hassler et al. 2014) y REMS (MSL).
