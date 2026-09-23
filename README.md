# Cartographer

An Age-of-Exploration voyage game. You captain one ship into an uncharted, fog-covered sea, chart what you find, and decide whether to sell your charts or keep them secret. Pay off the ship's debt to own her outright, then sail on as long as you like.

This is V1, built from [`docs/design-doc.md`](docs/design-doc.md) and styled per [`docs/style-guide/`](docs/style-guide/README.md).

## Running it

```sh
npm install
npm run dev        # play at http://localhost:5173
npm test           # game-logic tests (vitest)
npm run typecheck
npm run build      # static site in dist/
```

Add `?seed=anything` to the URL to sail a specific sea. The same seed always makes the same map. Games save to the browser automatically.

## How to play

- **In port**, sign a contract or sail freelance, then outfit: crew, provisions, repair supplies, hull repairs, instruments.
- **At sea**, click the chart to drop waypoints (right-click removes the last). Time runs day by day and stops whenever something needs a decision: land sighted, signs of land, storms, sickness, provisions at half and a quarter, the point of no return, reefs ahead, contract objectives.
- **Landfall**: send a shore party for stores, survey the coast for timber, furs, spice or pearls, load cargo, and name what you found.
- **Home**, sell each chart to the Admiralty or keep a resource site secret. Secrets pay full cargo price until someone else finds them.
- Each season (60 days at sea) the financier wants £200, collected when you reach port. Pay off £2,500 and the ship is yours: payments stop and the game carries on. Missing a payment, or losing the ship, ends the game.

Keys: <kbd>Space</kbd> sail/heave to, <kbd>1</kbd>–<kbd>3</kbd> time speed, <kbd>H</kbd> turn for home, <kbd>Backspace</kbd> remove last waypoint, <kbd>1</kbd>–<kbd>9</kbd> pick a choice on an event card.

## Answers to the design doc's open questions

| Question | V1 answer |
| --- | --- |
| What do instruments do with an accurate map? | Spyglass (3 levels): +1 league of sight each. Barometer: storms are announced a day early; a prepared ship takes less damage and can reach shelter farther away. Surveyor's kit: surveys reach 8 leagues of coast instead of 5. |
| Does the Admiralty pay by area or by features? | Both: a rate per square league newly charted, plus a price per landmass (by size) and per resource site (by its cargo value). |
| How is a secret's discovery chance tuned? | Per season, higher for richer sites and sites nearer home: 5% + 12% × richness + 8% × nearness. |
| Debt terms | Regular payments: £200 each season, collected on return to port. You can pay extra at any time. |
| Day ticks or continuous movement? | Continuous movement with day markers: the ship glides; provisions, events and seasons tick per day. |
| Chart style | Period parchment, per the style guide: vellum, fog hatching, inked coasts with waterlining, rhumb lines from the home rose. |

## Code map

- `src/game/`: all rules, no DOM. `config.ts` holds every tuning number; `world.ts` generates the sea; `sea.ts` runs voyages, events and landfall; `economy.ts` handles port, contracts, selling, seasons and debt; `state.ts` creates and saves games.
- `src/ui/`: `chart.ts` draws the canvas chart; `ledger.ts` is the sidebar; `card.ts` is the event card.
- `tests/`: world generation, economy, voyages, and a bot that plays several voyages end to end.
