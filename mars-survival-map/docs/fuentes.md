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

## Minerales (CRISM) e inercia térmica (THEMIS)
| Capa | Producto | Fuente | Método |
|---|---|---|---|
| Espectral | 7 productos CRISM MTRDR con parámetros espectrales (FRT000058A3, FRT0000B6F1, HRL0000BABA, FRT00021C92, FRT0001BBA1, FRT0001CA91, FRT0000C518). Se leyeron solo 8 de sus 60 bandas, en la ventana del recorte (~9 MB) | PDS Geosciences Node (API ODE) | Mediana por píxel de los productos que lo cubren. Arcillas: D2300 > 0,002 y BD2290 > 0. Sulfatos: SINDEX2 > 0,008 y BD1900_2 o BD2100_2 > 0,002. Arena basáltica: OLINDEX3 alto y albedo bajo. Los umbrales están por debajo de los de Viviano-Beck et al. (2014) porque el polvo de Gale atenúa la señal |
| Inercia térmica | THEMIS, mosaico global cuantitativo 30S120E (100 m) | USGS Astropedia (S3 `asc-astropedia`) | Remuestreada a 6 m y suavizada. Exactitud absoluta ~20 %. En el recorte: 301–528 TIU (mediana 403), coherente con Fergason et al. (2012) |

**Validación independiente:** el 96 % de las arcillas que detecta CRISM caen en la banda de altura de Glen Torridon, donde Curiosity confirmó arcillas, y el 97 % de los sulfatos caen por encima de −4078 m, en la unidad de sulfatos que recorrió el rover. El boxwork no tiene una firma espectral propia: se marca por su forma (crestas cerca de la traza de 2025).

**Pendiente:** la textura de detalle. CTX tiene 20 m; las ortoimágenes HiRISE (25 cm) servirían para que M1 haga el suelo cercano.

## Reproducir
```bash
python3 -m pip install rasterio
python3 data/scripts/fetch_nasa.py      # descarga solo el recorte: DTM, CTX, THEMIS y CRISM (~32 MB)
python3 data/scripts/build_layers.py    # genera public/layers/ y data/processed/report.json
```
