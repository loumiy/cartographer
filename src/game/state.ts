import { Rng, hashSeed } from '../rng';
import { CONFIG } from './config';
import { log } from './core';
import { generateContracts } from './economy';
import { shipName } from './names';
import type { GameState } from './types';
import { generateWorld, idx } from './world';

export const SAVE_VERSION = 3;

export function newGame(seed: string): GameState {
  const world = generateWorld(seed);
  const home = world.ports[0];
  const fs = world.firstSea;
  const known = new Uint8Array(world.width * world.height);
  // Home waters are already on the chart.
  for (let y = fs.y0; y < fs.y1; y++) {
    for (let x = fs.x0; x < fs.x1; x++) {
      const near = Math.hypot(x - home.dock.x, y - home.dock.y) <= 7;
      if (x <= home.dock.x + 1 || near) known[idx(world, x, y)] = 1;
    }
  }
  const state: GameState = {
    version: SAVE_VERSION,
    world,
    portId: 0,
    expanded: false,
    known,
    rng: hashSeed(`${seed}:play`),
    day: 0,
    cash: CONFIG.startCash,
    debt: CONFIG.debt,
    debtStart: CONFIG.debt,
    paymentPerSeason: CONFIG.paymentPerSeason,
    paymentsDue: 0,
    reputation: 0,
    contractsDone: 0,
    ship: {
      name: shipName(new Rng(hashSeed(`${seed}:ship`)), []),
      kind: 'pinnace',
      refits: { stores: 0, hold: 0 },
      x: home.dock.x + 0.5,
      y: home.dock.y + 0.5,
      crew: CONFIG.crewStart,
      provisions: 120,
      hull: 100,
      supplies: 2,
      cargo: [],
      rations: 'full',
    },
    upgrades: { spyglass: 0, barometer: false, surveyKit: false },
    contracts: [],
    nextId: 1,
    chartCase: [],
    voyage: null,
    voyagesSailed: 0,
    mode: 'port',
    outcome: null,
    paused: true,
    alert: null,
    pending: [],
    accepted: null,
    posts: [],
    fleet: [],
    routes: [],
    milestones: [],
    hintsSeen: [],
    report: null,
    news: [],
    log: [],
    stats: { cellsCharted: 0, landmassesNamed: 0, earned: 0, treasure: 0 },
  };
  state.contracts = generateContracts(state);
  log(
    state,
    `We hold a ship, a crew and a debt of £${CONFIG.debt.toLocaleString('en-GB')} to the financier of ${home.name}. Payments fall due each season. West lies the Old Country; east, nothing but blank paper.`,
    'info',
  );
  return state;
}

// ---------------------------------------------------------------------------
// Saving: typed arrays become plain arrays, everything else is plain JSON.
// ---------------------------------------------------------------------------

export function serialize(state: GameState): string {
  return JSON.stringify(state, (_key, value) => {
    if (value instanceof Uint8Array) return { $u8: Array.from(value) };
    if (value instanceof Int16Array) return { $i16: Array.from(value) };
    return value;
  });
}

/** The game as it stands, as text, without any older checkpoint inside it. */
export function takeCheckpoint(state: GameState): string {
  const { checkpoint: _older, ...rest } = state;
  return serialize(rest as GameState);
}

/**
 * Go back to the quay before the voyage that ended in disaster. Everything from that voyage is
 * lost, the chart it drew included. The weather is not the same the second time round.
 */
export function restoreCheckpoint(state: GameState): GameState | null {
  if (!state.checkpoint) return null;
  const restored = deserialize(state.checkpoint);
  if (!restored) return null;
  const retries = (state.stats.retries ?? 0) + 1;
  restored.stats.retries = retries;
  restored.rng = (restored.rng ^ hashSeed(`retry:${retries}`)) >>> 0;
  restored.checkpoint = state.checkpoint;
  log(restored, 'We are back on the quay, before the voyage that went wrong. What it charted is lost with it.', 'info');
  return restored;
}

export function deserialize(text: string): GameState | null {
  try {
    const state = JSON.parse(text, (_key, value) => {
      if (value && typeof value === 'object' && Array.isArray(value.$u8)) return Uint8Array.from(value.$u8);
      if (value && typeof value === 'object' && Array.isArray(value.$i16)) return Int16Array.from(value.$i16);
      return value;
    }) as GameState;
    const version = state.version as number;
    const game = version === 1 ? migrateV1(state as unknown as V1State) : version === 2 ? migrateV2(state) : version === SAVE_VERSION ? state : null;
    // Saves from before hints existed belong to captains who already know the ropes.
    if (game && !game.hintsSeen && game.voyagesSailed > 0) game.hintsOff = true;
    return game && looksWhole(game) ? game : null;
  } catch {
    return null;
  }
}

/** A light check that a loaded save has the parts the game needs, so a damaged file is refused rather than crashing. */
function looksWhole(state: GameState): boolean {
  const w = state.world;
  const cells = w?.width * w?.height;
  return (
    !!w &&
    w.cells instanceof Uint8Array &&
    w.cells.length === cells &&
    w.landmassOf instanceof Int16Array &&
    state.known instanceof Uint8Array &&
    state.known.length === cells &&
    Array.isArray(w.ports) &&
    !!w.ports[state.portId] &&
    !!state.ship &&
    Number.isFinite(state.ship.x) &&
    Number.isFinite(state.day) &&
    Number.isFinite(state.cash) &&
    ['port', 'sea', 'over'].includes(state.mode) &&
    (state.mode !== 'sea' || !!state.voyage) &&
    Array.isArray(state.pending)
  );
}

// ---------------------------------------------------------------------------
// Chapter 2 moved the first sea into a larger world. A V1 save is redrawn onto it:
// the chart, names, surveys, money and instruments carry over; the ship is in port.
// ---------------------------------------------------------------------------

interface V1State {
  world: {
    seed: string;
    width: number;
    height: number;
    landmasses: { id: number; cx: number; cy: number; name: string; home: boolean }[];
    sites: { id: number; x: number; y: number; type: string; surveyed: boolean; knownBy: number; stock: number }[];
    wrecks: { x: number; y: number; looted: boolean; sighted: boolean }[];
  };
  known: Uint8Array;
  mode: string;
  voyage: unknown;
  [key: string]: unknown;
}

function migrateV1(old: V1State): GameState | null {
  if (old.mode === 'over') return null;
  const s = newGame(old.world.seed);
  const world = s.world;
  const oy = world.firstSea.y0;
  const w1 = old.world.width;
  s.known.fill(0);
  for (let y = 0; y < old.world.height; y++) {
    for (let x = 0; x < w1; x++) {
      if (old.known[y * w1 + x]) s.known[idx(world, x, y + oy)] = 1;
    }
  }
  for (let i = 0; i < s.known.length; i++) {
    const lm = world.landmassOf[i];
    if (s.known[i] && lm >= 0) world.landmasses[lm].discovered = true;
  }
  const lmMap = new Map<number, number>();
  for (const lm of old.world.landmasses) {
    const id = world.landmassOf[idx(world, lm.cx, lm.cy + oy)];
    if (id < 0) continue;
    lmMap.set(lm.id, id);
    if (lm.name && !lm.home && !world.landmasses[id].home) world.landmasses[id].name = lm.name;
  }
  const siteMap = new Map<number, number>();
  for (const os of old.world.sites) {
    const ns = world.sites.find((q) => q.x === os.x && q.y === os.y + oy && q.type === os.type);
    if (!ns) continue;
    siteMap.set(os.id, ns.id);
    ns.surveyed = os.surveyed;
    ns.knownBy = os.knownBy;
    ns.stock = Math.min(ns.maxStock, os.stock);
  }
  for (const ow of old.world.wrecks) {
    const nw = world.wrecks.find((q) => q.x === ow.x && q.y === ow.y + oy);
    if (nw) Object.assign(nw, { looted: ow.looted, sighted: ow.sighted });
  }

  const o = old as unknown as GameState;
  for (const key of ['day', 'cash', 'debt', 'debtStart', 'paymentPerSeason', 'paymentsDue', 'reputation', 'contractsDone', 'voyagesSailed', 'news', 'rng', 'nextId'] as const) {
    (s as unknown as Record<string, unknown>)[key] = o[key];
  }
  const oldUpgrades = o.upgrades as unknown as { spyglass: number; barometer: boolean; surveyKit: boolean; stores: number; hold: number };
  s.log = o.log.slice();
  s.stats = { ...o.stats, cellsCharted: s.known.reduce((a, b) => a + b, 0) };
  const ship = o.ship;
  const home = world.ports[0];
  s.ship = {
    ...ship,
    name: s.ship.name,
    kind: 'pinnace',
    refits: { stores: oldUpgrades.stores ?? 0, hold: oldUpgrades.hold ?? 0 },
    x: home.dock.x + 0.5,
    y: home.dock.y + 0.5,
    rations: 'full',
    cargo: ship.cargo.filter((l) => siteMap.has(l.siteId)).map((l) => ({ ...l, siteId: siteMap.get(l.siteId)! })),
  };
  s.upgrades = { spyglass: oldUpgrades.spyglass, barometer: oldUpgrades.barometer, surveyKit: oldUpgrades.surveyKit };
  s.chartCase = [];
  for (const item of o.chartCase) {
    if (item.kind === 'area') s.chartCase.push({ ...item, x: 60, y: oy + 42 });
    else if (item.kind === 'landmass' && lmMap.has(item.ref)) {
      const lm = world.landmasses[lmMap.get(item.ref)!];
      s.chartCase.push({ ...item, ref: lm.id, x: lm.cx, y: lm.cy });
    } else if (item.kind === 'site' && siteMap.has(item.ref)) {
      const site = world.sites[siteMap.get(item.ref)!];
      s.chartCase.push({ ...item, ref: site.id, x: site.x, y: site.y });
    }
  }
  s.contracts = generateContracts(s);
  s.pending = [
    {
      kind: 'notice',
      title: 'A larger sheet',
      body: `Our charts have been copied onto a larger sheet: there is more to this world than the first sea. ${
        o.voyage ? 'The voyage we were on is over, and the ship lies at home. ' : ''
      }Some coasts may be drawn a little differently.`,
      choices: [{ id: 'ok', label: 'Continue' }],
    },
  ];
  return s;
}

/** Stage-one chapter 2 saves: refits move from the captain's upgrades onto the ship; holdings start empty. */
function migrateV2(state: GameState): GameState {
  const u = state.upgrades as unknown as { spyglass: number; barometer: boolean; surveyKit: boolean; stores?: number; hold?: number };
  const ship = state.ship as GameState['ship'] & Partial<Pick<GameState['ship'], 'name' | 'kind' | 'refits'>>;
  state.ship = {
    ...ship,
    name: ship.name ?? shipName(new Rng(hashSeed(`${state.world.seed}:ship`)), []),
    kind: ship.kind ?? 'pinnace',
    refits: ship.refits ?? { stores: u.stores ?? 0, hold: u.hold ?? 0 },
  };
  state.upgrades = { spyglass: u.spyglass, barometer: u.barometer, surveyKit: u.surveyKit };
  state.posts ??= [];
  state.fleet ??= [];
  state.routes ??= [];
  state.milestones ??= state.expanded ? ['far_shore'] : [];
  if (state.voyage && state.voyage.havenDays === undefined) state.voyage.havenDays = state.voyage.homeDays;
  state.version = SAVE_VERSION;
  return state;
}
