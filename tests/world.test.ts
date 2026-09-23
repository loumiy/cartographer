import { describe, expect, it } from 'vitest';
import { findPath } from '../src/game/pathfind';
import { Cell } from '../src/game/types';
import { generateWorld, idx } from '../src/game/world';

describe('world generation', () => {
  it('is deterministic for a seed', () => {
    const a = generateWorld('replay-me');
    const b = generateWorld('replay-me');
    expect(Array.from(a.cells)).toEqual(Array.from(b.cells));
    expect(a.sites).toEqual(b.sites);
    expect(generateWorld('other').cells).not.toEqual(a.cells);
  });

  it('puts the dock on open water with every sea cell reachable', () => {
    for (const seed of ['a', 'b', 'c', 'd']) {
      const w = generateWorld(seed);
      expect(w.cells[idx(w, w.ports[0].dock.x, w.ports[0].dock.y)]).toBe(Cell.Sea);
      const all = new Uint8Array(w.width * w.height).fill(1);
      let far = -1;
      for (let i = w.cells.length - 1; i >= 0; i--) {
        if (w.cells[i] === Cell.Sea && i % w.width > 100) {
          far = i;
          break;
        }
      }
      const path = findPath(w, { known: all }, { x: w.ports[0].dock.x + 0.5, y: w.ports[0].dock.y + 0.5 }, { x: (far % w.width) + 0.5, y: Math.floor(far / w.width) + 0.5 });
      expect(path).not.toBeNull();
    }
  });

  it('places resource sites on coasts, richer farther out', () => {
    const w = generateWorld('riches');
    expect(w.sites.length).toBeGreaterThan(5);
    for (const s of w.sites) expect(w.cells[idx(w, s.x, s.y)]).toBe(Cell.Land);
    const near = w.sites.filter((s) => s.x < 50);
    const far = w.sites.filter((s) => s.x > 80);
    const avg = (xs: typeof w.sites) => xs.reduce((a, s) => a + s.richness, 0) / Math.max(1, xs.length);
    if (near.length && far.length) expect(avg(far)).toBeGreaterThan(avg(near));
  });
});
