# Cartographer

Age-of-Exploration voyage game (V1). Design: `docs/design-doc.md`.

- Stack: Vite + TypeScript, no UI framework. Canvas chart in `src/ui/chart.ts`; DOM panels in `src/ui/`.
- Game logic lives in `src/game/` and must stay free of DOM code so it can be unit tested (`npm test`).
- All tuning numbers live in `src/game/config.ts`.
- Checks: `npm run typecheck`, `npm test`, `npm run build`.

Follow docs/style-guide/ (start with README.md). Use only tokens from src/styles/tokens.css; no raw colors or fonts. Map symbols follow chart.md; all player-facing text follows voice.md.
