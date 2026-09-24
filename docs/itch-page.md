# itch.io page

Copy for the game's itch.io page. Written to `docs/style-guide/voice.md`: the log voice for the quoted entries, the interface voice for everything else.

## Tagline

Chart an unknown sea. Sell what you find, or keep it secret.

## Short description

A voyage game about blank paper. Captain one small ship into a fog-covered sea, ink every coast you sight, and decide whether each discovery is worth more sold or kept.

## Description

> *Day 14. Birds at dawn, heading south-west. Water casks at a third. The men are quiet.*

You owe £2,500 on a pinnace, and the sea past the harbour mouth is blank paper. Everything you know about it, you will have drawn yourself.

**Cartographer** is a voyage game set in the Age of Exploration. Plot a course, let the days run, and stop when the sea asks something of you. Every coast you sight is inked onto your chart, and the chart is what you sell.

### Every day past halfway is a bet

Stores are the clock. The chart marks your point of no return, and the ship will carry on past it if you tell her to. Seabirds and driftwood point to land beyond your sight. Storms, calms, sickness and spoiled bread rooms arrive on their own schedule. Cut rations and you sail farther; the hands fall ill more often.

### Land, and what to do with it

Send a shore party for water and food. Survey the coast for timber, furs, spice or pearls, and load what the hold can take. Name every island, cape and bay you find; the names stay on your chart. Foraged land needs a season to recover, so long voyages are made by island hopping.

### Sell it, or keep it

Back in port, sell your chart to the Admiralty and everyone learns what you found. Or keep a rich site to yourself and haul its cargo at full price, until someone else stumbles on it.

### Then the world gets bigger

Somewhere in a far corner of the first sea lies another port, held by another power. Nothing tells you which corner. Find it and the chart grows to four seas: a cold one with drifting ice or a warm one full of storms, and rich, remote waters to the east. Then:

- Trade between two ports, each with its own prices for cargo and charts.
- Found trading posts on the sites you surveyed.
- Buy a brig, captain her, and put your old ship on a route over charted water. It earns each season without you.
- Work towards a Crown charter for your own trading company.

There's no final voyage. Pay off the ship and she's yours; sail on as long as you like.

### Features

- A new sea from every seed. Type a chart seed on the title screen to sail a particular one, or share yours with a friend.
- A period chart of vellum, ink and hatched fog, with pan and zoom.
- Time stops for every decision. There's no timer on a choice.
- Autosaves in your browser. Lose the ship and you can return to port before the voyage, at the cost of everything that voyage found.
- Playable with the mouse or the keyboard.

### Controls

| Action | Mouse | Keyboard |
| --- | --- | --- |
| Add a waypoint | Click the chart | |
| Remove the last waypoint | Right-click | Backspace |
| Set sail or heave to | | Space |
| Time speed | | 1–3 |
| Turn for home | | H |
| Pick a choice on an event card | Click | 1–9 |
| Pan and zoom | Drag, scroll or pinch | |
| Centre on the ship | Rose button | |

A voyage takes 3 to 8 minutes. Paying off the ship takes an hour or two, and the far shore takes as long as you like.

## Suggested page settings

- **Classification:** Game
- **Kind of project:** HTML (upload the zipped `dist/` folder from `npm run build`; tick "This file will be played in the browser")
- **Genre:** Strategy (alternatively Simulation)
- **Tags:** exploration, sailing, age-of-exploration, map, procedural-generation, trading, singleplayer, historical, cartography
- **Inputs:** Mouse, Keyboard
- **Average session:** About a half-hour
- **Languages:** English

## Embed options

- **How should your project be run:** Embed in page.
- **Viewport dimensions:** 1280 × 720, set manually. At this size the ledger sits beside the chart and the chart is 920 px wide. The ledger scrolls inside its own column, so the frame never needs to. At 960 × 600 it still works but the chart shrinks to 600 px. Below 860 px wide the ledger drops under the chart and the whole page has to scroll.
- **Mobile friendly:** Off for now. Touch pan, pinch zoom and tap-to-waypoint work, and narrow screens stack the ledger under the chart, but removing a single waypoint needs right-click or Backspace (touch players only have "Clear course"), and it hasn't been tried on a phone. If you turn it on, pick portrait, which suits the stacked layout.
- **Automatically start on page load:** Off. The build is small, so it would load fine, but a click to launch also focuses the frame, and the game's keys (Space, 1–3, H) only reach it once the frame has focus. Otherwise Space scrolls the itch page.
- **Fullscreen button:** On. The chart is the screen, and more room is always better.
- **Enable scrollbars:** Off. At 1280 × 720 the layout fits the frame exactly. Turn it on only if you choose a frame narrower than 860 px.
- **SharedArrayBuffer support:** Off. The game doesn't use it.
