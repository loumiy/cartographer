# Adding the style guide to the repo

1. Unzip at the repo root. You get `docs/style-guide/` (the guide) and `src/styles/tokens.css` (ready-to-use CSS variables).
2. Import the tokens once at your app entry, e.g. in `src/main.tsx`: `import './styles/tokens.css'`.
3. Use variables and type classes, never raw hex: `color: var(--ink)`, `background: var(--vellum)`, `<h2 className="heading">`.
4. Theme: set `data-theme="day"` or `"lamp"` on `<html>`; with neither, it follows the OS setting.
5. Add this to CLAUDE.md so Claude Code follows the guide:

   > Follow docs/style-guide/ (start with README.md). Use only tokens from src/styles/tokens.css; no raw colors or fonts. Map symbols follow chart.md; all player-facing text follows voice.md.

`tokens.json` is the source of truth. If you change it, regenerate `tokens.css` to match (or ask Claude Code to).
