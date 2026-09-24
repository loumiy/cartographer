import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/game/config';
import { cargoCap, provisionCap, secretRisk } from '../src/game/core';
import { processSeason } from '../src/game/economy';
import {
  buyShip,
  checkMilestones,
  collectFromPost,
  createRoute,
  endRoute,
  foundPost,
  planRoute,
  processHoldings,
  resupplyPost,
  routeLossChance,
  takeCommand,
} from '../src/game/holdings';
import { newGame } from '../src/game/state';
import type { GameState, Site } from '../src/game/types';

function withSite(seed: string): { s: GameState; site: Site } {
  const s = newGame(seed);
  s.milestones.push('far_shore');
  const site = s.world.sites.find((q) => q.x < 120 && q.y >= s.world.firstSea.y0 && q.y < s.world.firstSea.y1)!;
  site.surveyed = true;
  site.knownBy = 1;
  s.cash = 5000;
  s.ship.cargo = [{ siteId: site.id, type: 'timber', qty: 40 }];
  return { s, site };
}

describe('trading posts', () => {
  it('costs money and timber, and gathers the site’s cargo each season', () => {
    const { s, site } = withSite('post');
    const post = foundPost(s, site)!;
    expect(post).not.toBeNull();
    expect(s.cash).toBe(5000 - CONFIG.post.cost);
    expect(s.ship.cargo[0].qty).toBe(40 - CONFIG.post.timber);
    expect(s.milestones).toContain('first_post');
    post.warehouse = 0;
    processHoldings(s);
    expect(post.warehouse).toBe(site.maxStock * CONFIG.post.yield);
    expect(site.stock).toBe(0);
    s.ship.cargo = [];
    const got = collectFromPost(s, post);
    expect(got).toBeGreaterThan(0);
    // A post makes the secret likelier to leak.
    const before = secretRisk(s, site);
    post.abandoned = true;
    expect(secretRisk(s, site)).toBeLessThan(before);
  });

  it('declines without supplies and is abandoned in the end; a resupply resets it', () => {
    const { s, site } = withSite('neglect');
    const post = foundPost(s, site)!;
    post.warehouse = 0;
    s.day += CONFIG.season * CONFIG.post.fullFor;
    processHoldings(s);
    expect(post.warehouse).toBe(Math.round((site.maxStock * CONFIG.post.yield) / 2));
    s.ship.provisions = 500;
    resupplyPost(s, post);
    expect(post.lastSupplied).toBe(s.day);
    s.day += CONFIG.season * CONFIG.post.abandonAt;
    processHoldings(s);
    expect(post.abandoned).toBe(true);
    expect(s.news.some((n) => n.includes('abandoned'))).toBe(true);
  });
});

describe('ships and routes', () => {
  it('buys a brig and can shift command to her, taking the refits of the hull', () => {
    const s = newGame('brig');
    s.cash = 5000;
    const old = s.ship.name;
    const brig = buyShip(s, 'brig')!;
    expect(s.fleet.length).toBe(1);
    takeCommand(s, brig.id);
    expect(s.ship.kind).toBe('brig');
    expect(s.ship.name).toBe(brig.name);
    expect(cargoCap(s)).toBe(CONFIG.ships.brig.hold);
    expect(provisionCap(s)).toBe(CONFIG.ships.brig.stores);
    expect(s.fleet[0].name).toBe(old);
    expect(s.fleet[0].kind).toBe('pinnace');
  });

  it('plans a route only over charted water, earns each season and keeps its posts supplied', () => {
    const { s, site } = withSite('route');
    const post = foundPost(s, site)!;
    const ship = buyShip(s, 'pinnace')!;
    const stops = [
      { kind: 'port' as const, id: 0 },
      { kind: 'post' as const, id: post.id },
    ];
    expect(typeof planRoute(s, stops)).toBe('string'); // Nothing charted yet.
    s.known.fill(1);
    const plan = planRoute(s, stops);
    expect(typeof plan).not.toBe('string');
    const route = createRoute(s, ship.id, stops);
    expect(typeof route).not.toBe('string');
    expect(s.milestones).toContain('first_route');
    if (typeof route === 'string') return;
    route.risk = 0;
    post.warehouse = 10;
    const cash = s.cash;
    s.day += CONFIG.season * 2;
    processHoldings(s);
    expect(post.warehouse).toBe(0);
    expect(post.lastSupplied).toBe(s.day);
    expect(s.cash).not.toBe(cash);
    expect(route.lastIncome).not.toBe(0);
    endRoute(s, route.id);
    expect(s.fleet[0].routeId).toBeNull();
  });

  it('can lose a route ship', () => {
    const s = newGame('lost');
    s.cash = 5000;
    s.world.ports[1].known = true;
    s.expanded = true;
    s.milestones.push('far_shore');
    s.known.fill(1);
    const ship = buyShip(s, 'pinnace')!;
    const route = createRoute(s, ship.id, [
      { kind: 'port', id: 0 },
      { kind: 'port', id: 1 },
    ]);
    if (typeof route === 'string') throw new Error(route);
    // Even on the stormiest route a loss is rare: it takes many seasons.
    route.risk = 1;
    expect(routeLossChance(s, route)).toBeLessThanOrEqual(CONFIG.route.maxRisk * CONFIG.route.lossShare);
    let seasons = 0;
    while (s.fleet.length && seasons < 5000) {
      processHoldings(s);
      seasons++;
    }
    expect(s.fleet.length).toBe(0);
    expect(s.routes.length).toBe(0);
    expect(seasons).toBeGreaterThan(3);
  });

  it('pays for a post and a pinnace within a few seasons, and keeps its ship in repair', () => {
    const { s, site } = withSite('payback');
    s.world.ports[1].known = true;
    s.expanded = true;
    const post = foundPost(s, site)!;
    const ship = buyShip(s, 'pinnace')!;
    s.known.fill(1);
    const route = createRoute(s, ship.id, [
      { kind: 'port', id: 0 },
      { kind: 'post', id: post.id },
    ]);
    if (typeof route === 'string') throw new Error(route);
    // A typical route is very unlikely to be lost in a season.
    expect(routeLossChance(s, route)).toBeLessThan(0.02);
    route.risk = 0;
    let earned = 0;
    for (let n = 0; n < 4; n++) {
      const cash = s.cash;
      processHoldings(s);
      earned += s.cash - cash;
    }
    const invested = CONFIG.post.cost + CONFIG.ships.pinnace.cost;
    // Four seasons of a single-post route go most of the way to paying back post and ship.
    expect(earned).toBeGreaterThan(invested * 0.6);
    expect(s.fleet[0].hull).toBe(100);
  });
});

describe('milestones', () => {
  it('grants the Crown charter once the other goals are met', () => {
    const s = newGame('charter');
    s.milestones.push('far_shore', 'first_route', 'half_charted', 'three_posts');
    const cash = s.cash;
    checkMilestones(s);
    expect(s.milestones).toContain('charter');
    expect(s.cash).toBe(cash + CONFIG.charterReward);
    expect(s.pending.some((p) => p.title === 'A Crown charter')).toBe(true);
  });

  it('runs holdings as part of the season', () => {
    const { s, site } = withSite('season');
    const post = foundPost(s, site)!;
    post.warehouse = 0;
    processSeason(s);
    expect(post.warehouse).toBeGreaterThan(0);
  });
});

describe('the brig as an explorer', () => {
  it('outranges, outsails and outsees a pinnace', async () => {
    const { openSpeed, sightRadius } = await import('../src/game/core');
    const s = newGame('brig-range');
    const pinnace = { cap: provisionCap(s), speed: openSpeed(s), sight: sightRadius(s) };
    s.ship.refits.stores = CONFIG.storesLevels.length;
    const fullPinnace = provisionCap(s);
    s.ship.kind = 'brig';
    s.ship.refits.stores = 0;
    // A new brig carries more than a fully refitted pinnace...
    expect(provisionCap(s)).toBeGreaterThan(fullPinnace);
    s.ship.refits.stores = CONFIG.storesLevels.length;
    // ...and fully refitted, about twice as much.
    expect(provisionCap(s)).toBeGreaterThanOrEqual(2 * fullPinnace);
    expect(openSpeed(s)).toBeGreaterThan(pinnace.speed);
    expect(sightRadius(s)).toBe(pinnace.sight + 1);
  });
});
