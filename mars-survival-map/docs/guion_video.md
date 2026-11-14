# Guion del video — Mars Survival Map (2:00)

**Formato:** 1920×1080, 60 fps y 2:00 como máximo. Locución en español con subtítulos en inglés (los jueces son internacionales); si hay tiempo, también una versión con locución en inglés.
**Tono:** documental de exploración, sin dramatismo exagerado. El héroe es el dato de NASA: el juego es la forma de usarlo.
**Ritmo de locución:** unas 2,3 palabras por segundo. El texto de abajo tiene unas 250 palabras.

## Guion

| Tiempo | Imagen (qué se ve) | Locución (ES) | Texto en pantalla | Audio |
|---|---|---|---|---|
| **0:00–0:08** | Foto real de Curiosity en Mount Sharp (NASA/JPL). Zoom lento. Corte a negro. | «Curiosity lleva más de catorce años y cinco mil soles subiendo una montaña en Marte.» | — | Ambiente de viento suave |
| **0:08–0:18** | Pantalla de inicio del juego (wireframe 1); la cámara baja hacia el terreno. | «Un día, alguien va a caminar por ese mismo lugar. Para sobrevivir no le va a bastar con un mapa: va a necesitar entender los datos.» | **MARS SURVIVAL MAP** · NASA Space Apps · Interplanetary Survival Guide | Entra la música |
| **0:18–0:38** | Animación del pipeline: ortoimagen CTX → DTM HiRISE → terreno 3D. Se dibuja la traza amarilla de Curiosity y aparecen los puntos de validación. | «Construimos el terreno con modelos de elevación de HiRISE y CTX, de la sonda Mars Reconnaissance Orbiter. Lo alineamos con 857 paradas reales de Curiosity: el error típico es de unos dos metros.» | `DTM HiRISE 1 m + CTX 20 m` · `857 paradas de Curiosity` · `±2 m` | — |
| **0:38–0:50** | Las 4 capas apareciendo una a una sobre el mapa (pendiente, radiación, temperatura, minerales), con su patrón: liso, puntos y rayas. | «Cada dato se convierte en una regla: la pendiente te frena, el frío gasta tu batería y la radiación desgasta tu traje.» | `Pendiente → velocidad` · `Temperatura → energía` · `Radiación → integridad` | Un "clic" por cada capa |
| **0:50–1:05** | **Gameplay, misión 1:** el jugador pulsa 1, aparecen rayas rojas en un escalón de roca; pulsa R y la ruta A* lo rodea. Llega a las arcillas y escanea. | «Eres EVA-1. Tu primer objetivo: las arcillas de Glen Torridon, donde Curiosity encontró la mayor cantidad de arcilla de toda su misión. Las arcillas se forman con agua.» | `Misión 1 · Unidad de arcillas` | Sonido de escaneo |
| **1:05–1:25** | **Gameplay, misión 2:** alerta roja con borde doble y cuenta regresiva de 30 s. El jugador activa Radiación y corre hacia el rover Tumbo. La barra de integridad apenas baja; aparece «A salvo». | «Pero Marte no tiene campo magnético. Cuando el Sol lanza una tormenta de partículas tienes treinta segundos. El instrumento RAD de Curiosity nos dice cuánta radiación hay; el terreno y el rover, dónde protegerte.» | `TORMENTA SOLAR · 00:18` | Sirena corta; la música baja |
| **1:25–1:40** | **Gameplay, misiones 3 y 4:** tarjeta del azufre (wireframe 6) y luego vista aérea de las crestas del boxwork con la capa espectral. | «Piedras de azufre puro, descubiertas en 2024. Redes de minerales que dejó el agua subterránea. Cada objetivo está exactamente donde estuvo Curiosity.» | `Sol 4200 · Gediz Vallis` · `Sol 4671 · Boxwork` | — |
| **1:40–1:52** | Pantalla de misión completada con el puntaje. Luego, el mapa entero con la traza y los 4 objetivos marcados como «capítulos del agua». | «Lagos, ríos, desierto y agua subterránea: cuatro capítulos de la historia del agua en Marte, en una caminata de veinte minutos.» | `Lagos · Canales · Secado · Agua subterránea` | La música sube |
| **1:52–2:00** | Créditos: nombres del equipo, URL del juego y fuentes de datos. | «Mars Survival Map. Lee los datos. Vuelve con vida.» | Equipo · URL · «Datos: NASA/JPL-Caltech, MRO HiRISE/CTX (USGS Astrogeology), MSL RAD/REMS» | Cierre |

## Subtítulos en inglés (para pegar en el editor)
1. Curiosity has spent more than fourteen years — over five thousand sols — climbing a mountain on Mars.
2. One day, someone will walk this same ground. To survive, a map won't be enough: they'll need to understand the data.
3. We built the terrain from HiRISE and CTX elevation models from the Mars Reconnaissance Orbiter, aligned to 857 real Curiosity stops — typical error, about two meters.
4. Every dataset becomes a rule: slope slows you down, cold drains your battery, radiation wears down your suit.
5. You are EVA-1. First target: the Glen Torridon clays, where Curiosity found the most clay of its entire mission. Clays form with water.
6. But Mars has no magnetic field. When the Sun unleashes a particle storm, you have thirty seconds. Curiosity's RAD tells us how much radiation there is; the terrain and the rover, where to shelter.
7. Pure sulfur stones, discovered in 2024. Mineral networks left by groundwater. Every target sits exactly where Curiosity stood.
8. Lakes, rivers, desert and groundwater: four chapters of Mars's water story, in a twenty-minute walk.
9. Mars Survival Map. Read the data. Come back alive.

## Lista de capturas (quién y cuándo)
| # | Captura | Fuente | Responsable | Listo para |
|---|---|---|---|---|
| C1 | Foto de Curiosity en Mount Sharp (dominio público NASA/JPL, citar el ID PIA) | photojournal.jpl.nasa.gov | M4 | Hora 40 |
| C2 | Pantalla de inicio con paneo | Juego (M2) | M2 + M4 | Hora 40 |
| C3 | Animación del pipeline: `optical.png` → `dem16.png` en 3D → traza | `data/processed/preview.png` y capas; animar en el editor | M3 | Hora 38 |
| C4 | Capas 1–4 alternándose | Juego, pantalla de juego | M2 | Hora 40 |
| C5 | Misión 1 completa (unos 20 s de juego real) | Juego | M4 juega, M2 graba | Hora 42 |
| C6 | Tormenta solar llegando al rover | Juego (forzar el evento con un atajo de depuración) | M2 | Hora 42 |
| C7 | Tarjetas de azufre y boxwork | Juego / wireframe 6 | M4 | Hora 42 |
| C8 | Pantalla final y mapa con los 4 objetivos | Juego / wireframe 7 | M4 | Hora 43 |

## Producción
- **Grabación:** OBS a 1080p60 con el navegador en pantalla completa y el HUD a escala 100 %. Grabar cada toma 2 o 3 veces.
- **Locución:** en un cuarto pequeño con ropa colgada alrededor, celular a 20 cm. Grabar frase por frase para editar fácil.
- **Edición:** DaVinci Resolve o CapCut. Cortes en el golpe de la música. Nada de transiciones vistosas: cortes secos y algún fundido a negro.
- **Música:** libre de derechos (YouTube Audio Library o Pixabay Music), estilo ambient o sintetizador. Citarla en la descripción.
- **Accesibilidad:** subtítulos quemados en el video (EN) y archivo `.srt` aparte (ES y EN).
- **Revisión:** que 2 personas ajenas al proyecto lo vean una sola vez y expliquen qué hace el juego. Si no pueden, recortar.

## Checklist antes de subir
- [ ] Dura 2:00 o menos
- [ ] Se nombran NASA, Curiosity, HiRISE/CTX y RAD/REMS, y salen en los créditos
- [ ] Las cifras coinciden con `docs/fuentes.md` (857 paradas, ±2 m, 0,21 mGy/día)
- [ ] Ninguna imagen ni música con copyright sin licencia
- [ ] URL del juego visible en los créditos y en la descripción
