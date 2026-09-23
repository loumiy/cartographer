import { landmassLabel, money } from '../game/core';
import { settle } from '../game/economy';
import { nameLandmass, resolve } from '../game/sea';
import type { Choice, GameState, Interrupt } from '../game/types';
import { button, h } from './dom';
import { cargoBlock, chartCaseList, type UiContext } from './ledger';

/** The event card: the one sheet laid on the chart while the voyage waits for a decision. */
export function renderCard(ctx: UiContext, onNewGame: () => void): HTMLElement | null {
  const it = ctx.state.pending[0];
  if (!it) return null;
  if (it.kind === 'arrival') return arrivalCard(ctx);
  if (it.kind === 'gameover') return gameOverCard(ctx, it, onNewGame);
  return eventCard(ctx, it);
}

function dayStamp(state: GameState) {
  return h('span', { class: 'log-day' }, `Day ${state.day + 1}. `);
}

function choiceKind(c: Choice, primary: boolean): 'primary' | 'secondary' | 'risk' {
  if (c.tone === 'risk') return 'risk';
  return primary ? 'primary' : 'secondary';
}

function eventCard(ctx: UiContext, it: Interrupt): HTMLElement {
  const { state, act } = ctx;
  const enabled = it.choices.filter((c) => !c.disabled);
  const primaryId = (enabled.find((c) => c.tone !== 'risk') ?? enabled[0])?.id;
  const naming = it.kind === 'landfall' ? namingForm(ctx, it.data!.landmass) : null;
  return h(
    'div',
    { class: 'card', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'card-title' },
    h('h2', { class: 'heading', id: 'card-title' }, it.title),
    h('p', { class: 'log' }, dayStamp(state), it.body),
    naming,
    h(
      'ol',
      { class: 'choices' },
      ...it.choices.map((c, i) =>
        h(
          'li',
          { class: 'choice' },
          button([h('span', { class: 'key', 'aria-hidden': 'true' }, `${i + 1}`), c.label], () => act((s) => resolve(s, c.id)), {
            kind: choiceKind(c, c.id === primaryId),
            disabled: c.disabled ? c.hint ?? true : false,
          }),
          c.hint ? h('span', { class: `caption ${c.disabled ? 'muted' : c.tone ?? 'muted'}` }, c.hint) : null,
        ),
      ),
    ),
  );
}

function namingForm(ctx: UiContext, lmId: number): HTMLElement | null {
  const lm = ctx.state.world.landmasses[lmId];
  if (lm.home) return null;
  const input = h('input', {
    class: 'name-input',
    type: 'text',
    maxlength: 40,
    value: lm.name || lm.suggestedName,
    'aria-label': `Name this ${lm.kind}`,
  });
  const submit = () => ctx.act((s) => nameLandmass(s, lmId, input.value));
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') submit();
  });
  return h(
    'div',
    { class: 'naming' },
    h('label', { class: 'label' }, lm.name ? `Rename ${lm.name}` : `Name this ${lm.kind}`),
    h('div', { class: 'row' }, input, button(lm.name ? 'Rename it' : 'Name it', submit, { kind: lm.name ? 'secondary' : 'primary' })),
    lm.name ? null : h('p', { class: 'caption muted' }, 'The name goes on the chart and on anything you sell from here.'),
  );
}

function arrivalCard(ctx: UiContext): HTMLElement {
  const { state, act } = ctx;
  const r = state.report;
  const parts: string[] = [];
  if (r) {
    parts.push(`${r.port ? `In port at ${state.world.ports[r.port].name}` : 'Home'} after ${r.days} days at sea. We charted ${r.newCells} square leagues of new water and coast.`);
    if (r.landmasses.length) parts.push(`New land: ${r.landmasses.map((id) => landmassLabel(state, id)).join(', ')}.`);
    if (r.sites.length) parts.push(`Surveyed ${r.sites.length} site${r.sites.length > 1 ? 's' : ''} worth hauling from.`);
  }
  const voyageItems = r?.items ?? [];
  const due = state.paymentsDue;
  return h(
    'div',
    { class: 'card card-wide', role: 'dialog', 'aria-labelledby': 'card-title' },
    h('h2', { class: 'heading', id: 'card-title' }, `${r?.port ? 'Arrived at' : 'Home to'} ${state.world.ports[r?.port ?? state.portId].name}`),
    h('p', { class: 'log' }, dayStamp(state), parts.join(' ') || 'We are home.'),
    r?.contract
      ? h(
          'p',
          { class: `label ${r.contractResult === 'done' ? 'safe' : 'risk'}` },
          r.contractResult === 'done'
            ? `Contract fulfilled: the ${r.contract.patron} pays a bonus of ${money(r.bonus)}. The charts are theirs.`
            : r.contractResult === 'late'
              ? `Contract completed too late: no bonus, and our name suffers. The charts are the ${r.contract.patron}’s.`
              : `Contract failed: no bonus, and our name suffers. The charts are the ${r.contract.patron}’s.`,
        )
      : null,
    r?.delivered ? h('p', { class: 'caption' }, `${r.delivered} units of cargo delivered to the patron.`) : null,
    r ? h('p', { class: 'caption muted' }, `Wages paid to the crew: ${money(r.wages)}.`) : null,
    ...state.news.map((n) => h('p', { class: 'caption risk' }, n)),
    r?.contract ? null : h('h3', { class: 'label section' }, 'Sell or keep'),
    r?.contract ? null : chartCaseList(ctx, voyageItems),
    h('div', { class: 'section' }, cargoBlock(ctx)),
    h(
      'p',
      { class: `caption ${due ? 'risk' : 'muted'}` },
      due
        ? `The financier’s agent is waiting on the quay: ${money(due)} is due. You hold ${money(state.cash)}. If that falls short, cargo and charts are sold to cover it; if even that fails, the ship is taken.`
        : `Nothing is owed yet. Purse: ${money(state.cash)}.`,
    ),
    h('div', { class: 'row' }, button('Go ashore', () => act(settle), { kind: 'primary' })),
  );
}

function gameOverCard(ctx: UiContext, it: Interrupt, onNewGame: () => void): HTMLElement {
  const { state } = ctx;
  const s = state.stats;
  return h(
    'div',
    { class: 'card', role: 'dialog', 'aria-labelledby': 'card-title' },
    h('h2', { class: 'heading', id: 'card-title' }, it.title),
    h('p', { class: 'log' }, dayStamp(state), it.body),
    h(
      'dl',
      { class: 'stats' },
      h('dt', { class: 'caption muted' }, 'Voyages'),
      h('dd', { class: 'label' }, String(state.voyagesSailed)),
      h('dt', { class: 'caption muted' }, 'Charted'),
      h('dd', { class: 'label' }, `${s.cellsCharted} sq. leagues`),
      h('dt', { class: 'caption muted' }, 'Places named'),
      h('dd', { class: 'label' }, String(s.landmassesNamed)),
      h('dt', { class: 'caption muted' }, 'Earned'),
      h('dd', { class: 'label money' }, money(s.earned)),
      h('dt', { class: 'caption muted' }, 'Debt repaid'),
      h('dd', { class: 'label money' }, `${money(state.debtStart - state.debt)} of ${money(state.debtStart)}`),
      h('dt', { class: 'caption muted' }, 'Days'),
      h('dd', { class: 'label' }, String(state.day)),
    ),
    h('div', { class: 'row' }, button('Begin a new game', onNewGame, { kind: 'primary' })),
    h('p', { class: 'caption muted' }, `Chart seed: ${state.world.seed}. Replay it to sail the same sea.`),
  );
}
