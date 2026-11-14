# Sistema visual y guía de estilo (Miembro 4)

Objetivo: que cualquier persona entienda el HUD **en menos de un minuto**, aunque no distinga colores.

## Concepto
El HUD es el **visor del casco**: los elementos están en las esquinas, la parte central queda libre para ver el terreno y todo tiene un borde fino, como si estuviera proyectado en el vidrio. Usar `backdrop-filter: blur(6px)` sobre un panel oscuro semitransparente.

## Paleta (tokens CSS)
```css
:root {
  /* superficie del HUD */
  --hud-bg: rgba(12, 10, 14, 0.62);
  --hud-border: rgba(255, 236, 220, 0.22);
  --hud-text: #F6EDE4;
  --hud-text-dim: #BFAFA3;

  /* semántica (igual que rules.json -> palette) */
  --safe: #3DDC97;
  --caution: #FFC23D;
  --danger: #FF4D4D;
  --info: #7FD1FF;

  /* recursos */
  --o2: #7FD1FF;
  --energy: #FFC23D;
  --integrity: #E8E8F0;

  /* minerales (capa espectral) */
  --clay: #4FC3F7;
  --sulfate: #C792EA;
  --boxwork: #FFFFFF;
  --dunes: #5C6BC0;

  /* marca */
  --mars: #C1440E;
  --mars-dust: #DEA070;
}
```
Contraste: el texto `--hud-text` sobre `--hud-bg` (encima del terreno marciano) supera 7:1. Las semánticas, sobre `--hud-bg`, superan 4,5:1.

## Código de peligro (nunca solo con color)
| Nivel | Color | Patrón en capas | Ícono | Borde de alerta | Sonido |
|---|---|---|---|---|---|
| Seguro | Verde `--safe` | Liso tenue | ● círculo | Sólido | — |
| Precaución | Ámbar `--caution` | **Puntos** | ▲ triángulo | Discontinuo | Campanilla |
| Peligro | Rojo `--danger` | **Rayas diagonales** | ⯃ octágono | Doble + parpadeo lento (1 Hz) | Sirena corta |

Los overlays de M3 (`*_overlay.png`) ya incluyen estos patrones.

## Tipografía
- **Rajdhani** (Google Fonts) para títulos y números del HUD: técnica y fácil de leer.
- **Inter** para textos de diálogo y guía.
- Números de recursos en `font-variant-numeric: tabular-nums` para que no "bailen".
- Tamaño mínimo: 14 px en el HUD y 16 px en los diálogos.

## Íconos (ids usados en alerts.json)
`o2`, `battery`, `shield`, `slope`, `wall`, `radiation`, `thermometer`, `sun-storm`, `sun`, `shelter`, `target`, `scan`, `check`, `map`, `info-circle`, `warn-triangle`, `alert-octagon`, `antenna`, `helmet`, `earth`.
Recomendado: **Lucide** (licencia ISC) o Tabler Icons; trazo de 2 px y estilo de línea, sin relleno.

## Layout del HUD (pantalla de juego)
```
┌───────────────────────────────────────────────────────────────┐
│ [O₂ ████████░░ 82%]                     N ── brújula ── E     │
│ [⚡ ██████░░░░ 61%]                                ┌────────┐ │
│ [⛨ █████████░ 95%]                                 │minimapa│ │
│                                                    │ + ruta │ │
│                                                    └────────┘ │
│                    ( zona central libre )                     │
│  ┌─ ▲ ALERTA ─────────────────┐                               │
│  │ Suelo muy frío…            │         Misión 2/5            │
│  └────────────────────────────┘         Piedras amarillas     │
│  ┌ Yara · Base Aeolis ────────────┐     ▸ Gediz Vallis 340 m  │
│  │ El fondo del canal…            │                           │
│  └────────────────────────────────┘ [1 Pend][2 Rad][3 Temp][4 Esp][R Ruta] │
└───────────────────────────────────────────────────────────────┘
```
- **Arriba a la izquierda:** recursos (ícono + barra + %). La barra cambia de patrón por debajo del 40 % (rayas).
- **Arriba al centro:** brújula con marcador del objetivo y distancia.
- **Arriba a la derecha:** minimapa (norte arriba) con jugador, objetivos, refugios y ruta.
- **Abajo a la izquierda:** alerta activa (máximo 2 a la vez) y diálogo.
- **Abajo a la derecha:** misión actual y panel de capas con teclas.
- La capa activa también se muestra como **leyenda flotante** junto al panel de capas (ver `docs/wireframes/index.html`, pantalla 3).

## Pantallas
1. **Inicio:** título, botón "Comenzar EVA", "Guía de supervivencia", selector ES/EN.
2. **Briefing de misión:** título, objetivo, peligro principal (con ícono) y capa recomendada.
3. **Juego:** HUD de arriba.
4. **Objetivo escaneado:** tarjeta con imagen POV (Mastcam/HiRISE), dato curioso (`facts.json`) y puntos.
5. **Misión completada:** desglose del puntaje (ciencia, seguridad, tiempo, tormenta).
6. **Fracaso:** causa, un consejo concreto y botón "Reintentar desde el último refugio".

## Accesibilidad
- Todo peligro se comunica con **color + patrón + ícono + texto**.
- Se puede jugar solo con teclado; las teclas se muestran en pantalla.
- Opción para reducir el parpadeo (respetar `prefers-reduced-motion`).
- Subtítulos siempre activos en los diálogos.
