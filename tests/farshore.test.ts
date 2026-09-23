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

describe('contracts between ports', () => {
  function expandedGame(seed: string) {
    const s = newGame(seed);
    s.world.ports[1].known = true;
    s.expanded = true;
    return s;
  }

  it('offers one-way contracts once the far port is known, and says where each ends', async () => {
    const { generateContracts } = await import('../src/game/economy');
    const s = expandedGame('offers');
    const offers = generateContracts(s);
    expect(offers.length).toBe(4);
    expect(offers.some((c) => c.to === 1)).toBe(true);
    const before = newGame('offers-v1');
    expect(generateContracts(before).every((c) => c.to === 0)).toBe(true);
  });

  it('keeps a contract open when the ship docks at the other port, and pays at the named one', async () => {
    const { acceptContract } = await import('../src/game/economy');
    const s = expandedGame('carry');
    s.contracts = [
      { id: 900, patron: 'Crown', kind: 'despatches', title: 'd', description: '', tier: 0, advance: 10, bonus: 150, from: 0, to: 1, deadline: 60, startDay: null, done: false, sitesFound: [] },
    ];
    acceptContract(s, 900);
    buyProvisions(s, 300);
    setSail(s);
    // Put in at home again first: the contract stays open.
    s.voyage!.leftHome = true;
    s.day += 5;
    arrive(s, 0);
    expect(s.report!.contractResult).toBe('carried');
    expect(s.accepted?.id).toBe(900);
    settle(s);
    setSail(s);
    s.day += 10;
    const cash = s.cash;
    arrive(s, 1);
    expect(s.report!.contractResult).toBe('done');
    expect(s.cash).toBeGreaterThan(cash + 100);
    expect(s.reputation).toBe(1);
  });

  it('fails a carried contract once its deadline has passed', () => {
    const s = expandedGame('late');
    s.accepted = { id: 901, patron: 'Crown', kind: 'despatches', title: 'd', description: '', tier: 0, advance: 0, bonus: 150, from: 0, to: 1, deadline: 5, startDay: null, done: false, sitesFound: [] };
    buyProvisions(s, 300);
    setSail(s);
    s.day += 20;
    arrive(s, 0);
    expect(s.report!.contractResult).toBe('failed');
    expect(s.accepted).toBeNull();
  });

  it('loads a patron’s goods on signing and lands them at the post', async () => {
    const { acceptContract, cargoValue } = await import('../src/game/economy');
    const s = expandedGame('supply');
    const post = { x: 40, y: s.world.firstSea.y0 + 40, name: 'the Crown’s post' };
    s.contracts = [
      { id: 902, patron: 'Crown', kind: 'supply_post', title: 's', description: '', tier: 0, advance: 0, bonus: 200, from: 0, to: 0, deadline: 60, startDay: null, done: false, sitesFound: [], post, goods: 6 },
    ];
    acceptContract(s, 902);
    expect(s.ship.cargo.find((l) => l.type === 'goods')?.qty).toBe(6);
    expect(cargoValue(s)).toBe(0);
    buyProvisions(s, 300);
    setSail(s);
    s.ship.x = post.x + 1.5;
    s.ship.y = post.y + 0.5;
    const lm = s.world.landmassOf[idx(s.world, post.x, post.y)];
    const { openLandfall } = await import('../src/game/sea');
    openLandfall(s, Math.max(0, lm));
    expect(s.pending[0].choices.some((c) => c.id === 'deliver')).toBe(true);
    resolve(s, 'deliver');
    expect(s.voyage!.contract!.done).toBe(true);
    expect(s.ship.cargo.some((l) => l.type === 'goods')).toBe(false);
  });
});

describe('charting a passage', () => {
  it('counts only a continuous charted route that avoids every known hazard', async () => {
    const { passageCharted } = await import('../src/game/economy');
    const s = newGame('passage');
    s.world.ports[1].known = true;
    expect(passageCharted(s)).toBe(false);
    s.known.fill(1);
    expect(passageCharted(s)).toBe(true);
  });
});
