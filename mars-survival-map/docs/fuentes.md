# Fuentes de datos NASA (Miembro 3)

Accedido: **2026-11-14** con `data/scripts/fetch_nasa.py`. Las capas en `public/layers/` usan estos datos (`layers.json -> source: "real"`). La procedencia completa, con URL de cada archivo, está en `data/raw/manifest.json` y en `layers.json -> provenance`.

## Productos usados
| Capa | Producto | Fuente | ID | Resolución | Cobertura del recorte |
|---|---|---|---|---|---|
| Topografía (base) | DTM CTX controlado, ajustado al geoide | USGS Astrogeology ARD (STAC `mro_ctx_controlled_usgs_dtms`) | `T01_000815_1749_XN_05S222W__P21_009149_1752_XI_04S222W` | 20 m | 100 % |
| Topografía (detalle) | DTM HiRISE (SOCET SET) | USGS Astrogeology ARD (STAC `mro_hirise_socet_dtms`) | `DTEEC_009149_1750_009294_1750_U01` | 1 m (leído a 3 m) | ~81 % |
| Topografía (detalle) | DTM HiRISE (SOCET SET) | ídem | `DTEEC_019698_1750_019988_1750_U01` | 1 m (leído a 3 m) | ~55 % |
| Topografía (detalle) | DTM HiRISE (SOCET SET) | ídem | `DTEEC_009650_1755_009716_1755_U01` | 1 m (leído a 3 m) | ~28 % |
| Óptico | Ortoimagen CTX (DRG) del mismo par | USGS Astrogeology ARD | `T01_000815_…_P21_009149_…` | 20 m | 100 % |
| Traza y elevación de Curiosity | MSL waypoints (posición por sol, `elev_geoid`) | NASA/JPL MMGIS: https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json | — | puntos | 857 paradas (sols 1691–4983) |
| Radiación | Dosis de superficie de MSL/RAD: 0,21 ± 0,04 mGy/día | Hassler et al. (2014), *Science* 343, 1244797, doi:10.1126/science.1244797 | — | punto | modelo |
| Temperatura | Rango diurno de la temperatura del suelo de MSL/REMS | NASA/JPL MSL; PDS Atmospheres Node | — | punto | modelo |

Catálogo STAC: https://stac.astrogeology.usgs.gov/api · Bucket: `astrogeo-ard.s3-us-west-2.amazonaws.com` (GeoTIFF optimizados para la nube; solo se descargó la ventana del recorte, 23 MB en total).

## Procesamiento y validación
- **Alineación vertical:** cada DTM se alinea a las elevaciones que midió Curiosity en sus paradas. Desfases que se quitaron: CTX −18,7 m; HiRISE +7,2 m, +13,9 m y +13,3 m. Después HiRISE se funde sobre CTX con un borde suave.
- **Validación:** el DEM final difiere de la elevación de Curiosity en sus 857 paradas con una mediana de **−0,25 m** y una desviación robusta (MAD) de **2,0 m**. El 95 % de los puntos está a menos de 10,9 m.
- **Pendiente:** el 95 % de las paradas de Curiosity están en pendientes de 21° o menos según el DEM. Eso respalda el umbral de bloqueo de 25°.
- **Objetivos:** cada uno está sobre una parada real del rover (`msl_sol` en `data/objectives.json`).

## Aproximaciones (pendientes de reemplazar)
| Capa | Hoy | Producto real pendiente |
|---|---|---|
| Espectral | Estratigrafía confirmada por Curiosity: arcillas entre −4165 y −4078 m (Glen Torridon), sulfatos por encima; boxwork = crestas cerca de los sols 4540–4990; dunas = zonas oscuras de CTX | Índices CRISM (D2300/BD2290 filosilicatos, SINDEX2/BD1900 sulfatos), PDS Geosciences Node (ODE). Pasar con `--spectral` |
| Inercia térmica | Aproximada desde el albedo de CTX (230–520 TIU) | Mosaico cuantitativo de THEMIS (ASU/USGS). Pasar con `--ti` |
| Óptico | CTX a 20 m | Ortoimágenes HiRISE (25 cm) para la textura de detalle de M1 |

## Reproducir
```bash
python3 -m pip install rasterio
python3 data/scripts/fetch_nasa.py      # descarga solo el recorte (~23 MB)
python3 data/scripts/build_layers.py    # genera public/layers/ y data/processed/report.json
```
