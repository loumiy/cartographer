import { describe, expect, it } from 'vitest';
import { arrive, buyProvisions, processSeason, setSail, settle } from '../src/game/economy';
import { addWaypoint, passDays, resolve, stepSea } from '../src/game/sea';
import { deserialize, newGame, restoreCheckpoint, serialize } from '../src/game/state';
import type { GameState } from '../src/game/types';

function sailAndChart(seed: string): { s: GameState; before: { cash: number; known: number; day: number; rng: number } } {
  const s = newGame(seed);
  buyProvisions(s, 300);
  const before = { cash: 0, known: s.known.reduce((a, b) => a + b, 0), day: s.day, rng: 0 };
  setSail(s);
  const snap = deserialize(s.checkpoint!)!;
  before.cash = snap.cash;
  before.rng = snap.rng;
  addWaypoint(s, s.ship.x + 20, s.ship.y);
  for (let i = 0; i < 400 && s.mode === 'sea' && s.voyage!.waypoints.length; i++) {
    if (s.pending.length) {
      const ids = s.pending[0].choices.filter((c) => !c.disabled).map((c) => c.id);
      resolve(s, ['sail', 'leave', 'ride', 'rest', 'wait', 'ok'].find((x) => ids.includes(x)) ?? ids[0]);
      continue;
    }
    s.paused = false;
    s.alert = null;
    stepSea(s);
  }
  return { s, before };
}

describe('checkpoints', () => {
  it('takes a checkpoint on setting sail, without nesting older ones', () => {
    const s = newGame('cp-take');
    buyProvisions(s, 300);
    setSail(s);
    expect(s.checkpoint).toBeTruthy();
    const snap = deserialize(s.checkpoint!)!;
    expect(snap.mode).toBe('port');
    expect(snap.checkpoint).toBeUndefined();
  });

  it('offers a return to port when the ship is lost, and rewinds the voyage', () => {
    const { s, before } = sailAndChart('cp-lost');
    expect(s.known.reduce((a, b) => a + b, 0)).toBeGreaterThan(before.known);
    // Wreck her.
    s.ship.hull = 0;
    s.pending = [];
    passDays(s, 1);
    expect(s.mode).toBe('over');
    expect(s.pending[0].choices.map((c) => c.id)).toContain('retry');

    const r = restoreCheckpoint(s)!;
    expect(r.mode).toBe('port');
    expect(r.outcome).toBeNull();
    expect(r.voyage).toBeNull();
    expect(r.cash).toBe(before.cash);
    expect(r.day).toBe(before.day);
    expect(r.known.reduce((a, b) => a + b, 0)).toBe(before.known);
    expect(r.rng).not.toBe(before.rng);
    expect(r.stats.retries).toBe(1);
    // The checkpoint stays, so a second disaster can be taken back too.
    expect(r.checkpoint).toBe(s.checkpoint);
  });

  it('offers it when the financier seizes the ship on return, too', () => {
    const s = newGame('cp-broke');
    buyProvisions(s, 300);
    setSail(s);
    processSeason(s);
    s.cash = 0;
    arrive(s, 0);
    settle(s);
    expect(s.mode).toBe('over');
    expect(s.pending[0].choices.map((c) => c.id)).toContain('retry');
    const r = restoreCheckpoint(s)!;
    expect(r.mode).toBe('port');
    expect(r.paymentsDue).toBe(0);
  });

  it('survives a save and reload', () => {
    const { s } = sailAndChart('cp-save');
    const t = deserialize(serialize(s))!;
    expect(t.checkpoint).toBe(s.checkpoint);
    expect(restoreCheckpoint(t)?.mode).toBe('port');
  });
});
