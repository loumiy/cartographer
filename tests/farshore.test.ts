import { describe, expect, it } from 'vitest';
import { chartPrice, inSailable } from '../src/game/core';
import { arrive, buyProvisions, setSail, settle } from '../src/game/economy';
import { findPath } from '../src/game/pathfind';
import { addWaypoint, resolve, reveal } from '../src/game/sea';
import { deserialize, newGame, serialize } from '../src/game/state';
import { Cell } from '../src/game/types';
import { generateWorld, idx, inRect } from '../src/game/world';

describe('the far shore', () => {
  it('puts the far port in a corner of the first sea, on a continent along the world edge, reachable from home', () => {
    const corners = new Set<string>();
    for (const seed of ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8']) {
      const w = generateWorld(seed);
      corners.add(w.corner);
      const far = w.ports[1];
      expect(w.width).toBe(240);
      expect(w.height).toBe(168);
      expect(inRect(w.firstSea, far.dock.x, far.dock.y)).toBe(true);
      expect(far.dock.x).toBeGreaterThan(100);
      expect(w.cells[idx(w, far.x, far.y)]).toBe(Cell.Land);
      expect(w.landmasses[w.landmassOf[idx(w, far.x, far.y)]].farShore).toBe(true);
      // On the world's edge: the far port's row is within a few cells of the top or bottom.
      expect(Math.min(far.y, w.height - 1 - far.y)).toBeLessThan(12);
      expect(w.corner === 'se' ? far.y > w.height / 2 : far.y < w.height / 2).toBe(true);
      // Reachable from home without leaving the first sea.
      const all = new Uint8Array(w.width * w.height).fill(1);
      const home = w.ports[0].dock;
      const path = findPath(w, { known: all, bounds: w.firstSea }, { x: home.x + 0.5, y: home.y + 0.5 }, { x: far.dock.x + 0.5, y: far.dock.y + 0.5 });
      expect(path).not.toBeNull();
    }
    expect(corners.size).toBe(2);
  });

  it('keeps the ship in the first sea until the far port is sighted, then opens the world', () => {
    const s = newGame('bounds');
    buyProvisions(s, 300);
    setSail(s);
    const outside = s.world.corner === 'se' ? { x: 60, y: 10 } : { x: 60, y: 150 };
    expect(inSailable(s, outside.x, outside.y)).toBe(false);
    addWaypoint(s, outside.x, outside.y);
    expect(s.voyage!.waypoints.length).toBe(0);

    const far = s.world.ports[1];
    s.ship.x = far.dock.x + 0.5;
    s.ship.y = far.dock.y + (s.world.corner === 'se' ? -3.5 : 3.5);
    reveal(s);
    expect(far.known).toBe(true);
    expect(s.expanded).toBe(true);
    expect(s.pending[0]?.kind).toBe('far_port');
    expect(inSailable(s, outside.x, outside.y)).toBe(true);

    // Making for the far port ends the voyage there, and the next one starts from it.
    resolve(s, 'port');
    expect(s.voyage!.waypoints.length).toBeGreaterThan(0);
    arrive(s, 1);
    expect(s.portId).toBe(1);
    expect(s.pending[0]?.title).toContain(far.name);
    settle(s);
    buyProvisions(s, 300);
    setSail(s);
    expect(Math.floor(s.ship.x)).toBe(far.dock.x);
    expect(s.voyage!.startPort).toBe(1);
  });

  it('prices cargo and charts by port once both are known', () => {
    const s = newGame('prices');
    s.world.ports[1].known = true;
    s.expanded = true;
    const item = { id: 1, kind: 'area' as const, label: 'x', value: 100, ref: 1, x: s.world.ports[1].dock.x, y: s.world.ports[1].dock.y };
    // A chart of waters near the far port sells better at home than there.
    expect(chartPrice(s, item, s.world.ports[0])).toBeGreaterThan(chartPrice(s, item, s.world.ports[1]));
    expect(s.world.ports[0].prices.spice).toBeGreaterThan(s.world.ports[1].prices.spice);
  });

  it('migrates a V1 save onto the larger world', () => {
    const s = newGame('old-save');
    const oy = s.world.firstSea.y0;
    const site = s.world.sites.find((q) => q.y >= oy && q.y < oy + 84 && q.x < 120)!;
    const known = new Uint8Array(120 * 84);
    known[42 * 120 + 30] = 1;
    const v1 = {
      ...s,
      version: 1,
      known,
      world: {
        seed: 'old-save',
        width: 120,
        height: 84,
        landmasses: [],
        sites: [{ id: 7, x: site.x, y: site.y - oy, type: site.type, surveyed: true, knownBy: 1, stock: 3 }],
        wrecks: [],
      },
      chartCase: [{ id: 5, kind: 'site', label: 'old', value: 50, ref: 7 }],
      cash: 777,
    };
    const t = deserialize(serialize(v1 as never))!;
    expect(t.version).toBe(2);
    expect(t.cash).toBe(777);
    expect(t.known[idx(t.world, 30, 42 + oy)]).toBe(1);
    const moved = t.world.sites[site.id];
    expect(moved.surveyed).toBe(true);
    expect(t.chartCase[0].ref).toBe(site.id);
    expect(t.pending[0]?.title).toBe('A larger sheet');
  });
});
