import { hashSeed } from '../rng';
import { CONFIG } from './config';
import { log } from './core';
import { generateContracts } from './economy';
import type { GameState } from './types';
import { generateWorld, idx } from './world';

export const SAVE_VERSION = 1;

export function newGame(seed: string): GameState {
  const world = generateWorld(seed);
  const known = new Uint8Array(world.width * world.height);
  // Home waters are already on the chart.
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const near = Math.hypot(x - world.dock.x, y - world.dock.y) <= 7;
      if (x <= world.dock.x + 1 || near) known[idx(world, x, y)] = 1;
    }
  }
  const state: GameState = {
    version: SAVE_VERSION,
    world,
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
      x: world.dock.x + 0.5,
      y: world.dock.y + 0.5,
      crew: CONFIG.crewStart,
      provisions: 120,
      hull: 100,
      supplies: 2,
      cargo: [],
      rations: 'full',
    },
    upgrades: { spyglass: 0, barometer: false, surveyKit: false, stores: 0, hold: 0 },
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
    report: null,
    news: [],
    log: [],
    stats: { cellsCharted: 0, landmassesNamed: 0, earned: 0, treasure: 0 },
  };
  state.contracts = generateContracts(state);
  log(
    state,
    `We hold a ship, a crew and a debt of £${CONFIG.debt.toLocaleString('en-GB')} to the financier of ${world.portName}. Payments fall due each season. West lies the Old Country; east, nothing but blank paper.`,
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

export function deserialize(text: string): GameState | null {
  try {
    const state = JSON.parse(text, (_key, value) => {
      if (value && typeof value === 'object' && Array.isArray(value.$u8)) return Uint8Array.from(value.$u8);
      if (value && typeof value === 'object' && Array.isArray(value.$i16)) return Int16Array.from(value.$i16);
      return value;
    }) as GameState;
    if (state.version !== SAVE_VERSION) return null;
    return state;
  } catch {
    return null;
  }
}
