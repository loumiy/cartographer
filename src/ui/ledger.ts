import { CONFIG } from '../game/config';
import {
  cargoCap,
  cargoUsed,
  chartPrice,
  currentPort,
  daysOfStores,
  knownPorts,
  formatDate,
  isSecret,
  money,
  provisionCap,
  secretRisk,
  seasonOf,
  unitPrice,
} from '../game/core';
import {
  acceptContract,
  buyProvisions,
  buySupplies,
  buyUpgrade,
  canSail,
  cancelContract,
  cannotSign,
  cargoValue,
  hireCrew,
  maxTier,
  payDebt,
  repairCost,
  repairHull,
  sellCargo,
  sellChartItem,
  sellProvisions,
  setSail,
  upgradeList,
  voyageCost,
} from '../game/economy';
import {
  canGoAshore,
  canPatch,
  clearCourse,
  contractElapsed,
  courseHome,
  deliverableQty,
  goAshore,
  patchHull,
  regionShare,
  setRations,
  togglePause,
} from '../game/sea';
import type { Contract, GameState } from '../game/types';
import { button, h } from './dom';

export type PortTab = 'contracts' | 'outfit' | 'shipwright' | 'admiralty' | 'financier';

export interface UiContext {
  state: GameState;
  /** Run a game action, then redraw and save. */
  act: (fn: (s: GameState) => void) => void;
  speed: number;
  setSpeed: (i: number) => void;
  tab: PortTab;
  setTab: (t: PortTab) => void;
  preview: (c: Contract | null) => void;
  /** Items the player chose to keep this visit, for the "Kept secret" note. */
  kept: Set<number>;
}

export const SPEEDS = [
  { label: '1×', secondsPerDay: 1.2 },
  { label: '2×', secondsPerDay: 0.6 },
  { label: '4×', secondsPerDay: 0.3 },
];

export function renderLedger(ctx: UiContext): HTMLElement {
  if (ctx.state.mode === 'over') return overLedger(ctx);
  return ctx.state.mode === 'sea' ? seaLedger(ctx) : portLedger(ctx);
}

function overLedger(ctx: UiContext): HTMLElement {
  const { state } = ctx;
  return h(
    'div',
    { class: 'ledger-inner' },
    h(
      'div',
      { class: 'ledger-head' },
      h('h2', { class: 'heading' }, 'The voyage is over'),
      h('p', { class: 'caption muted' }, formatDate(state.day)),
    ),
    stats(state),
    captainsLog(state),
  );
}

// ---------------------------------------------------------------------------
// At sea
// ---------------------------------------------------------------------------

function seaLedger(ctx: UiContext): HTMLElement {
  const { state, act } = ctx;
  const v = state.voyage!;
  const ship = state.ship;
  const left = daysOfStores(state);
  const running = !state.paused && !state.pending.length;

  const controls = h(
    'div',
    { class: 'controls' },
    h(
      'div',
      { class: 'row' },
      button(running ? [pauseIcon(), ' Heave to'] : [playIcon(), ' Sail'], () => act(togglePause), {
        kind: 'primary',
        disabled: state.pending.length
          ? 'Answer the decision first'
          : !running && !v.waypoints.length && v.restDays <= 0 && v.becalmedDays <= 0
            ? 'Plot a course first: click the chart'
            : false,
        title: 'Space',
      }),
      h(
        'div',
        { class: 'speed', role: 'group', 'aria-label': 'Time speed' },
        ...SPEEDS.map((s, i) =>
          h('button', { type: 'button', class: `speed-btn${ctx.speed === i ? ' on' : ''}`, 'aria-pressed': ctx.speed === i ? 'true' : 'false', onclick: () => ctx.setSpeed(i), title: `Key ${i + 1}` }, s.label),
        ),
      ),
    ),
    h(
      'div',
      { class: 'row wrap' },
      ...knownPorts(state).map((port) => {
        const d = v.portDays[port.id];
        const label = port.id === 0 ? 'Turn for home' : `Make for ${port.name}`;
        return button(`${label} · ${Number.isFinite(d) ? `${d} ${d === 1 ? 'day' : 'days'}` : 'no charted route'}`, () => act((s) => courseHome(s, port.id)), {
          disabled: !Number.isFinite(d) ? `No charted route to ${port.name}` : false,
          title: port.id === v.homePort ? 'H' : undefined,
        });
      }),
      button('Clear course', () => act(clearCourse), { kind: 'quiet', disabled: !v.waypoints.length ? 'No course plotted' : false }),
    ),
    h(
      'div',
      { class: 'row wrap' },
      button('Go ashore', () => act(goAshore), { disabled: !canGoAshore(state) ? 'Sail next to land first' : false }),
      button(`Patch hull · ${ship.supplies} supplies`, () => act(patchHull), {
        disabled: !canPatch(state) ? (ship.supplies ? 'Hull is sound' : 'No repair supplies') : false,
      }),
    ),
    ship.rations === 'full'
      ? h(
          'div',
          { class: 'choice-line' },
          button('Cut rations', () => act((s) => setRations(s, 'short')), { kind: 'risk' }),
          h('span', { class: 'caption risk' }, `+${Math.floor(ship.provisions / (ship.crew * CONFIG.shortRations) - left)} days range, sickness more likely`),
        )
      : h(
          'div',
          { class: 'choice-line' },
          button('Restore full rations', () => act((s) => setRations(s, 'full')), { kind: 'secondary' }),
          h('span', { class: 'caption risk' }, 'On short rations: sickness more likely'),
        ),
    h('p', { class: 'caption muted' }, 'Click the chart to add a waypoint. Right-click removes the last one.'),
  );

  return h(
    'div',
    { class: 'ledger-inner' },
    h(
      'div',
      { class: 'ledger-head' },
      h('h2', { class: 'heading' }, `Voyage ${state.voyagesSailed}`),
      h('p', { class: 'caption muted' }, `${formatDate(state.day)} · day ${v.days} at sea`),
    ),
    v.contract ? contractStatus(state, v.contract) : h('p', { class: 'caption muted section' }, 'Sailing on our own account: every chart is ours to sell or keep.'),
    state.alert ? h('div', { class: 'alert', role: 'status' }, state.alert) : null,
    controls,
    h(
      'section',
      { class: 'section' },
      gauge({
        label: 'Provisions',
        value: `${Math.floor(left)} days`,
        share: left / Math.max(1, provisionCap(state) / Math.max(1, ship.crew)),
        marks: [
          { at: v.homeDays / Math.max(1, provisionCap(state) / Math.max(1, ship.crew)), kind: 'risk' },
          { at: v.startProvisions / 2 / ship.crew / Math.max(1, provisionCap(state) / Math.max(1, ship.crew)), kind: 'muted' },
        ],
        caption:
          left <= v.homeDays
            ? 'Past the point of no return: stores run out before home. Find land and forage.'
            : left <= v.homeDays + 3
              ? `Provisions reach the point of no return in ${Math.max(0, Math.floor(left - v.homeDays))} days.`
              : `${state.world.ports[v.homePort].name} is ${Number.isFinite(v.homeDays) ? v.homeDays : '?'} days away. ${ship.rations === 'short' ? 'Short rations.' : ''}`,
        warn: left <= v.homeDays + 3,
      }),
      gauge({
        label: 'Hull',
        value: `${Math.round(ship.hull)}%`,
        share: ship.hull / 100,
        marks: [],
        caption: ship.hull < 35 ? 'The hull is badly strained. Another storm could sink her.' : '',
        warn: ship.hull < 35,
      }),
    ),
    stats(state),
    captainsLog(state),
  );
}

function contractStatus(state: GameState, c: Contract) {
  const elapsed = contractElapsed(state, c);
  const late = elapsed > c.deadline;
  const to = state.world.ports[c.to];
  let progress = '';
  if (c.kind === 'chart_region' && c.target) progress = `${Math.round(regionShare(state, c.target) * 100)}% of 60% charted`;
  if (c.kind === 'find_land') progress = elapsed <= (c.withinDays ?? 0) ? `${(c.withinDays ?? 0) - elapsed} days left to sight new land` : 'Too late to find land for this contract';
  if (c.kind === 'find_resource' && c.resource) progress = `${deliverableQty(state, c)} of ${c.resource.qty} units aboard`;
  return h(
    'section',
    { class: `contract-status section${c.done ? ' done' : ''}` },
    h('p', { class: 'label' }, `Contract: ${c.title}`),
    h(
      'p',
      { class: `caption${c.done ? ' safe' : ''}` },
      c.done ? `Objective reached. Make for ${state.world.ports[c.to].name} to claim the bonus.` : progress,
    ),
    h('p', { class: `caption${late ? ' risk' : ' muted'}` }, late
        ? `Overdue: it was due at ${to.name} ${elapsed - c.deadline} days ago.`
        : `Due at ${to.name} in ${c.deadline - elapsed} days · bonus ${money(c.bonus)}`),
  );
}

function gauge(g: { label: string; value: string; share: number; marks: { at: number; kind: 'risk' | 'muted' }[]; caption: string; warn: boolean }) {
  const pct = (n: number) => `${Math.max(0, Math.min(1, n)) * 100}%`;
  return h(
    'div',
    { class: 'gauge' },
    h('div', { class: 'gauge-top' }, h('span', { class: 'label' }, g.label), h('span', { class: 'figure' }, g.value)),
    h(
      'div',
      { class: 'gauge-track', role: 'meter', 'aria-label': g.label, 'aria-valuenow': Math.round(g.share * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 },
      h('div', { class: 'gauge-fill', style: { width: pct(g.share) } }),
      ...g.marks.filter((m) => Number.isFinite(m.at) && m.at > 0 && m.at < 1).map((m) => h('div', { class: `gauge-mark ${m.kind}`, style: { left: pct(m.at) } })),
    ),
    g.caption ? h('p', { class: `caption${g.warn ? ' risk' : ' muted'}` }, g.caption) : null,
  );
}

function stats(state: GameState) {
  const ship = state.ship;
  const v = state.voyage;
  const rows: [string, string][] = [
    ['Crew', `${ship.crew} hands`],
    ['Cargo', `${cargoUsed(state)} of ${cargoCap(state)} units`],
  ];
  if (v) rows.push(['Charted this voyage', `${v.newCells} sq. leagues`]);
  rows.push(['Purse', money(state.cash)]);
  if (state.debt > 0) {
    rows.push(['Debt', `${money(state.debt)}${state.paymentsDue ? ` · ${money(state.paymentsDue)} due` : ''}`]);
    const next = seasonOf(state.day).nextSeasonDay;
    rows.push(['Next payment', `${money(Math.min(state.paymentPerSeason, state.debt))} in ${next - state.day} days`]);
  } else {
    rows.push(['Ship', 'Owned outright']);
  }
  return h(
    'dl',
    { class: 'stats section' },
    ...rows.flatMap(([k, val]) => [h('dt', { class: 'caption muted' }, k), h('dd', { class: `label${k === 'Purse' ? ' money' : ''}` }, val)]),
  );
}

function captainsLog(state: GameState) {
  const entries = state.log.slice(-14).reverse();
  return h(
    'section',
    { class: 'section log-section' },
    h('h3', { class: 'label' }, 'Captain’s log'),
    h(
      'ol',
      { class: 'log-list' },
      ...entries.map((e) => h('li', { class: `log-entry ${e.tone ?? ''}` }, h('span', { class: 'log-day' }, `Day ${e.day + 1}. `), e.text)),
    ),
  );
}

function playIcon() {
  return h('span', { class: 'icon-play', 'aria-hidden': 'true' });
}

function pauseIcon() {
  return h('span', { class: 'icon-pause', 'aria-hidden': 'true' });
}

// ---------------------------------------------------------------------------
// In port
// ---------------------------------------------------------------------------

const TABS: [PortTab, string][] = [
  ['contracts', 'Contracts'],
  ['outfit', 'Outfit'],
  ['shipwright', 'Shipwright'],
  ['admiralty', 'Admiralty'],
  ['financier', 'Financier'],
];

function portLedger(ctx: UiContext): HTMLElement {
  const { state } = ctx;
  const body = {
    contracts: contractsTab,
    outfit: outfitTab,
    shipwright: shipwrightTab,
    admiralty: admiraltyTab,
    financier: financierTab,
  }[ctx.tab](ctx);
  const why = canSail(state);
  return h(
    'div',
    { class: 'ledger-inner' },
    h(
      'div',
      { class: 'ledger-head' },
      h('h2', { class: 'heading' }, currentPort(state).name),
      h('p', { class: 'caption muted' }, `${formatDate(state.day)} · in port`),
    ),
    h(
      'nav',
      { class: 'tabs', role: 'tablist' },
      ...TABS.map(([id, label]) =>
        h(
          'button',
          { type: 'button', role: 'tab', 'aria-selected': ctx.tab === id ? 'true' : 'false', class: `tab${ctx.tab === id ? ' on' : ''}`, onclick: () => ctx.setTab(id) },
          label,
          id === 'admiralty' && state.chartCase.length ? ` (${state.chartCase.length})` : '',
          id === 'financier' && state.paymentsDue ? ' (due)' : '',
        ),
      ),
    ),
    h('div', { class: 'tab-body' }, body),
    h(
      'div',
      { class: 'sail-bar' },
      h(
        'p',
        { class: 'caption muted' },
        state.accepted ? `Under contract: ${state.accepted.title}.` : 'No contract: a freelance voyage.',
        ` Port fee and wage advances: ${money(voyageCost(state))}.`,
      ),
      paymentWarning(state),
      button('Set sail', () => ctx.act(setSail), { kind: 'primary', disabled: why ?? false }),
      why ? h('p', { class: 'caption risk' }, why) : null,
    ),
  );
}

/** Warn before sailing when the stores outlast the next payment date: it will be collected on return. */
function paymentWarning(state: GameState) {
  const until = seasonOf(state.day).nextSeasonDay - state.day;
  const range = Math.floor(state.ship.provisions / Math.max(1, state.ship.crew));
  if (range < until || state.debt <= 0) return null;
  return h(
    'p',
    { class: 'caption risk' },
    `A payment of ${money(Math.min(state.paymentPerSeason, state.debt))} falls due in ${until} days. Be home with it after that, or the ship is taken.`,
  );
}

function row(label: string, value: string, ...actions: (HTMLElement | null)[]) {
  return h('div', { class: 'ledger-row' }, h('div', null, h('div', { class: 'label' }, label), h('div', { class: 'caption muted' }, value)), h('div', { class: 'row-actions' }, ...actions));
}

function contractsTab(ctx: UiContext) {
  const { state, act } = ctx;
  const tier = maxTier(state);
  const needed = (tier + 1) * 2;
  return h(
    'div',
    null,
    h(
      'p',
      { class: 'caption muted' },
      `Reputation ${state.reputation}. ${tier < 3 ? `Contracts farther out open at ${needed}.` : 'The best contracts are open to you.'} Contract charts belong to the patron and cannot be kept secret.`,
    ),
    state.accepted ? acceptedContract(ctx, state.accepted) : null,
    ...state.contracts.map((c) =>
      h(
        'div',
        { class: 'contract', onmouseenter: () => ctx.preview(c), onmouseleave: () => ctx.preview(null), onfocusin: () => ctx.preview(c) },
        h('p', { class: 'label' }, `${c.patron}: ${c.title}`),
        h('p', { class: 'caption' }, c.description),
        endsAt(state, c),
        h('p', { class: 'caption' }, h('span', { class: 'money' }, `Advance ${money(c.advance)} · bonus ${money(c.bonus)}`)),
        button('Sign contract', () => act((s) => acceptContract(s, c.id)), { disabled: cannotSign(state, c) ?? false }),
      ),
    ),
    state.contracts.length === 0 && !state.accepted ? h('p', { class: 'caption muted' }, 'No contracts on offer. New ones come in with each voyage.') : null,
  );
}

/** Where the contract ends: back here, or one way to the other port. */
function endsAt(state: GameState, c: Contract) {
  const to = state.world.ports[c.to];
  return h('p', { class: 'caption' }, h('span', { class: 'label' }, `Ends at: ${to.name}`), c.to === c.from ? ' (return)' : ' (one way)');
}

function acceptedContract(ctx: UiContext, c: Contract) {
  const { state, act } = ctx;
  const underway = c.startDay !== null;
  const left = c.deadline - contractElapsed(state, c);
  return h(
    'div',
    { class: 'contract accepted' },
    h('p', { class: 'label' }, `${underway ? 'Under way' : 'Signed'}: ${c.title}`),
    h('p', { class: 'caption' }, c.description),
    endsAt(state, c),
    underway
      ? h('p', { class: `caption ${left < 0 ? 'risk' : c.done ? 'safe' : 'muted'}` }, c.done ? `Objective reached. ${left} days left to reach ${state.world.ports[c.to].name}.` : `${left} days left.`)
      : null,
    underway
      ? h(
          'div',
          { class: 'choice-line' },
          button('Abandon contract', () => act(cancelContract), { kind: 'risk' }),
          h('span', { class: 'caption risk' }, 'No bonus, and our name suffers'),
        )
      : button('Return contract', () => act(cancelContract), {
          kind: 'quiet',
          disabled: state.cash < c.advance ? `Repaying the advance needs ${money(c.advance)}` : false,
        }),
  );
}

function outfitTab(ctx: UiContext) {
  const { state, act } = ctx;
  const ship = state.ship;
  const perDay = ship.crew;
  const days = Math.floor(ship.provisions / perDay);
  const capDays = Math.floor(provisionCap(state) / perDay);
  const cost10 = Math.round(perDay * 10 * CONFIG.provisionCost);
  return h(
    'div',
    null,
    row(
      `Crew: ${ship.crew} hands`,
      `${CONFIG.crewMin}–${CONFIG.crewMax}. Fewer than 10 sail slower. Each costs ${money(CONFIG.wageAdvance)} on signing, and wages of ${money(CONFIG.wagePerDay * 10)} per 10 days on return.`,
      button('−1', () => act((s) => hireCrew(s, -1)), { kind: 'quiet', disabled: ship.crew <= CONFIG.crewMin ? 'Minimum crew' : false }),
      button('+1', () => act((s) => hireCrew(s, 1)), { disabled: ship.crew >= CONFIG.crewMax ? 'The ship holds no more' : false }),
    ),
    row(
      `Provisions: ${days} days`,
      `Room for ${capDays} days at this crew. 10 days cost ${money(cost10)}.`,
      button('−10', () => act((s) => sellProvisions(s, perDay * 10)), { kind: 'quiet', disabled: days < 10 ? 'Nothing to sell' : false, title: 'Sell back at half price' }),
      button('+10', () => act((s) => buyProvisions(s, perDay * 10)), { disabled: days >= capDays ? 'Stores are full' : state.cash < cost10 ? 'Not enough money' : false }),
      button('Fill', () => act((s) => buyProvisions(s, provisionCap(s))), { disabled: days >= capDays ? 'Stores are full' : false }),
    ),
    row(
      `Repair supplies: ${ship.supplies} of ${CONFIG.suppliesMax}`,
      `Each patches ${CONFIG.patchAmount}% of hull at sea. ${money(CONFIG.supplyCost)} each.`,
      button('+1', () => act((s) => buySupplies(s, 1)), { disabled: ship.supplies >= CONFIG.suppliesMax ? 'Full' : state.cash < CONFIG.supplyCost ? 'Not enough money' : false }),
    ),
    row(
      `Hull: ${Math.round(ship.hull)}%`,
      ship.hull >= 100 ? 'Sound.' : `A full repair in the yard costs ${money(repairCost(state))}.`,
      button('Repair hull', () => act(repairHull), { disabled: ship.hull >= 100 ? 'Hull is sound' : state.cash < CONFIG.repairCostPerPoint ? 'Not enough money' : false }),
    ),
    stats(state),
  );
}

function shipwrightTab(ctx: UiContext) {
  const { state, act } = ctx;
  return h(
    'div',
    null,
    h('p', { class: 'caption muted' }, 'Instruments and refits stay with the ship for good.'),
    ...upgradeList(state).map((u) =>
      row(
        `${u.name}${u.maxLevel > 1 ? ` (${u.level} of ${u.maxLevel})` : u.level ? ' (fitted)' : ''}`,
        u.effect,
        u.cost === null
          ? h('span', { class: 'caption safe' }, 'Fitted')
          : button(`Buy · ${money(u.cost)}`, () => act((s) => buyUpgrade(s, u.key)), { disabled: state.cash < u.cost ? 'Not enough money' : false }),
      ),
    ),
    h('p', { class: 'caption muted' }, `Sight: ${CONFIG.baseSight + state.upgrades.spyglass} leagues · stores ${provisionCap(state)} crew-days · hold ${cargoCap(state)} units.`),
  );
}

function admiraltyTab(ctx: UiContext) {
  return h(
    'div',
    null,
    h(
      'p',
      { class: 'caption muted' },
      'The Admiralty buys charts at a fixed rate. Selling a resource site pays now and publishes it, so its cargo fetches less for every ship that knows the way. A kept secret pays full price until someone else finds it.',
    ),
    chartCaseList(ctx, null),
    cargoBlock(ctx),
  );
}

/** The chart case with sell/keep actions. `only` limits it to items from one voyage (arrival screen). */
export function chartCaseList(ctx: UiContext, only: number[] | null) {
  const { state, act } = ctx;
  const items = state.chartCase.filter((c) => !only || only.includes(c.id));
  if (!items.length) return h('p', { class: 'caption muted' }, only ? 'No charts to sell from this voyage.' : 'The chart case is empty.');
  return h(
    'div',
    { class: 'chart-case' },
    ...items.map((item) => {
      const site = item.kind === 'site' ? state.world.sites[item.ref] : null;
      const kept = ctx.kept.has(item.id);
      return h(
        'div',
        { class: 'ledger-row' },
        h(
          'div',
          null,
          h('div', { class: 'label' }, item.label, site && isSecret(site) ? h('span', { class: 'seal', title: 'Secret', 'aria-label': 'secret' }) : null),
          h(
            'div',
            { class: 'caption muted' },
            h('span', { class: 'money' }, money(chartPrice(state, item))),
            site
              ? ` · cargo ${money(unitPrice(site, currentPort(state)))} a unit here while secret, ${money(unitPrice({ ...site, knownBy: CONFIG.publicKnownBy }, currentPort(state)))} once sold · about ${Math.round(secretRisk(state, site) * 100)}% a season that others find it`
              : '',
          ),
          kept ? h('div', { class: 'caption safe' }, `Kept secret: ${item.label}`) : null,
        ),
        h(
          'div',
          { class: 'row-actions' },
          button('Sell chart', () => act((s) => sellChartItem(s, item.id)), { kind: 'primary' }),
          site && !kept
            ? button('Keep secret', () => {
                ctx.kept.add(item.id);
                act(() => {});
              })
            : null,
        ),
      );
    }),
  );
}

export function cargoBlock(ctx: UiContext) {
  const { state, act } = ctx;
  if (!state.ship.cargo.length) return h('p', { class: 'caption muted' }, 'The hold is empty.');
  return h(
    'div',
    { class: 'cargo' },
    h('h3', { class: 'label' }, 'Cargo'),
    ...state.ship.cargo.map((l) => {
      if (l.type === 'goods') return h('p', { class: 'caption' }, `${l.qty} units of the patron’s goods (not ours to sell)`);
      const site = state.world.sites[l.siteId];
      return h(
        'p',
        { class: 'caption' },
        `${l.qty} units of ${CONFIG.resources[l.type].label.toLowerCase()} at ${money(unitPrice(site, currentPort(state)))} here${isSecret(site) ? ' (secret route, full price)' : ` (known to ${site.knownBy} ships)`}`,
      );
    }),
    state.ship.cargo.some((l) => l.type !== 'goods')
      ? button(['Sell cargo · ', h('span', { class: 'money' }, money(cargoValue(state)))], () => act(sellCargo), { kind: 'primary' })
      : null,
    knownPorts(state).length > 1 ? marketNote(state) : null,
  );
}

/** Each market's appetite: what sells well here, compared with the other port. */
function marketNote(state: GameState) {
  const port = currentPort(state);
  const rows = (['timber', 'furs', 'spice', 'pearls'] as const).map((t) => `${CONFIG.resources[t].label} ×${port.prices[t].toFixed(1)}`);
  return h('p', { class: 'caption muted' }, `Market at ${port.name}: ${rows.join(', ')}.`);
}

function financierTab(ctx: UiContext) {
  const { state, act } = ctx;
  const next = seasonOf(state.day).nextSeasonDay;
  const paid = state.debtStart - state.debt;
  if (state.debt <= 0) {
    return h(
      'div',
      null,
      h('p', { class: 'caption muted' }, 'The bond is torn up. The ship is ours outright and no more payments fall due.'),
      gauge({ label: 'Debt repaid', value: money(state.debtStart), share: 1, marks: [], caption: '', warn: false }),
      state.stats.paidOffDay !== undefined ? row('Paid off', `${formatDate(state.stats.paidOffDay)}, after ${state.voyagesSailed} voyages.`) : null,
      stats(state),
    );
  }
  return h(
    'div',
    null,
    h('p', { class: 'caption muted' }, `The ship is bonded to the financier. ${money(state.paymentPerSeason)} falls due each season (every ${CONFIG.season} days at sea). A payment you cannot make on return loses you the ship. Pay off the whole debt to own her outright.`),
    gauge({ label: 'Debt repaid', value: `${money(paid)} of ${money(state.debtStart)}`, share: paid / state.debtStart, marks: [], caption: '', warn: false }),
    row('Owed', `${money(state.debt)} in all${state.paymentsDue ? `, of which ${money(state.paymentsDue)} is due now` : ''}. Next payment due in ${next - state.day} days at sea.`),
    h(
      'div',
      { class: 'row wrap' },
      state.paymentsDue ? button(`Pay what is due · ${money(state.paymentsDue)}`, () => act((s) => payDebt(s, s.paymentsDue)), { kind: 'primary', disabled: state.cash < state.paymentsDue ? 'Not enough money' : false }) : null,
      button(`Pay ${money(100)}`, () => act((s) => payDebt(s, 100)), { disabled: state.cash < 100 ? 'Not enough money' : false }),
      button(`Pay ${money(500)}`, () => act((s) => payDebt(s, 500)), { disabled: state.cash < 500 ? 'Not enough money' : false }),
      button('Pay all I can', () => act((s) => payDebt(s, s.cash)), { disabled: state.cash < 1 ? 'Not enough money' : false }),
    ),
    stats(state),
  );
}

