<div align="center">

# MARSIFT SURVIVAL MAP

**Interplanetary Survival Guide: Martian Map**
<br>
<sub>NASA SPACE APPS CHALLENGE &nbsp;·&nbsp; GALE CRATER, MARS</sub>

<br>

*Mind your step.*

<br>

[![Open the simulator](https://img.shields.io/badge/OPEN_THE_SIMULATOR-marsift.lat-C1440E?style=for-the-badge)](https://marsift.lat)
[![Watch the video](https://img.shields.io/badge/WATCH-PROJECT_VIDEO-1A1A1A?style=for-the-badge)](https://youtu.be/9wxb8RW8ego?si=2QSPlzmUjstLADc0)
[![Read the documentation](https://img.shields.io/badge/READ-DOCUMENTATION_PDF-DEA070?style=for-the-badge)](https://drive.google.com/drive/folders/19_wHxqcbCzmFsdEj7W35SNzTFY3jRMcl?usp=sharing)

![Three.js](https://img.shields.io/badge/Three.js-0.180-111111?style=flat-square)
![Vite](https://img.shields.io/badge/Vite-7-111111?style=flat-square)
![Platforms](https://img.shields.io/badge/Desktop_·_Phone_·_Tablet-111111?style=flat-square)
![Languages](https://img.shields.io/badge/English_·_Español-111111?style=flat-square)
![Data](https://img.shields.io/badge/Data-NASA_·_USGS_·_JPL-111111?style=flat-square)

</div>

<br>

An interactive 3D web simulator of a crewed extravehicular activity (EVA) on Mount Sharp (Aeolis Mons), inside Gale Crater on Mars, built entirely on real NASA data.

You step out as **EVA-1**, the first person to walk where the Curiosity rover drove. To get back alive you read the same scientific layers mission planners use (terrain slope, radiation, ground temperature and mineralogy), plan safe routes, manage oxygen, power and suit integrity, reach real science targets and find shelter before conditions turn against you.

It runs in any modern browser on **desktop, phone and tablet**, with full touch controls on mobile devices and nothing to install.

<br>

## Links

| | |
|---|---|
| **Try it in your browser** | [marsift.lat](https://marsift.lat): works on computers, phones and tablets, with no installation |
| **Watch the walkthrough** | [Project video on YouTube](https://youtu.be/9wxb8RW8ego?si=2QSPlzmUjstLADc0) |
| **Read the full documentation** | [PDF guides in English and Spanish (Google Drive)](https://drive.google.com/drive/folders/19_wHxqcbCzmFsdEj7W35SNzTFY3jRMcl?usp=sharing) |
| **Explore the code** | [GitHub repository](https://github.com/Andresmejia62/Pimpollos) |

**Team:** Andres Eduardo Mejia Castro (lead) &nbsp;·&nbsp; Erick Antonio Arana Espinoza &nbsp;·&nbsp; Jesser Jadiel Rodriguez Chavarria &nbsp;·&nbsp; Raul Natanael Valverde Ruiz

<br>

---

## The challenge

Future crews on Mars will need to know where it is safe to walk, where radiation is highest, where the ground gets dangerously cold and where the science is. That information already exists in NASA's orbital and rover data, but it is scattered across instruments, file formats and archives.

Marsift Survival Map brings those datasets together into one place you can explore: a survival guide you walk through instead of read. Every hazard, distance and slope on screen comes from a real measurement.

<br>

## How to use it

**1. Open the simulator.** Go to [marsift.lat](https://marsift.lat) on any device. A loading screen shows each NASA dataset as it is prepared, along with live facts about Mars today.

**2. Choose a mode.** The start screen offers two modes:
- **Start EVA** is a guided campaign of five missions.
- **Free mode** is an open simulation where you set the destination and the conditions.

You can also open the **Mars Atlas** directly from the start screen, without starting an EVA.

**3. Set up your astronaut.** Enter body mass, height, age, sex, fitness (VO₂max) and suit type, and choose a difficulty. These values change how fast you walk, how much oxygen and power you use and how quickly you tire. You can also customize the suit's colors and visor.

**4. Read the mission briefing.** Each mission shows its target, the main hazard, the recommended data layer, the distance and climb, the nearest shelter and the current space-weather forecast. A real Curiosity photo shows what you will see on arrival. Use **Plan EVA** to compare routes before you step outside.

**5. Walk and read the data.** Move across the terrain and switch the NASA layers on and off:
- **Slope** marks impassable ledges and boulder fields.
- **Radiation** marks exposed ground.
- **Temperature** marks cold zones that drain your battery.
- **Minerals** marks where your science targets lie.

Keep an eye on the oxygen, power and suit bars, the compass and the minimap.

**6. Reach and scan the target.** Stay inside the target circle to scan it. Each completed objective reveals a scientific fact about what Curiosity found there.

**7. Survive the events.** When a solar storm or a dust storm is forecast, a countdown starts: get to a shelter, the rover or a pressurized habitat before it arrives. Your partner, EVA-2, follows you and may need your help.

**8. Explore the Mars Atlas.** Open the planet-wide map at any time. Search for a place or type coordinates, click any point to see its elevation, pressure and conditions, drop your own pins, measure distances and switch between the flat map and the 3D globe.

<br>

## Features

### Real terrain at real scale
- The 6.1 × 6.1 km EVA zone is built from HiRISE and CTX digital terrain models at 6 m per pixel, with HiRISE orthoimagery and procedural 164 × 164 surface textures.
- Around it, the whole of Gale Crater (413 × 384 km) is rendered in 3D from MOLA topography at 1:1 scale, including the curvature of Mars. Mount Sharp and the crater rim on the horizon are real terrain, not a painted backdrop.

### NASA science layers
| Layer | What it shows | Source |
|---|---|---|
| Slope and boulders | Ledges over 25° are impassable; rough ground slows you down | HiRISE and CTX DTM |
| Radiation | Dose rate depending on how much sky is exposed | Curiosity RAD |
| Temperature | Ground temperature through the day | Curiosity REMS and Mars Odyssey THEMIS |
| Minerals | Clays, sulfates, boxwork veins and basaltic sand | MRO CRISM |

### Survival and physiology
- Oxygen, battery and suit integrity respond to your effort, the slope, the cold and your radiation exposure.
- Metabolic cost uses the Pandolf model adjusted to Martian gravity, with heart rate, VO₂ and fatigue tracked live.
- Shelters, a pressurized rover and walk-in habitats let you recover between legs of the EVA.

### Martian physics
- Gravity of 3.72 m/s² (0.38 g), with low-gravity jumps and falls.
- Inertia, slope traction and sliding on loose regolith.
- Collisions with terrain, structures and rocks; loose crates, barrels and boulders slide, roll and can be pushed.
- A drivable rover with rocker-bogie suspension that follows the terrain.

### Weather and the sky
- **Solar particle events:** the forecast comes from NASA DONKI (live data, a saved snapshot, or the real May 2024 storm that Curiosity measured), with an aurora and particle hits on the camera.
- **Surface weather:** regional dust storms with an advancing dust wall, dust devils and gusting wind.
- **The Sun:** drawn at its true apparent size for today's Mars–Sun distance.
- **The moons:** Phobos and Deimos follow their real orbits, with phases and eclipses.
- **The planets:** Earth, Venus, Jupiter and the others appear where they really are in the Martian sky today.

### Mars Atlas
- A full-planet map, flat or as a 3D globe, built from MOLA elevation.
- Craters, volcanoes, landers and natural phenomena, each with protection guidance.
- The complete Curiosity traverse and its drill sites.
- Place and coordinate search, a live readout of latitude, longitude and elevation, personal pins, a great-circle ruler, elevation profiles and CSV export of your own track.

### A populated landscape
The base, relay antennas, supply caches, weather stations, a seismometer and 13 Curiosity drill sites are placed by a script that reads the real traverse and terrain data.

<br>

## Two modes

| Mode | Description |
|---|---|
| **Start EVA** (guided campaign) | Five missions built on Curiosity's real stops: the Glen Torridon clays, the sulfate unit, the Gediz Vallis sulfur stones and the boxwork region. Includes an arrival cinematic, a solar storm and a final score. A full campaign takes about 20 to 30 minutes. |
| **Free mode** (simulation) | No predefined goal. Choose your destination, start point and waypoints on the map, compare routes and their resource cost, set the local time and conditions, trigger storms and measure any point on the surface. |

<br>

## Devices and controls

The interface adapts to each screen. Phones and tablets get touch controls, compact panels that respect the screen's safe area, a full-screen atlas and a lighter graphics preset.

| Action | Keyboard and mouse | Touch (phone and tablet) |
|---|---|---|
| Move or drive | W A S D | On-screen joystick |
| Look around | Mouse (click to capture) or drag | Drag on the screen |
| Camera distance | Mouse wheel | Pinch |
| Jump | Space | Jump button |
| Board or leave the rover | E | Action button |
| Data layers | 1 – 4 | Layer bar |
| Suggested route (A*) | R | Route button |
| Mars Atlas | M | Map button; two-finger gestures in 3D |
| Emotes | Z X C V B | Emote menu |
| Help EVA-2 (your partner) | Hold F | Hold the help button |
| Pause | Esc | Pause button |

Add `?debug=1` to the address to show the frame rate and enable test shortcuts.

<br>

## Run it locally

```bash
cd mars-survival-map
npm install
npm run dev        # http://127.0.0.1:5173
npm run build      # production build in dist/
npm test           # data, terrain, texture, pathfinding and touch-input checks
```

Every push to `main` that changes `mars-survival-map/` is built and published automatically by `.github/workflows/deploy.yml`.

#### Optional: live space weather
```bash
VITE_NASA_API_KEY=your_key npm run dev                    # live DONKI data in the browser
NASA_API_KEY=your_key node data/scripts/fetch_donki.mjs   # save an offline snapshot
```
Free keys are available at [api.nasa.gov](https://api.nasa.gov). The public `DEMO_KEY` allows about 30 requests per hour.

<br>

## Project structure

| Path | Contents |
|---|---|
| `src/engine/` | Rendering and simulation: terrain and sky, MOLA far terrain, physics, astronaut, rover, structures, colony, interiors, moons, planets, wind and dust effects |
| `src/gameplay/` | Mission flow, resources, weather, the EVA-2 partner, A* pathfinding, route planner, difficulty, achievements and the shared simulation core |
| `src/ui/` | HUD, Mars Atlas (2D and 3D), route planner, astronaut profile, pause screens, arrival cinematic and touch controls |
| `public/layers/` | Processed NASA layers: elevation, slope, radiation, thermal, spectral, cost grid, objectives, rules and structures |
| `public/atlas/` | MOLA global and Gale rasters, the Curiosity traverse and drill sites |
| `data/scripts/` | Python and Node pipelines that download and process the NASA data |
| `tests/` | Automated checks: data contracts, pathfinding, resource locks, save and restore, equivalence and touch input |
| `docs/` | Rules, sources, physiology model, atlas, survival guide, story, wireframes and video script (in Spanish) |

<br>

## Rebuilding the data

```bash
python3 -m pip install numpy rasterio pillow
python3 data/scripts/fetch_nasa.py          # downloads only the study area from USGS
python3 data/scripts/build_layers.py        # builds public/layers/
python3 data/scripts/build_textures.py      # HiRISE textures in public/textures/
node data/scripts/build_atlas.mjs           # MOLA atlas in public/atlas/
node data/scripts/build_structures.mjs      # structure placement from real data
```

<br>

## NASA data sources

| Mission or service | Data used |
|---|---|
| **MRO HiRISE and CTX** | Digital terrain models and orthoimages (USGS Astrogeology) |
| **MRO CRISM** | Mineral mapping |
| **Mars Odyssey THEMIS** | Thermal inertia |
| **MGS MOLA** | Global and Gale Crater topography (NASA PDS Geosciences Node) |
| **MSL Curiosity** | Traverse and drill sites (JPL MMGIS), RAD radiation, REMS weather |
| **NASA DONKI** | Space weather (CCMC / GSFC) |
| **JPL** | Planetary ephemerides and the Mars24 time model |

Full processing notes are in `docs/fuentes.md`.

<br>

## Accuracy notes

Distances, elevations, gravity, the sky and the terrain are all at real scale. To fit a complete EVA into a single session, time runs 14 times faster and walking speed is compressed to match. Radiation damage to the suit is exaggerated so its effect is visible within minutes; the real surface dose of about 0.21 mGy per day is not dangerous in the short term. `docs/guia_supervivencia.md` explains in detail what is realistic and what is simplified.

<br>

---

<div align="center">
<sub>Built for the NASA Space Apps Challenge &nbsp;·&nbsp; Data courtesy of NASA, JPL-Caltech, USGS Astrogeology and the MRO, MGS, Mars Odyssey and MSL science teams</sub>
</div>