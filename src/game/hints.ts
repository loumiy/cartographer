import { CONFIG } from './config';
import { daysOfStores, money } from './core';
import { canGoAshore } from './sea';
import type { GameState } from './types';

/**
 * One-time hints for a new captain. Each shows once, the first time its moment comes, and stays
 * until dismissed. None of them stop the clock: the voyage already stops for every decision.
 */
export interface Hint {
  id: string;
  title: string;
  body: string;
}

const HINTS: { id: string; when: (s: GameState) => boolean; title: string; body: (s: GameState) => string }[] = [
  {
    id: 'port',
    when: (s) => s.mode === 'port' && s.voyagesSailed === 0,
    title: 'Before the first voyage',
    body: (s) =>
      `Sign a contract in the Contracts tab for safe money, or sail freelance and keep every chart. Then outfit in the Outfit tab: the hold has ${Math.floor(daysOfStores(s))} days of stores, so buy provisions before you set sail.`,
  },
  {
    id: 'course',
    when: (s) => s.mode === 'sea' && !!s.voyage && !s.voyage.waypoints.length && !s.pending.length,
    title: 'Plot a course',
    body: () => 'Click the chart to drop waypoints; right-click removes the last. Drag to move the chart and scroll to zoom. The ship sails as soon as there is a course.',
  },
  {
    id: 'clock',
    when: (s) => s.mode === 'sea' && !!s.voyage && s.voyage.waypoints.length > 0 && s.voyage.days >= 2,
    title: 'Provisions are the clock',
    body: () =>
      'Every day out is a day of stores. The red tick on the Provisions gauge is the point of no return: past it, the stores left won’t see you home. Space heaves to; keys 1 to 3 set the speed.',
  },
  {
    id: 'ashore',
    when: (s) => canGoAshore(s),
    title: 'Off a coast',
    body: () =>
      'Choose Go ashore to make landfall. A shore party brings back stores, a survey finds timber, furs, spice or pearls to load, and you can name what you found. Land takes a season to recover after foraging.',
  },
  {
    id: 'sell',
    when: (s) => s.mode === 'port' && !s.pending.length && s.chartCase.length > 0,
    title: 'Selling charts',
    body: () =>
      'The Admiralty tab buys what you charted. A resource site can be kept secret instead: its cargo then sells at full price until another ship finds it. Cargo sells there too.',
  },
  {
    id: 'debt',
    when: (s) => s.debt > 0 && s.day >= CONFIG.season && !s.pending.length,
    title: 'The financier',
    body: () =>
      `A season has passed, and ${money(CONFIG.paymentPerSeason)} falls due each season. It is collected when you next reach port; if the purse can’t cover it, the ship is forfeit. The Financier tab takes early payments.`,
  },
];

export function currentHint(state: GameState): Hint | null {
  if (state.hintsOff) return null;
  const seen = state.hintsSeen ?? [];
  for (const h of HINTS) {
    if (!seen.includes(h.id) && h.when(state)) return { id: h.id, title: h.title, body: h.body(state) };
  }
  return null;
}

export function dismissHint(state: GameState, id: string) {
  state.hintsSeen = [...(state.hintsSeen ?? []), id];
}

export function stopHints(state: GameState) {
  state.hintsOff = true;
}
