import { CONFIG } from '../game/config';
import {
  cargoCap,
  cargoUsed,
  chartPrice,
  crewMax,
  currentPort,
  openSpeed,
  sightRadius,
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
import {
  MILESTONES,
  buyShip,
  cannotCommand,
  createRoute,
  endRoute,
  planRoute,
  postLabel,
  routeStormChance,
  seasonsSinceSupplied,
  stopName,
  takeCommand,
  warehouseCap,
} from '../game/holdings';
import { currentHint, dismissHint, stopHints } from '../game/hints';
import type { Contract, GameState, RouteStop } from '../game/types';

import { button, h } from './dom';

export type PortTab = 'contracts' | 'outfit' | 'shipwright' | 'admiralty' | 'holdings' | 'financier';

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
  /** A route being drawn up in the Holdings tab. */
  routeDraft: { vesselId: number; stops: RouteStop[] } | null;
}

export const SPEEDS = [
  { label: '1×', secondsPerDay: 1.2 },
  { label: '2×', secondsPerDay: 0.6 },
  { label: '4×', secondsPerDay: 0.3 },
];

export function renderLedger(ctx: UiContext): HTMLElement {
  if (ctx.state.mode === 'over') return overLedger(ctx);
  const el = ctx.state.mode === 'sea' ? seaLedger(ctx) : portLedger(ctx);
  const note = hintNote(ctx);
  // In port the hint scrolls with the tab, so it never crowds out the contracts.
  if (note) (el.querySelector('.tab-body') ?? el).prepend(note);
  return el;
}

/** A one-time hint for a new captain, at the head of the ledger until dismissed. */
function hintNote(ctx: UiContext): HTMLElement | null {
  const hint = currentHint(ctx.state);
  if (!hint) return null;
  return h(
    'section',
    { class: 'hint', role: 'note', 'aria-label': 'Hint' },
    h('h3', { class: 'label' }, hint.title),
    h('p', { class: 'body' }, hint.body),
    h(
      'div',
      { class: 'row' },
      button('Got it', () => ctx.act((s) => dismissHint(s, hint.id)), { kind: 'secondary' }),
      button('No more hints', () => ctx.act(stopHints), { kind: 'quiet' }),
    ),
  );
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
          { at: v.havenDays / Math.max(1, provisionCap(state) / Math.max(1, ship.crew)), kind: 'risk' },
          { at: v.startProvisions / 2 / ship.crew / Math.max(1, provisionCap(state) / Math.max(1, ship.crew)), kind: 'muted' },
        ],
        caption:
          left <= v.havenDays
            ? 'Past the point of no return: stores run out before any port or post. Find land and forage.'
            : left <= v.havenDays + 3
              ? `Provisions reach the point of no return in ${Math.max(0, Math.floor(left - v.havenDays))} days.`
              : `${state.world.ports[v.homePort].name} is ${Number.isFinite(v.homeDays) ? v.homeDays : '?'} days away. ${ship.rations === 'short' ? 'Short rations.' : ''}`,
        warn: left <= v.havenDays + 3,
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
    ['Ship', `${ship.name}, ${CONFIG.ships[ship.kind].label.toLowerCase()}`],
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
    rows.push(['Bond', 'Paid off']);
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
  ['holdings', 'Holdings'],
  ['financier', 'Financier'],
];

function portLedger(ctx: UiContext): HTMLElement {
  const { state } = ctx;
  const body = {
    contracts: contractsTab,
    outfit: outfitTab,
    shipwright: shipwrightTab,
    admiralty: admiraltyTab,
    holdings: holdingsTab,
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
      `${CONFIG.crewMin}–${crewMax(state)}. Fewer than 10 sail slower. Each costs ${money(CONFIG.wageAdvance)} on signing, and wages of ${money(CONFIG.wagePerDay * 10)} per 10 days on return.`,
      button('−1', () => act((s) => hireCrew(s, -1)), { kind: 'quiet', disabled: ship.crew <= CONFIG.crewMin ? 'Minimum crew' : false }),
      button('+1', () => act((s) => hireCrew(s, 1)), { disabled: ship.crew >= crewMax(state) ? 'The ship holds no more' : false }),
    ),
    row(
      `Provisions: ${days} days`,
      `Room for ${capDays} days at this crew. 10 days cost ${money(cost10)}. Loaded, the stores reach about ${Math.round((days * openSpeed(state)) / 2)} leagues out and back in open water; forage on the way to go farther.`,
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
    h('p', { class: 'caption muted' }, `Fitting out the ${state.ship.name}, a ${CONFIG.ships[state.ship.kind].label.toLowerCase()}. Instruments go with the captain from ship to ship; refits stay with the hull.`),
    ...upgradeList(state).map((u) =>
      row(
        `${u.name}${u.maxLevel > 1 ? ` (${u.level} of ${u.maxLevel})` : u.level ? ' (fitted)' : ''}`,
        u.effect,
        u.cost === null
          ? h('span', { class: 'caption safe' }, 'Fitted')
          : button(`Buy · ${money(u.cost)}`, () => act((s) => buyUpgrade(s, u.key)), { disabled: state.cash < u.cost ? 'Not enough money' : false }),
      ),
    ),
    h('p', { class: 'caption muted' }, `Sight: ${sightRadius(state)} leagues · stores ${provisionCap(state)} crew-days · hold ${cargoCap(state)} units.`),
    h('h3', { class: 'label section' }, 'Ships for sale'),
    row(
      'A brig',
      `The explorer’s ship: ${CONFIG.ships.brig.stores} crew-days of stores (${Math.round(CONFIG.ships.brig.stores / CONFIG.crewStart)} days for ${CONFIG.crewStart} crew, and refits add half again), ${Math.round((CONFIG.ships.brig.openSpeed - 1) * 100)}% faster in open water, a league more sight from her taller masts, ${CONFIG.ships.brig.hold} units of hold, up to ${CONFIG.ships.brig.crewMax} crew, and storms and reefs hurt her less. Lies here until you take command or put her on a route.`,
      button(`Buy · ${money(CONFIG.ships.brig.cost)}`, () => act((s) => buyShip(s, 'brig')), { disabled: state.cash < CONFIG.ships.brig.cost ? 'Not enough money' : false }),
    ),
    row(
      'A pinnace',
      `A small, cheap hull like our first: ${CONFIG.ships.pinnace.hold} units of hold. Enough to work a short route.`,
      button(`Buy · ${money(CONFIG.ships.pinnace.cost)}`, () => act((s) => buyShip(s, 'pinnace')), { disabled: state.cash < CONFIG.ships.pinnace.cost ? 'Not enough money' : false }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Holdings: posts, ships, routes, milestones
// ---------------------------------------------------------------------------

function holdingsTab(ctx: UiContext) {
  const { state, act } = ctx;
  const draft = ctx.routeDraft;
  const posts = state.posts;
  const here = state.portId;
  return h(
    'div',
    null,
    h('p', { class: 'caption muted' }, 'Trading posts gather cargo each season; ships on routes earn without us. Each season’s results are told when we reach port.'),
    howHoldingsWork(posts.length === 0),

    h('h3', { class: 'label' }, 'Trading posts'),
    posts.length
      ? h(
          'div',
          { class: 'chart-case' },
          ...posts.map((p) => {
            const since = seasonsSinceSupplied(state, p);
            const onRoute = state.routes.some((r) => r.stops.some((st) => st.kind === 'post' && st.id === p.id));
            const status = p.abandoned
              ? 'Abandoned'
              : onRoute
                ? 'Supplied by its route ship'
                : since < CONFIG.post.fullFor
                  ? `Supplied ${since ? `${since} season${since > 1 ? 's' : ''} ago` : 'this season'}: full output`
                  : since < CONFIG.post.halfFor
                    ? 'Short of supplies: half output'
                    : 'About to be abandoned';
            return h(
              'div',
              { class: 'ledger-row' },
              h(
                'div',
                null,
                h('div', { class: 'label' }, postLabel(state, p)),
                h('div', { class: `caption ${p.abandoned || (!onRoute && since >= CONFIG.post.fullFor) ? 'risk' : 'muted'}` }, status),
              ),
              h('div', { class: 'caption money' }, p.abandoned ? '' : `${p.warehouse} / ${warehouseCap(state, p)} units`),
            );
          }),
        )
      : h('p', { class: 'caption muted' }, `No posts yet. Found one during landfall at a surveyed site: ${money(CONFIG.post.cost)} and ${CONFIG.post.timber} timber.`),

    h('h3', { class: 'label section' }, 'Ships'),
    row(`${state.ship.name} (${CONFIG.ships[state.ship.kind].label})`, `Under our command · hull ${Math.round(state.ship.hull)}%`),
    ...state.fleet.map((v) => {
      const route = state.routes.find((r) => r.id === v.routeId);
      const where = route ? `On a route: ${route.stops.map((st) => stopName(state, st)).join(' → ')}` : `Lies at ${state.world.ports[v.portId].name}`;
      const why = cannotCommand(state, v);
      return row(
        `${v.name} (${CONFIG.ships[v.kind].label})`,
        `${where} · hull ${Math.round(v.hull)}%`,
        route ? null : button('Take command', () => act((s) => takeCommand(s, v.id)), { disabled: why ?? false }),
        route || v.portId !== here
          ? null
          : button('Put on a route', () => {
              ctx.routeDraft = { vesselId: v.id, stops: [{ kind: 'port', id: here }] };
              act(() => {});
            }),
      );
    }),
    state.fleet.length ? null : h('p', { class: 'caption muted' }, 'Buy a second ship at the shipwright to put her on a route.'),
    draft ? routeBuilder(ctx, draft) : null,

    h('h3', { class: 'label section' }, 'Routes'),
    state.routes.length
      ? h(
          'div',
          { class: 'chart-case' },
          ...state.routes.map((r) => {
            const v = state.fleet.find((f) => f.id === r.vesselId);
            return h(
              'div',
              { class: 'ledger-row' },
              h(
                'div',
                null,
                h('div', { class: 'label' }, r.stops.map((st) => stopName(state, st)).join(' → ')),
                h(
                  'div',
                  { class: 'caption muted' },
                  `${v?.name ?? 'No ship'} · ${r.length} leagues round · storms halve ${pct(routeStormChance(state, r))} of seasons · last season: `,
                  h('span', { class: r.lastIncome >= 0 ? 'money' : 'risk' }, r.lastNote === 'Not yet sailed' ? r.lastNote : money(r.lastIncome)),
                ),
              ),
              button('End route', () => act((s) => endRoute(s, r.id)), { kind: 'quiet' }),
            );
          }),
        )
      : h('p', { class: 'caption muted' }, 'No routes yet.'),

    h('h3', { class: 'label section' }, 'Milestones'),
    h(
      'ul',
      { class: 'milestones' },
      ...MILESTONES.map((m) =>
        h('li', { class: `caption ${state.milestones.includes(m.id) ? 'safe' : 'muted'}` }, `${state.milestones.includes(m.id) ? '✓ ' : '○ '}${m.title}`),
      ),
    ),
  );
}

/** The steps from a surveyed site to money arriving on its own, open until the first post is founded. */
function howHoldingsWork(open: boolean) {
  const P = CONFIG.post;
  return h(
    'details',
    { class: 'how', open },
    h('summary', { class: 'label' }, 'How posts and routes work'),
    h(
      'ol',
      { class: 'caption how-steps' },
      h('li', null, 'Survey a coast at landfall. A site it finds shows on the chart as a gilt disc.'),
      h('li', null, `Come back to that site with ${money(P.cost)} and ${P.timber} units of timber in the hold (load it at any timber site). Make landfall within 5 leagues of the site and choose “Found a trading post”. It takes a day.`),
      h('li', null, `The post gathers ${P.yield} times what a shore party would find there, every season (${CONFIG.season} days at sea), into its warehouse.`),
      h('li', null, 'Collect it yourself at landfall, or buy a second ship at the shipwright and put her on a route that calls at the post. The route ship sells the cargo at the best port on her route each season and keeps the post supplied.'),
      h('li', null, `A post on a route is always kept supplied. Any other post that nobody supplies for ${P.fullFor} seasons halves its output, and after ${P.abandonAt} it is abandoned; resupply it at landfall with ${P.supplyTimber} timber and ${P.supplyStores} crew-days of stores.`),
      h('li', null, 'Route ships are kept in repair out of their takings and are never lost. Storms sometimes halve a season’s takings.'),
    ),
  );
}

/** A small chance as a percentage a person can read: "under 1%" rather than "0%". */
function pct(p: number): string {
  if (p < 0.01) return 'under 1%';
  return `${Math.round(p * 100)}%`;
}

/** Pick stops in order; the route runs through them and back to the first. */
function routeBuilder(ctx: UiContext, draft: { vesselId: number; stops: RouteStop[] }) {
  const { state, act } = ctx;
  const v = state.fleet.find((f) => f.id === draft.vesselId);
  if (!v) return null;
  const candidates: RouteStop[] = [
    ...knownPorts(state).map((p) => ({ kind: 'port' as const, id: p.id })),
    ...state.posts.filter((p) => !p.abandoned).map((p) => ({ kind: 'post' as const, id: p.id })),
  ];
  const has = (st: RouteStop) => draft.stops.some((d) => d.kind === st.kind && d.id === st.id);
  const plan = planRoute(state, draft.stops);
  const refresh = () => act(() => {});
  return h(
    'div',
    { class: 'contract accepted' },
    h('p', { class: 'label' }, `A route for the ${v.name}`),
    h('p', { class: 'caption muted' }, 'Choose stops in the order she will call. She sails the round each season and back to the first stop. Every leg must run over charted water.'),
    h(
      'div',
      { class: 'row wrap' },
      ...candidates.map((st) =>
        button(stopName(state, st), () => {
          draft.stops = has(st) ? draft.stops.filter((d) => !(d.kind === st.kind && d.id === st.id)) : [...draft.stops, st];
          refresh();
        }, { kind: has(st) ? 'primary' : 'secondary' }),
      ),
    ),
    h('p', { class: 'caption' }, draft.stops.length ? draft.stops.map((st) => stopName(state, st)).join(' → ') + ' → back' : 'No stops chosen.'),
    typeof plan === 'string'
      ? h('p', { class: 'caption risk' }, plan)
      : h(
          'p',
          { class: 'caption' },
          `${plan.length} leagues round · `,
          `storms halve ${pct(routeStormChance(state, { risk: plan.risk, vesselId: draft.vesselId }))} of seasons`,
          ' · about ',
          h('span', { class: 'money' }, money(plan.estimate)),
          ' a season after costs',
        ),
    h(
      'div',
      { class: 'row' },
      button(
        'Start the route',
        () =>
          act((s) => {
            const r = createRoute(s, draft.vesselId, draft.stops);
            if (typeof r !== 'string') ctx.routeDraft = null;
          }),
        { kind: 'primary', disabled: typeof plan === 'string' ? plan : false },
      ),
      button('Cancel', () => {
        ctx.routeDraft = null;
        refresh();
      }, { kind: 'quiet' }),
    ),
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

