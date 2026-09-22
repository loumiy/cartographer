import { Rng } from '../rng';
import { CONFIG } from './config';
import { findPath, pathLength } from './pathfind';
import { cellAt, idx, inBounds, remoteness } from './world';
import { Cell, type GameState, type Interrupt, type Site } from './types';

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
  return CONFIG.provisionCapBase + CONFIG.provisionCapPerLevel * state.upgrades.stores;
}

export function cargoCap(state: GameState): number {
  return CONFIG.cargoCapBase + CONFIG.cargoCapPerLevel * state.upgrades.hold;
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

export function distToDock(state: GameState): number {
  const d = state.world.dock;
  return Math.hypot(state.ship.x - (d.x + 0.5), state.ship.y - (d.y + 0.5));
}

/** Re-plan the route home over charted water and estimate its length in days. */
export function updateHomeEstimate(state: GameState) {
  const v = state.voyage;
  if (!v) return;
  const dock = state.world.dock;
  const path = findPath(state.world, { known: state.known }, state.ship, { x: dock.x + 0.5, y: dock.y + 0.5 });
  if (!path) {
    v.homeRoute = [];
    v.homeDays = Infinity;
    return;
  }
  v.homeRoute = path;
  v.homeDays = Math.ceil(pathLength(state.ship, path) / CONFIG.speedOpen);
}

/** Unit price of a site's cargo: richer is dearer, and every ship that knows the route cuts it. */
export function unitPrice(site: Site): number {
  const base = CONFIG.resources[site.type].price * (0.8 + 0.4 * site.richness);
  return base * knownFactor(site.knownBy);
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
  return 0.05 + 0.12 * site.richness + 0.08 * (1 - remoteness(state.world, site.x));
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
