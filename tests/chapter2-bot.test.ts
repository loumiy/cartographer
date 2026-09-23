import { describe, expect, it } from 'vitest';
import { buyProvisions, hireCrew, repairHull, sellCargo, setSail, settle } from '../src/game/economy';
import { buyShip, createRoute, foundPost, warehouseCap } from '../src/game/holdings';
import { courseHome, resolve, stepSea } from '../src/game/sea';
import { deserialize, newGame, serialize } from '../src/game/state';
import type { GameState } from '../src/game/types';

/** Sail to a port, answering every decision with a sensible default. */
function sailTo(s: GameState, portId: number) {
  courseHome(s, portId);
  for (let g = 0; g < 20000 && s.mode === 'sea'; g++) {
    if (s.pending.length) {
      const ids = s.pending[0].choices.filter((c) => !c.disabled).map((c) => c.id);
      resolve(s, ['leave', 'sail', 'shelter', 'ride', 'rest', 'wait', 'leave', 'ok', 'port'].find((x) => ids.includes(x)) ?? ids[0]);
      continue;
    }
    if (!s.voyage!.waypoints.length || s.alert) courseHome(s, portId);
    s.paused = false;
    s.alert = null;
    stepSea(s);
  }
}

describe('chapter 2 over many voyages', () => {
  it('trades between the ports with posts and a route running, saving each time', () => {
    for (const seed of ['c2-a', 'c2-b']) {
      let s = newGame(seed);
      s.known.fill(1);
      s.world.ports[1].known = true;
      s.expanded = true;
      s.milestones.push('far_shore');
      s.cash = 8000;
      s.ship.refits.stores = 2;
      // Two posts and a route ship between them and home.
      const sites = s.world.sites.filter((q) => q.x > 40 && q.x < 110).slice(0, 2);
      for (const site of sites) {
        site.surveyed = true;
        site.knownBy = 1;
        s.ship.cargo = [{ siteId: site.id, type: 'timber', qty: 20 }];
        foundPost(s, site);
      }
      s.ship.cargo = [];
      const brig = buyShip(s, 'brig')!;
      const route = createRoute(s, brig.id, [{ kind: 'port', id: 0 }, ...s.posts.map((p) => ({ kind: 'post' as const, id: p.id }))]);
      expect(typeof route).not.toBe('string');
      s.pending = [];

      for (let n = 0; n < 8 && s.mode === 'port'; n++) {
        hireCrew(s, 12 - s.ship.crew);
        repairHull(s);
        buyProvisions(s, 99999);
        setSail(s);
        expect(s.mode).toBe('sea');
        sailTo(s, 1 - s.portId);
        if (s.mode !== 'port') break;
        settle(s);
        sellCargo(s);
        while (s.pending.length && s.mode === 'port') resolve(s, s.pending[0].choices[0].id);
        for (const post of s.posts) expect(post.warehouse).toBeLessThanOrEqual(warehouseCap(s, post));
        for (const r of s.routes) expect(s.fleet.some((f) => f.id === r.vesselId)).toBe(true);
        expect(Number.isFinite(s.cash)).toBe(true);
        s = deserialize(serialize(s))!;
      }
      expect(s.day).toBeGreaterThan(100);
      expect(s.voyagesSailed).toBeGreaterThan(3);
    }
  });
});
