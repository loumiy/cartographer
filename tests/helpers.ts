import { resolve, stepSea } from '../src/game/sea';
import type { GameState } from '../src/game/types';

/** Run the voyage until it pauses or needs a decision, up to a step limit. */
export function runUntilStop(state: GameState, maxSteps = 5000): number {
  let n = 0;
  state.paused = false;
  state.alert = null;
  while (n < maxSteps && state.mode === 'sea' && !state.paused && !state.pending.length) {
    stepSea(state);
    n++;
  }
  return n;
}

/** Answer every pending decision with its first enabled choice (or `prefer` if offered). */
export function answerAll(state: GameState, prefer: string[] = []) {
  let guard = 0;
  while (state.pending.length && state.mode === 'sea' && guard++ < 50) {
    const p = state.pending[0];
    const ok = p.choices.filter((c) => !c.disabled);
    const pick = ok.find((c) => prefer.includes(c.id)) ?? ok[ok.length - 1];
    resolve(state, pick.id);
  }
}
