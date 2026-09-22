/** Design tokens read from CSS, so the canvas follows the same theme as the page. */
export interface Palette {
  vellum: string;
  vellumDeep: string;
  fog: string;
  ink: string;
  inkMuted: string;
  inkFaint: string;
  sea: string;
  land: string;
  vermilion: string;
  verdigris: string;
  gilt: string;
  giltInk: string;
  fontDisplay: string;
  fontBody: string;
}

export function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return {
    vellum: v('--vellum'),
    vellumDeep: v('--vellum-deep'),
    fog: v('--fog'),
    ink: v('--ink'),
    inkMuted: v('--ink-muted'),
    inkFaint: v('--ink-faint'),
    sea: v('--sea'),
    land: v('--land'),
    vermilion: v('--vermilion'),
    verdigris: v('--verdigris'),
    gilt: v('--gilt'),
    giltInk: v('--gilt-ink'),
    fontDisplay: v('--font-display'),
    fontBody: v('--font-body'),
  };
}
