# Cartographer

A captain's chart table, not a video game HUD. Everything in Cartographer looks like paper, ink and a few precious colours laid out under a lamp: the chart is the hero, and the interface is the ledger and instruments around it.

## Principles

- **The chart is the screen.** The map fills the view. Panels sit at its edge like papers pushed aside, never over the middle of the voyage.
- **Unknown is blank paper, not darkness.** Fog is vellum with faint hatching (`fog` + `ink-faint`), the way real charts left the unknown empty. Discovery is ink arriving on the page.
- **Ink carries meaning.** Four inks do all the signalling: `ink` for fact, `vermilion` for danger, `verdigris` for safe and known, `gilt` for value. If a colour isn't one of these, it's a wash (`sea`, `land`) or paper.
- **Flat paper, few sheets.** No gradients or glows. The only shadow is `shadow-paper`, for a card laid on the table (events, dialogs).
- **Period flavour, modern clarity.** Chart lettering is old; the interface is plain and readable. Never trade legibility for atmosphere.

## Colour

The ground is `vellum` (both themes: day chart table and lamplight). Raised panels use `vellum-deep`. Text is always `ink` or `ink-muted` on those two grounds; every text token passes 4.5:1 on both, in both themes.

- `vermilion`: hazards on the chart, the point of no return, risky choices (cut rations, press on), low-provision warnings.
- `verdigris`: known routes, fulfilled contracts, "safe" outcomes, success toasts.
- `gilt` for marks and fills (resource sites, treasure, secret routes); `gilt-ink` whenever money or value is written as text.
- `sea` and `land` are washes under ink coastlines, never borders or text.
- `ink-faint` is decoration only: rhumb lines, hatching, hairlines. Control borders and focus rings use `ink`.

Never put meaning in colour alone: hazards are also a cross, secrets also a seal, warnings also say what's wrong.

## Type

Two families. **IM Fell English** (`display`) is a 17th-century face used for the title, headings, place names and the captain's log. **Alegreya Sans** (`body`) is a humanist sans for every control, number and sentence of interface. Both load from Google Fonts; fallbacks are Georgia and Gill Sans / Segoe UI.

- Place names are always italic (`place-name`, `place-name-sm`), set along the coast they name.
- Numbers use `figure` with tabular figures so days and money don't jitter as they count.
- Interface text is sentence case. No all-caps labels, no letter-spaced eyebrows.

## Layout and shape

Spacing runs 4 · 8 · 16 · 24 · 40 (`space-1` to `space-10`). The chart and its tiles are square-cornered (`radius-none`); buttons and cards get `radius-sm`; only round marks (resource discs, seals, the ship ring) use `radius-seal`. Panels are separated by an `ink-faint` hairline, not boxes inside boxes.

## Iconography

Engraved-line icons: 1.5px strokes in `ink`, square caps, drawn on a 24px grid, no fills except a `gilt` or `vermilion` accent where the icon *is* the signal. Motifs come from the period toolkit: compass rose, sextant, hourglass (time), barrel (provisions), hull plank (repairs), anchor (port), seal (secret). No emoji, no modern glyphs like cogs or hamburgers on the chart; the pause and speed controls may use plain geometric shapes.

## Motion

Motion shows ink being laid down. Newly sighted coast draws itself along its length (~400 ms); fog lifts by fading its hatching; the course line extends as days pass. No bouncing, no parallax, no ambient loops. Respect reduced-motion: coasts simply appear.

## Accessibility

Text 4.5:1 and controls 3:1 in both themes; every chart symbol distinguishable by shape as well as colour; focus rings 2px `ink` offset 2px; all timed decisions pause the voyage until answered.

See **Chart conventions** for map symbols and **Voice and writing** for words.
