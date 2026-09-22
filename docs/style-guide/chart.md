# Chart conventions

The chart borrows from portolan charts and 17th-century sea charts, simplified so it reads at game zoom.

## Layers, bottom to top

1. `vellum` ground.
2. Washes: `sea` on charted water, `land` on charted land. Uncharted cells stay `fog` with a 45° hatch in `ink-faint` at 6px pitch.
3. Rhumb lines: 16 thin `ink-faint` lines radiating from the home-port compass rose. Decorative orientation, not a grid.
4. Coastline: 1.5px `ink`, with two lines of waterlining offset seaward (1px `ink-faint`, 3px and 7px out).
5. Symbols and place names.
6. The ship, its course, and voyage overlays on top.

## Symbols

| Symbol | Drawing | Ink |
| --- | --- | --- |
| Home port | Compass rose, 8 points | `ink` |
| Harbor / anchorage | Small anchor | `ink` |
| Rock or reef | Cross (+) with dot cluster | `vermilion` |
| Resource site | Filled disc, 10px | `gilt` |
| Kept secret | Resource disc with a seal ring | `gilt` + `ink` |
| Wreck | Broken hull glyph | `ink` |
| Ship | Top-down hull in `ink` inside a `radius-seal` ring | `ink` |
| Planned course | Dashed line, 6/4 | `ink` |
| Track sailed | Solid line, 1px | `ink-muted` |
| Point of no return | Arc around home at current range | `vermilion`, dashed |
| Contract objective | Dotted outline around the target region | `verdigris` |
| Signs of land | Small birds / driftwood glyphs at sight edge | `ink-muted` |

## Place names

Italic `display` face, set along the feature (curved along coasts where possible), never boxed. Player-named places look identical to authored ones: the player is the cartographer. Unnamed discoveries read "Unnamed cape" in `ink-muted` until named.

## Don'ts

No satellite-style terrain, no drop shadows under land, no glowing fog edge, no square-grid lines visible on the chart.
