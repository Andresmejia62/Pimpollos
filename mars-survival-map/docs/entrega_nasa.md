# Entrega NASA Space Apps — Mars Survival Map

> Textos listos para copiar en el formulario de entrega. Revisar las cifras contra `data/processed/report.json` antes de enviar y completar los campos marcados con `[ ]`.

## Nombre del proyecto
Mars Survival Map

## Reto
Interplanetary Survival Guide: Martian Map

## Resumen (≈150 palabras)
**ES.** Mars Survival Map es un simulador web 3D en el que caminas por el Monte Sharp, dentro del cráter Gale, siguiendo la ruta real de Curiosity. El terreno sale de modelos de elevación HiRISE y CTX alineados con 857 paradas del rover (error típico de unos 2 m). Cada dato de NASA se convierte en una regla de supervivencia: la pendiente te frena, el frío medido por REMS y THEMIS gasta tu batería, la radiación medida por RAD desgasta tu traje, y los minerales que detecta CRISM te guían hacia los objetivos científicos. En cinco misiones el jugador visita arcillas, sulfatos, piedras de azufre y formaciones boxwork, los mismos lugares que estudió Curiosity, y aprende a leer capas de datos para tomar decisiones con un retraso de comunicación de 14 minutos con la Tierra.

**EN.** Mars Survival Map is a 3D web simulator where you walk Mount Sharp in Gale crater along Curiosity's real route. The terrain is built from HiRISE and CTX elevation models aligned to 857 rover stops (~2 m typical error). Every NASA dataset becomes a survival rule: slope slows you down, cold measured by REMS and THEMIS drains your battery, radiation measured by RAD wears down your suit, and minerals mapped by CRISM guide you to science targets. Across five missions the player visits clays, sulfates, sulfur stones and boxwork — the same sites Curiosity studied — and learns to read data layers to make decisions with a 14-minute communication delay to Earth.

## Detalles del proyecto
**Qué hace.** Es un juego de exploración y supervivencia en el navegador, sin instalación. El HUD del casco muestra oxígeno, energía e integridad del traje, un minimapa con la ruta de Curiosity y cuatro capas de datos que se alternan con las teclas 1–4. Una ruta sugerida (algoritmo A*) combina todas las capas para encontrar el camino más seguro, que no siempre es el más corto. Un evento de tormenta solar obliga a buscar refugio.

**Cómo funciona.**
1. *Pipeline de datos (Python + GDAL/rasterio):* descarga solo la ventana del recorte desde servidores públicos de USGS y PDS, reproyecta todo a una cuadrícula común de 1024×1024 (6 m/px, 6,1 km de lado), alinea cada modelo de elevación con las alturas medidas por Curiosity y genera las capas en PNG con su leyenda.
2. *Reglas:* un `rules.json` traduce cada capa en consumo de recursos con umbrales documentados (por ejemplo, más de 25° de pendiente = intransitable; el 95 % de las paradas de Curiosity están en pendientes de 21° o menos).
3. *Motor web:* Three.js carga el terreno exportado desde Blender y aplica las capas como texturas superpuestas.
4. *Narrativa:* misiones, diálogos y alertas en JSON bilingüe (ES/EN).

**Beneficios e impacto.** Enseña ciencia planetaria real de forma activa: el jugador no lee que las arcillas indican agua, decide ir hasta ellas y lo descubre. Además muestra cómo trabajarán los futuros astronautas: decidiendo solos, con datos, sin ayuda en tiempo real desde la Tierra. Todo el código y el pipeline son abiertos y reproducibles, y cualquiera puede cambiar el recorte por otra zona de Marte.

**Herramientas.** Python (numpy, Pillow, rasterio/GDAL), Three.js, Vite, Blender, HTML/CSS/JS. Diseño del HUD con wireframes HTML interactivos.

## Datos de NASA usados
| Dato | Uso en el juego |
|---|---|
| MRO HiRISE DTM (DTEEC_009149_1750_009294_1750_U01, DTEEC_019698_1750_019988_1750_U01, DTEEC_009650_1755_009716_1755_U01) vía USGS Astrogeology | Terreno 3D detallado y pendiente |
| MRO CTX DTM y ortoimagen (T01_000815_1749_XN_05S222W__P21_009149_1752_XI_04S222W) vía USGS Astrogeology | Terreno base y textura |
| Traza de Curiosity (MSL waypoints, NASA/JPL MMGIS) | Validación del terreno, ubicación de objetivos y ruta en el minimapa |
| MSL RAD (Hassler et al. 2014) | Dosis base de radiación |
| MSL REMS | Rango de temperatura diario |
| Mars Odyssey THEMIS: inercia térmica cuantitativa (USGS/ASU) | Temperatura del suelo según el tipo de terreno |
| MRO CRISM MTRDR (parámetros D2300, BD2290, BD1900_2, SINDEX2, BD2100_2, OLINDEX3, LCPINDEX2) vía PDS Geosciences Node | Capa de minerales: arcillas, sulfatos y arena basáltica |

## Datos de otras agencias
[ ] Ninguno por ahora. Si se agregan (por ejemplo, ESA Mars Express HRSC), listarlos aquí.

## Referencias
- Hassler, D. M. et al. (2014). Mars' surface radiation environment measured with the Mars Science Laboratory's Curiosity rover. *Science* 343, 1244797.
- Viviano-Beck, C. E. et al. (2014). Revised CRISM spectral parameters and summary products. *JGR Planets* 119, 1403–1431.
- Fergason, R. L. et al. (2012). Surface properties of the MSL candidate landing sites: thermal inertia. *Space Science Reviews* 170.
- Siebach, K. L. & Grotzinger, J. P. (2014). Volumetric estimates of ancient water on Mount Sharp based on boxwork deposits. *JGR Planets* 119.
- NASA/JPL: notas de prensa de Curiosity sobre Glen Torridon, el azufre de Gediz Vallis (2024) y la región boxwork (2025).
- Catálogo STAC de USGS Astrogeology y PDS Geosciences Node (ODE). Fechas de acceso en `data/raw/manifest.json`.

## Uso de inteligencia artificial
[ ] Revisar y ajustar con el equipo antes de enviar. Space Apps pide declarar el uso de IA.
Usamos un asistente de IA (Claude, de Anthropic) para escribir parte del código del pipeline de datos y redactar borradores de textos (historia, diálogos, documentación) y de los wireframes. El equipo revisó, corrigió y validó los resultados; las cifras se verificaron contra los datos de NASA. Las imágenes del juego son datos reales de NASA, no generadas por IA.

## Enlaces
- [ ] Demo jugable: URL pública (GitHub Pages / Netlify)
- [ ] Repositorio: URL de GitHub
- [ ] Video (2 min): URL
- [ ] Presentación: URL
