# Mars Survival Map

**NASA Space Apps Challenge · Interplanetary Survival Guide: Martian Map**

Simulador web 3D (Three.js) de una caminata marciana en el Monte Sharp, dentro del cráter Gale. Juegas como EVA-1, la primera persona en caminar por donde va Curiosity. Tienes que completar los objetivos científicos que analizó Curiosity y llegar al Refugio Sur usando un HUD con capas de datos de NASA: pendiente, radiación, temperatura y minerales.

Equipo: Andres Eduardo Mejia Castro (líder), Erick Antonio Arana Espinoza, Jesser Jadiel Rodriguez Chavarria, Raul Natanael Valverde Ruiz.

## Estado
| Parte | Responsable | Estado |
|---|---|---|
| Recorte geográfico (`data/region.json`) | M3 | Confirmado con la traza de Curiosity |
| Capas + reglas + objetivos (`public/layers/`) | M3 | **Datos reales** CTX+HiRISE validados contra Curiosity; espectral e inercia térmica aproximadas (CRISM/THEMIS pendientes) |
| Historia, misiones, diálogos, alertas, datos curiosos (`public/story/`, `docs/`) | M4 | v1 lista (ES/EN) |
| Wireframes del HUD (7 pantallas), guion del video | M4 | v1 lista: `docs/wireframes/index.html`, `docs/guion_video.md` |
| Terreno y modelos (`public/models/`) | M1 | Pendiente |
| Motor web (`src/`) | M2 | Pendiente |

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
