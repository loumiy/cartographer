import './styles/tokens.css';
import './styles/app.css';
import { CONFIG } from './game/config';
import { money } from './game/core';
import { addWaypoint, courseHome, removeLastWaypoint, resolve, stepSea, togglePause } from './game/sea';
import { deserialize, newGame, restoreCheckpoint, serialize } from './game/state';
import type { GameState } from './game/types';
import { renderCard } from './ui/card';
import { Chart } from './ui/chart';
import { button, h } from './ui/dom';
import { renderLedger, SPEEDS, type PortTab, type UiContext } from './ui/ledger';

const SAVE_KEY = 'cartographer.save.v1';
const THEME_KEY = 'cartographer.theme';

const root = document.getElementById('app')!;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function loadSave(): GameState | null {
  try {
    const text = storage()?.getItem(SAVE_KEY);
    return text ? deserialize(text) : null;
  } catch {
    return null;
  }
}

function writeSave(state: GameState) {
  try {
    // A lost game with no checkpoint is over for good; with one, it can still be taken back.
    if (state.mode === 'over' && !state.checkpoint) storage()?.removeItem(SAVE_KEY);
    else storage()?.setItem(SAVE_KEY, serialize(state));
  } catch {
    /* Private mode or full storage: the game still plays, it just won't resume. */
  }
}

function applyTheme(theme: string | null) {
  if (theme === 'day' || theme === 'lamp') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

applyTheme((() => {
  try {
    return storage()?.getItem(THEME_KEY) ?? null;
  } catch {
    return null;
  }
})());

// ---------------------------------------------------------------------------
// Title screen
// ---------------------------------------------------------------------------

function randomSeed(): string {
  const words = ['brine', 'cape', 'gale', 'shoal', 'tide', 'kelp', 'reef', 'spar', 'helm', 'wake', 'loom', 'mist'];
  const pick = () => words[Math.floor(Math.random() * words.length)];
  return `${pick()}-${pick()}-${Math.floor(Math.random() * 900 + 100)}`;
}

function showTitle() {
  const params = new URLSearchParams(location.search);
  const saved = loadSave();
  const seedInput = h('input', { class: 'name-input', type: 'text', value: params.get('seed') ?? randomSeed(), 'aria-label': 'Chart seed', maxlength: 40 });
  const start = () => startGame(newGame(seedInput.value.trim() || randomSeed()));
  seedInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') start();
  });
  root.replaceChildren(
    h(
      'main',
      { class: 'title-screen' },
      h(
        'div',
        { class: 'title-sheet' },
        h('h1', { class: 'title' }, 'Cartographer'),
        h('p', { class: 'log' }, 'One ship, a debt, and a sea nobody has charted. Sail east into the blank, chart what you find, and come home to sell your charts, or keep the best of them secret.'),
        h(
          'ul',
          { class: 'body rules' },
          h('li', null, 'Click the chart to plot a course. The voyage stops when something needs a decision.'),
          h('li', null, 'Provisions are the clock. Every day past halfway is a bet.'),
          h('li', null, `The financier wants ${money(CONFIG.paymentPerSeason)} a season from a debt of ${money(CONFIG.debt)}. Miss a payment and lose the ship; pay it all and she is yours, to sail on as long as you like.`),
          h('li', null, 'Contracts are safe money, but the patron owns the chart. Freelance voyages keep everything.'),
        ),
        saved
          ? h(
              'div',
              { class: 'row' },
              button('Continue voyage', () => startGame(saved), { kind: 'primary' }),
              h('span', { class: 'caption muted' }, `${saved.world.ports[saved.portId].name}, voyage ${saved.voyagesSailed}, ${saved.debt > 0 ? `debt ${money(saved.debt)}` : 'ship owned outright'}`),
            )
          : null,
        h(
          'div',
          { class: 'naming' },
          h('label', { class: 'label' }, 'Chart seed'),
          h('div', { class: 'row' }, seedInput, button('Begin a new game', start, { kind: saved ? 'secondary' : 'primary' })),
          h('p', { class: 'caption muted' }, 'The same seed always makes the same sea. Share it to sail the same waters.'),
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// The game screen
// ---------------------------------------------------------------------------

let stopLoop: (() => void) | null = null;
let current: GameState | null = null;
window.addEventListener('beforeunload', () => {
  if (current) writeSave(current);
});

function startGame(state: GameState) {
  stopLoop?.();
  const url = new URL(location.href);
  url.searchParams.set('seed', state.world.seed);
  history.replaceState(null, '', url);

  const chartHost = h('section', { class: 'chart-wrap', 'aria-label': 'Chart' });
  const cardHost = h('div', { class: 'card-host' });
  const ledger = h('aside', { class: 'ledger', 'aria-label': 'Ledger' });
  const topbar = h('header', { class: 'topbar' });
  chartHost.append(cardHost);
  root.replaceChildren(h('div', { class: 'game' }, topbar, h('div', { class: 'table' }, chartHost, ledger)));

  const chart = new Chart(chartHost);
  chartHost.insertBefore(chart.canvas, cardHost);
  chartHost.insertBefore(chart.controls, cardHost);

  let dirty = true;
  let lastCard: unknown = null;
  let lastCardBody = '';
  const ctx: UiContext = {
    state,
    act: (fn) => {
      fn(state);
      dirty = true;
      lastCard = null;
      writeSave(state);
    },
    speed: 0,
    setSpeed: (i) => {
      ctx.speed = i;
      dirty = true;
    },
    tab: state.accepted ? 'outfit' : 'contracts',
    setTab: (t: PortTab) => {
      ctx.tab = t;
      dirty = true;
    },
    preview: (c) => {
      chart.preview = c?.target ?? null;
    },
    kept: new Set(),
    routeDraft: null,
  };

  const renderTopbar = () => {
    const theme = document.documentElement.dataset.theme;
    const lamp = theme === 'lamp' || (!theme && matchMedia('(prefers-color-scheme: dark)').matches);
    topbar.replaceChildren(
      h('span', { class: 'brand' }, 'Cartographer'),
      h('span', { class: 'topbar-stat' }, h('span', { class: 'caption muted' }, 'Purse '), h('span', { class: 'label money' }, money(state.cash))),
      h('span', { class: 'topbar-stat' }, h('span', { class: 'caption muted' }, 'Debt '), h('span', { class: 'label' }, state.debt > 0 ? money(state.debt) : 'Paid off')),
      h('span', { class: 'topbar-stat' }, h('span', { class: 'caption muted' }, 'Reputation '), h('span', { class: 'label' }, String(state.reputation))),
      h('span', { class: 'spacer' }),
      button(lamp ? 'Daylight' : 'Lamplight', () => {
        const next = lamp ? 'day' : 'lamp';
        applyTheme(next);
        try {
          storage()?.setItem(THEME_KEY, next);
        } catch {
          /* ignore */
        }
        chart.refreshPalette();
        dirty = true;
      }, { kind: 'quiet' }),
      button('Main menu', () => {
        stopLoop?.();
        current = null;
        showTitle();
      }, { kind: 'quiet' }),
    );
  };

  const renderCardLayer = () => {
    const it = state.pending[0] ?? null;
    const key = it ? `${it.kind}|${it.title}|${it.body}|${it.choices.map((c) => `${c.id}${c.disabled ? '-' : ''}${c.hint}`).join(',')}` : '';
    if (it === lastCard && key === lastCardBody && it?.kind !== 'arrival') return;
    lastCard = it;
    lastCardBody = key;
    const card = renderCard(
      ctx,
      () => {
        stopLoop?.();
        startGame(newGame(randomSeed()));
      },
      () => {
        const restored = restoreCheckpoint(state);
        if (!restored) return;
        stopLoop?.();
        writeSave(restored);
        startGame(restored);
      },
    );
    cardHost.replaceChildren(...(card ? [card] : []));
    if (card) {
      // Lay the card on the side of the chart away from the ship.
      const ship = chart.shipScreen(state);
      const w = chartHost.clientWidth;
      cardHost.classList.toggle('right', ship.x < w / 2);
      cardHost.classList.toggle('left', ship.x >= w / 2);
      const focusable = card.querySelector<HTMLElement>('.btn-primary:not([disabled]), button:not([disabled])');
      focusable?.focus({ preventScroll: true });
    }
  };

  const renderAll = () => {
    renderTopbar();
    const scroll = ledger.scrollTop;
    ledger.replaceChildren(renderLedger(ctx));
    ledger.scrollTop = scroll;
    renderCardLayer();
  };

  // Chart input: a tap adds a waypoint, right-click removes the last one. Drag pans, wheel zooms.
  chart.onTap = (p) => {
    if (state.mode !== 'sea' || state.pending.length) return;
    const wasIdle = !state.voyage!.waypoints.length;
    ctx.act((s) => {
      addWaypoint(s, p.x, p.y);
      // A fresh course from a standstill gets under way at once.
      if (wasIdle && s.voyage!.waypoints.length && s.paused) {
        s.paused = false;
        s.alert = null;
      }
    });
  };
  chart.onRightTap = () => {
    if (state.mode === 'sea') ctx.act(removeLastWaypoint);
  };

  const onKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT') return;
    if (state.pending.length && /^[1-9]$/.test(e.key)) {
      const c = state.pending[0].choices[Number(e.key) - 1];
      if (c && !c.disabled && state.pending[0].kind !== 'arrival' && state.pending[0].kind !== 'gameover') {
        ctx.act((s) => resolve(s, c.id));
        e.preventDefault();
      }
      return;
    }
    if (state.mode !== 'sea') return;
    if (e.key === ' ' && target.tagName !== 'BUTTON') {
      e.preventDefault();
      ctx.act(togglePause);
    } else if (e.key === '1' || e.key === '2' || e.key === '3') {
      ctx.setSpeed(Number(e.key) - 1);
    } else if (e.key === 'h' || e.key === 'H') {
      ctx.act((s) => courseHome(s));
    } else if (e.key === 'Backspace') {
      ctx.act(removeLastWaypoint);
    }
  };
  window.addEventListener('keydown', onKey);

  const themeWatch = matchMedia('(prefers-color-scheme: dark)');
  const onThemeChange = () => {
    chart.refreshPalette();
    dirty = true;
  };
  themeWatch.addEventListener('change', onThemeChange);

  // Main loop: fixed sub-day steps at the chosen speed; the ship glides between steps.
  let acc = 0;
  let last = performance.now();
  let prev = { x: state.ship.x, y: state.ship.y };
  let lastDay = state.day;
  let running = true;
  let lastSave = 0;
  const frame = (now: number) => {
    if (!running) return;
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    const stepTime = SPEEDS[ctx.speed].secondsPerDay / CONFIG.stepsPerDay;
    const live = state.mode === 'sea' && !state.paused && !state.pending.length;
    if (live) {
      acc += dt;
      while (acc >= stepTime) {
        prev = { x: state.ship.x, y: state.ship.y };
        stepSea(state);
        acc -= stepTime;
        if (state.day !== lastDay) {
          lastDay = state.day;
          dirty = true;
        }
        if (state.paused || state.pending.length || state.mode !== 'sea') {
          acc = 0;
          dirty = true;
          prev = { x: state.ship.x, y: state.ship.y };
          break;
        }
      }
    } else {
      acc = 0;
      prev = { x: state.ship.x, y: state.ship.y };
    }
    const t = live ? Math.min(1, acc / stepTime) : 1;
    const shipPos = { x: prev.x + (state.ship.x - prev.x) * t, y: prev.y + (state.ship.y - prev.y) * t };
    chart.draw(state, shipPos, now);
    if (dirty) {
      dirty = false;
      renderAll();
      if (now - lastSave > 1000) {
        writeSave(state);
        lastSave = now;
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  stopLoop = () => {
    running = false;
    window.removeEventListener('keydown', onKey);
    themeWatch.removeEventListener('change', onThemeChange);
    writeSave(state);
  };
  current = state;
  if (import.meta.env.DEV) Object.assign(window, { cartographer: { state, act: ctx.act } });
  renderAll();
}

showTitle();
