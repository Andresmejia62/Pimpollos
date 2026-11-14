# Reglas de juego basadas en datos (Miembro 3 → Miembro 2)

Este documento explica `public/layers/rules.json`. **M2 implementa el JSON tal cual**; si algo no se puede, avisar a M3 antes de cambiarlo.

## Del dato a la regla
| Dato NASA | Capa | Regla en el juego | Umbral |
|---|---|---|---|
| DTM CTX + HiRISE, alineados con Curiosity → pendiente | `slope.png` | Más pendiente = más lento y más gasto de O₂; 18–25° desgasta el traje; >25° bloqueado | seguro < 12° · bloqueado > 25° |
| RAD (Curiosity) × cielo visible × altitud | `radiation.png` | Dosis → pérdida de integridad; ×40 durante una tormenta solar | seguro < 8,3 · peligro > 8,7 µGy/h |
| REMS (Curiosity) + inercia térmica (aprox. por albedo CTX; THEMIS pendiente) + orientación al sol | `thermal.png` | Frío → más consumo de energía (+1,5 % por cada °C bajo −20 °C) | seguro > −25 °C · peligro < −45 °C |
| Estratigrafía de la traza de Curiosity (CRISM pendiente) | `spectral.png` | Los objetivos científicos están sobre su mineral; la capa ayuda a encontrarlos | clases 0–4 |
| Todas | `cost.png` / `cost_256.png` | A* para la ruta sugerida | 0 = intransitable |

## Fórmulas por segundo real
```
dt_marte = dt_real * 20

O2       -= 0.0694 * (1 + pendiente/25 si camina) * dt
Energía  -= 0.0556 * (1 + 0.015 * max(0, -20 - T)) * dt
Integridad -= 0.00023 * dosis_uGy_h * (40 si tormenta) * (0.05 si en refugio) * dt
Integridad -= 0.05 * dt   si 18° < pendiente <= 25° y camina
velocidad *= clamp(1 - (pendiente - 12) / 26, 0.5, 1)
```
Sin energía: velocidad × 0,4 y gasto de O₂ × 1,5.

Velocidad base: 7 m/s en el mundo por segundo real (comprimida igual que el tiempo). El recorrido mide ~6,4 km en línea recta (~9 km por terreno), así que se hace en unos 20 minutos reales, dentro de los 24 que dura el oxígeno.

## Cómo se modelan las capas (honestidad científica)
- **Pendiente:** se calcula directamente del DEM (gradiente en una cuadrícula de 6 m) del DTM real CTX+HiRISE. Validación: el 95 % de las paradas de Curiosity están en pendientes de 21° o menos.
- **Radiación:** RAD solo mide en el punto donde está Curiosity, así que **no existe un mapa medido**. Lo modelamos así: dosis base de RAD (0,21 mGy/día ≈ 8,75 µGy/h) × (0,25 + 0,75 × fracción de cielo visible) × (1 + 1 % por cada 100 m de altura). La radiación cósmica llega desde todo el cielo, así que el terreno que tapa el horizonte protege un poco. Las diferencias reales son pequeñas (pocos %) y las explicamos así en la guía.
- **Temperatura:** REMS también mide en un solo punto. Usamos su rango diario para calibrar un modelo donde la amplitud depende de la inercia térmica (la arena se enfría más que la roca) y la temperatura de día depende de la orientación de la pendiente respecto al sol de las 10:00. Ese modelo **no** calcula sombras proyectadas.
- **Espectral:** hoy se deriva de la estratigrafía que Curiosity confirmó en terreno: arcillas entre −4165 y −4078 m (Glen Torridon), sulfatos por encima, boxwork = crestas cerca de la traza de 2025 y dunas = zonas oscuras de CTX. Pendiente: reemplazarla por umbrales de índices CRISM (filosilicatos D2300/BD2290, sulfatos SINDEX2/BD1900).
- **Inercia térmica:** aproximada desde el albedo de CTX (la arena oscura retiene poco calor y la roca clara más). Pendiente: mosaico de THEMIS.

## Estado actual
`source: "real"` en `layers.json`. El DEM es real (CTX + HiRISE, validado contra 857 paradas de Curiosity: mediana −0,25 m, MAD 2,0 m). Radiación y temperatura son modelos calibrados con datos reales; espectral e inercia térmica son aproximaciones (ver `docs/fuentes.md`). Para volver al terreno sintético: `build_layers.py --source synthetic`.
