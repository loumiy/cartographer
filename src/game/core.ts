import { Rng } from '../rng';
import { CONFIG } from './config';
import { findPath } from './pathfind';
import { cellAt, idx, inBounds, inRect, remoteness } from './world';
import { Cell, type ChartItem, type GameState, type Interrupt, type Port, type Post, type Rect, type Site } from './types';

/** Run `fn` with the game's saved RNG and store its advanced state back. */
export function withRng<T>(state: GameState, fn: (rng: Rng) => T): T {
  const rng = new Rng(state.rng);
  const out = fn(rng);
  state.rng = rng.state;
  return out;
}

export function log(state: GameState, text: string, tone?: 'good' | 'bad' | 'info') {
  state.log.push({ day: state.day, text, tone });
  if (state.log.length > 200) state.log.splice(0, state.log.length - 200);
}

/** Queue a decision; the voyage waits until it is resolved. */
export function raise(state: GameState, interrupt: Interrupt) {
  state.pending.push(interrupt);
  if (state.voyage) state.voyage.quietDays = 0;
}

/** Pause the voyage with a note in the HUD, no decision required. */
export function alert(state: GameState, text: string, tone: 'good' | 'bad' | 'info' = 'info') {
  state.paused = true;
  state.alert = text;
  log(state, text, tone);
  if (state.voyage) state.voyage.quietDays = 0;
}

export function sightRadius(state: GameState): number {
  return CONFIG.baseSight + state.upgrades.spyglass;
}

export function provisionCap(state: GameState): number {
  return CONFIG.ships[state.ship.kind].stores + levelsSum(CONFIG.storesLevels, state.ship.refits.stores);
}

export function cargoCap(state: GameState): number {
  return CONFIG.ships[state.ship.kind].hold + levelsSum(CONFIG.holdLevels, state.ship.refits.hold);
}

/** Capacity added by the first `n` refit levels. */
export function levelsSum(levels: readonly number[], n: number): number {
  return levels.slice(0, n).reduce((a, b) => a + b, 0);
}

/** How far the stores reach: days at the current crew and rations. */
export function rangeDays(state: GameState, provisions = state.ship.provisions): number {
  return provisions / Math.max(1, dailyRations(state));
}

/**
 * How much of a landmass's forage has come back since it was last foraged: none just after,
 * all of it a season later.
 */
export function forageRecovery(state: GameState, lm: { lastForaged?: number }): number {
  if (lm.lastForaged === undefined) return 1;
  return Math.max(0, Math.min(1, (state.day - lm.lastForaged) / CONFIG.season));
}

/** Expected shore-party yield in crew-days at this landmass now (before the random spread). */
export function forageExpected(state: GameState, lm: { forage: number; kind: string; lastForaged?: number }): number {
  return state.ship.crew * 10 * lm.forage * (CONFIG.forageBySize[lm.kind] ?? 1) * forageRecovery(state, lm);
}

export function crewMax(state: GameState): number {
  return CONFIG.ships[state.ship.kind].crewMax;
}

/** Take hull damage, softened by a stronger hull. Returns the damage actually taken. */
export function hurtHull(state: GameState, dmg: number): number {
  const taken = Math.round(dmg * CONFIG.ships[state.ship.kind].toughness);
  state.ship.hull = Math.max(0, state.ship.hull - taken);
  return taken;
}

/** The active (not abandoned) post at a site, if any. */
export function postAt(state: GameState, siteId: number): Post | undefined {
  return state.posts.find((p) => p.siteId === siteId && !p.abandoned);
}

/** A known sea cell beside a post's site, where a ship lies to reach it. */
export function postAnchor(state: GameState, post: Post): { x: number; y: number } | null {
  const site = state.world.sites[post.siteId];
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const x = site.x + dx;
      const y = site.y + dy;
      if (!isKnown(state, x, y) || cellAt(state.world, x, y) !== Cell.Sea) continue;
      const d = Math.hypot(dx, dy);
      if (d < bestD) {
        bestD = d;
        best = { x: x + 0.5, y: y + 0.5 };
      }
    }
  }
  return best;
}

export function cargoUsed(state: GameState): number {
  return state.ship.cargo.reduce((a, l) => a + l.qty, 0);
}

export function dailyRations(state: GameState): number {
  return state.ship.crew * (state.ship.rations === 'short' ? CONFIG.shortRations : 1);
}

export function daysOfStores(state: GameState): number {
  const use = dailyRations(state);
  return use > 0 ? state.ship.provisions / use : Infinity;
}

/** What can be sailed: the first sea until the far port is found, then the whole world. */
export function bounds(state: GameState): Rect {
  return state.expanded ? { x0: 0, y0: 0, x1: state.world.width, y1: state.world.height } : state.world.firstSea;
}

export function inSailable(state: GameState, x: number, y: number): boolean {
  return inRect(bounds(state), x, y);
}

export function knownPorts(state: GameState): Port[] {
  return state.world.ports.filter((p) => p.known);
}

export function currentPort(state: GameState): Port {
  return state.world.ports[state.portId];
}

export function isKnown(state: GameState, x: number, y: number): boolean {
  return inBounds(state.world, x, y) && state.known[idx(state.world, x, y)] === 1;
}

/** Charted land within r cells of (x, y). */
export function knownLandNear(state: GameState, x: number, y: number, r: number): boolean {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (isKnown(state, nx, ny) && cellAt(state.world, nx, ny) === Cell.Land) return true;
    }
  }
  return false;
}

/** Landmass id of land touching the ship's cell (8-neighbourhood), or -1. */
export function adjacentLandmass(state: GameState, prefer = -1): number {
  const { world, ship } = state;
  const cx = Math.floor(ship.x);
  const cy = Math.floor(ship.y);
  let found = -1;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (!inBounds(world, x, y) || cellAt(world, x, y) !== Cell.Land) continue;
      const lm = world.landmassOf[idx(world, x, y)];
      if (lm === prefer) return lm;
      if (!world.landmasses[lm].home) found = lm;
    }
  }
  return found;
}

export function speed(state: GameState): number {
  const v = state.voyage;
  let s = knownLandNear(state, state.ship.x, state.ship.y, CONFIG.coastRange) ? CONFIG.speedCoast : CONFIG.speedOpen;
  if (v && v.slowDays > 0) s -= 1;
  if (state.ship.crew < 10) s *= 0.75;
  return Math.max(1, s);
}

export function distToDock(state: GameState, port: Port): number {
  return Math.hypot(state.ship.x - (port.dock.x + 0.5), state.ship.y - (port.dock.y + 0.5));
}

/** Charted route from the ship to a point, and its length in days at the speed each stretch will be sailed. */
export function routeTo(state: GameState, to: { x: number; y: number }): { path: { x: number; y: number }[]; days: number } | null {
  const path = findPath(state.world, { known: state.known, bounds: bounds(state) }, state.ship, to);
  if (!path) return null;
  // Slower along charted coasts.
  let days = 0;
  let px = state.ship.x;
  let py = state.ship.y;
  const slow = state.ship.crew < 10 ? 0.75 : 1;
  for (const p of path) {
    const coastal = knownLandNear(state, p.x, p.y, CONFIG.coastRange);
    days += Math.hypot(p.x - px, p.y - py) / ((coastal ? CONFIG.speedCoast : CONFIG.speedOpen) * slow);
    px = p.x;
    py = p.y;
  }
  return { path, days: Math.ceil(days) };
}

/**
 * Re-plan the routes to each known port over charted water. The nearest port is "home" for the
 * Turn-for-home order; the nearest haven, port or trading post, sets the point of no return.
 */
export function updateHomeEstimate(state: GameState) {
  const v = state.voyage;
  if (!v) return;
  v.portDays = state.world.ports.map(() => Infinity);
  v.homeRoute = [];
  v.homeDays = Infinity;
  for (const port of knownPorts(state)) {
    const r = routeTo(state, { x: port.dock.x + 0.5, y: port.dock.y + 0.5 });
    if (!r) continue;
    v.portDays[port.id] = r.days;
    if (r.days < v.homeDays) {
      v.homeDays = r.days;
      v.homeRoute = r.path;
      v.homePort = port.id;
    }
  }
  v.havenDays = v.homeDays;
  for (const post of state.posts) {
    if (post.abandoned) continue;
    const site = state.world.sites[post.siteId];
    // Only posts that could be nearer than the nearest port are worth routing to.
    if (Math.hypot(site.x - state.ship.x, site.y - state.ship.y) / CONFIG.speedOpen >= v.havenDays) continue;
    const at = postAnchor(state, post);
    const r = at && routeTo(state, at);
    if (r && r.days < v.havenDays) v.havenDays = r.days;
  }
}

/**
 * Unit price of a site's cargo: richer is dearer, and every ship that knows the route cuts it.
 * With a port given, that port's market multiplier applies.
 */
export function unitPrice(site: Site, port?: Port): number {
  const base = CONFIG.resources[site.type].price * (0.8 + 0.4 * site.richness);
  return base * knownFactor(site.knownBy) * (port ? port.prices[site.type] : 1);
}

/** What the Admiralty at this port pays for a chart: more for waters near the other port, once there is one. */
export function chartPrice(state: GameState, item: ChartItem, port: Port = currentPort(state)): number {
  const ports = knownPorts(state);
  if (ports.length < 2) return item.value;
  const dist = (p: Port) => Math.hypot(item.x - p.dock.x, item.y - p.dock.y);
  const nearest = ports.reduce((a, b) => (dist(b) < dist(a) ? b : a));
  return Math.round(item.value * (nearest.id === port.id ? CONFIG.chartNearFactor : CONFIG.chartFarBonus));
}

export function knownFactor(knownBy: number): number {
  return 1 / (1 + 0.3 * Math.max(0, knownBy - 1));
}

export function siteSaleValue(site: Site): number {
  const secretPrice = CONFIG.resources[site.type].price * (0.8 + 0.4 * site.richness);
  return Math.round(CONFIG.siteSaleShare * site.maxStock * secretPrice);
}

/** Per-season chance that someone else finds a kept secret: higher for rich sites and sites near home. */
export function secretRisk(state: GameState, site: Site): number {
  // A post is seen by every passing ship: it doubles the risk.
  const post = postAt(state, site.id) ? 2 : 1;
  return post * (0.05 + 0.12 * site.richness + 0.08 * (1 - remoteness(state.world, site.x, site.y)));
}

export function isSecret(site: Site): boolean {
  return site.surveyed && site.knownBy === 1;
}

export function seasonOf(day: number) {
  const idxSeason = Math.floor(day / CONFIG.season);
  return {
    name: CONFIG.seasonNames[idxSeason % 4],
    year: CONFIG.startYear + Math.floor(idxSeason / 4),
    dayOfSeason: (day % CONFIG.season) + 1,
    nextSeasonDay: (idxSeason + 1) * CONFIG.season,
  };
}

export function formatDate(day: number): string {
  const s = seasonOf(day);
  return `Day ${s.dayOfSeason} of ${s.name}, ${s.year}`;
}

export function compass(dx: number, dy: number): string {
  const names = ['east', 'southeast', 'south', 'southwest', 'west', 'northwest', 'north', 'northeast'];
  const a = Math.atan2(dy, dx);
  const i = Math.round(a / (Math.PI / 4));
  return names[(i + 8) % 8];
}

export function landmassLabel(state: GameState, id: number): string {
  const lm = state.world.landmasses[id];
  return lm.name || `an unnamed ${lm.kind}`;
}

export function money(n: number): string {
  const v = Math.round(n);
  return `${v < 0 ? '−' : ''}£${Math.abs(v).toLocaleString('en-GB')}`;
}
