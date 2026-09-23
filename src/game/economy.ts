import { CONFIG } from './config';
import {
  bounds,
  chartPrice,
  compass,
  currentPort,
  isSecret,
  landmassLabel,
  log,
  money,
  provisionCap,
  secretRisk,
  siteSaleValue,
  unitPrice,
  updateHomeEstimate,
  withRng,
} from './core';
import { contractElapsed, deliverableQty, gameOver, regionShare, reveal } from './sea';
import type { ChartItem, Contract, GameState, ResourceType, Voyage, VoyageReport } from './types';
import { driftIce, inRect } from './world';

// ---------------------------------------------------------------------------
// Seasons
// ---------------------------------------------------------------------------

/** Every season: a debt payment falls due, secrets may leak, public routes crowd, sites regrow. */
export function processSeason(state: GameState) {
  const due = Math.min(state.paymentPerSeason, state.debt - state.paymentsDue);
  if (due > 0) {
    state.paymentsDue += due;
    const where = state.mode === 'sea' ? ' It will be collected when we reach port.' : '';
    log(state, `A new season: a debt payment of ${money(due)} falls due.${where}`, 'bad');
  }
  withRng(state, (rng) => driftIce(state.world, rng));
  for (const site of state.world.sites) {
    site.stock = site.maxStock;
    if (isSecret(site)) {
      if (withRng(state, (rng) => rng.chance(secretRisk(state, site)))) {
        site.knownBy = CONFIG.publicKnownBy;
        const i = state.chartCase.findIndex((c) => c.kind === 'site' && c.ref === site.id);
        if (i >= 0) state.chartCase.splice(i, 1);
        state.news.push(
          `Word on the quay: another captain has found your ${CONFIG.resources[site.type].label.toLowerCase()} on ${landmassLabel(
            state,
            site.landmass,
          )}. The secret is out, and the Admiralty will no longer pay for it.`,
        );
      }
    } else if (site.knownBy > 1 && site.knownBy < CONFIG.knownByMax) {
      site.knownBy++;
    }
  }
}

// ---------------------------------------------------------------------------
// Leaving and returning
// ---------------------------------------------------------------------------

export function voyageCost(state: GameState) {
  return CONFIG.portFee + state.ship.crew * CONFIG.wageAdvance;
}

export function canSail(state: GameState): string | null {
  if (state.mode !== 'port') return 'Not in port';
  if (state.pending.length) return 'Finish on the quay first';
  if (state.paymentsDue > 0) return 'Pay the financier first';
  if (state.ship.crew < CONFIG.crewMin) return `Sign on at least ${CONFIG.crewMin} crew`;
  if (state.ship.provisions < state.ship.crew * 5) return 'Load at least five days of provisions';
  if (state.cash < voyageCost(state)) return `Need ${money(voyageCost(state))} for port fees and wage advances`;
  return null;
}

export function setSail(state: GameState) {
  if (canSail(state)) return;
  state.cash -= voyageCost(state);
  const port = currentPort(state);
  const dock = port.dock;
  state.ship.x = dock.x + 0.5;
  state.ship.y = dock.y + 0.5;
  if (state.accepted && state.accepted.startDay === null) state.accepted.startDay = state.day;
  const voyage: Voyage = {
    contract: state.accepted,
    startDay: state.day,
    days: 0,
    startProvisions: state.ship.provisions,
    waypoints: [],
    track: [{ x: dock.x + 0.5, y: dock.y + 0.5 }],
    newCells: 0,
    landmassesFound: [],
    sitesFound: [],
    provisionAlerts: [],
    pointOfNoReturnWarned: false,
    becalmedDays: 0,
    slowDays: 0,
    restDays: 0,
    stormTomorrow: false,
    lastSignDay: state.day,
    sign: null,
    landfallTarget: -1,
    landfall: null,
    leftHome: false,
    startPort: port.id,
    homePort: port.id,
    homeDays: 0,
    homeRoute: [],
    portDays: state.world.ports.map(() => Infinity),
    newSum: { x: 0, y: 0 },
    quietDays: 0,
    step: 0,
  };
  state.voyage = voyage;
  state.accepted = null;
  state.mode = 'sea';
  state.paused = true;
  state.alert = 'Click the chart to plot a course, then press Sail.';
  state.voyagesSailed++;
  log(
    state,
    voyage.contract ? `We sail from ${port.name} under contract: ${voyage.contract.title}.` : `We sail from ${port.name} on our own account.`,
    'info',
  );
  reveal(state);
  updateHomeEstimate(state);
}

/** The ship is in port: pay the crew, settle the contract, put the charts in the chart case. */
export function arrive(state: GameState, portId: number) {
  const v = state.voyage!;
  const ship = state.ship;
  const port = state.world.ports[portId];
  ship.x = port.dock.x + 0.5;
  ship.y = port.dock.y + 0.5;
  state.portId = portId;
  state.mode = 'port';
  state.paused = true;
  state.alert = null;
  ship.rations = 'full';

  const wages = Math.round(ship.crew * CONFIG.wagePerDay * v.days);
  state.cash -= wages;

  const report: VoyageReport = {
    days: v.days,
    port: portId,
    newCells: v.newCells,
    landmasses: v.landmassesFound.slice(),
    sites: v.sitesFound.slice(),
    contract: v.contract,
    contractResult: null,
    bonus: 0,
    delivered: 0,
    wages,
    items: [],
  };

  const c = v.contract;
  if (c) {
    settleContract(state, c, portId, report);
  } else {
    const n = Math.max(1, v.newCells);
    const at = { x: v.newSum.x / n, y: v.newSum.y / n };
    if (v.newCells > 0) {
      report.items.push(addChartItem(state, 'area', `Chart of voyage ${state.voyagesSailed} (${v.newCells} sq. leagues)`, Math.round(v.newCells * CONFIG.chartRatePerCell), v.newCells, at));
    }
    for (const id of v.landmassesFound) {
      const lm = state.world.landmasses[id];
      report.items.push(addChartItem(state, 'landmass', `Coasts of ${landmassLabel(state, id)}`, CONFIG.landmassValue[lm.kind], id, { x: lm.cx, y: lm.cy }));
    }
    for (const id of v.sitesFound) {
      const site = state.world.sites[id];
      report.items.push(
        addChartItem(state, 'site', `${CONFIG.resources[site.type].label} on ${landmassLabel(state, site.landmass)}`, siteSaleValue(site), id, site),
      );
    }
  }

  state.report = report;
  state.voyage = null;
  state.contracts = generateContracts(state);
  log(state, `${portId === 0 ? 'Home to' : 'In port at'} ${port.name} after ${v.days} days.`, 'good');
  state.pending = [
    {
      kind: 'arrival',
      title: `${portId === 0 ? 'Home to' : 'Arrived at'} ${port.name}`,
      body: '',
      choices: [{ id: 'settle', label: 'Go ashore' }],
      data: { days: v.days },
    },
  ];
}

/**
 * A contract ends only at its named port. Anywhere else it stays open for the next voyage,
 * unless its deadline has passed. The patron owns the chart either way.
 */
function settleContract(state: GameState, c: Contract, portId: number, report: VoyageReport) {
  const ship = state.ship;
  const elapsed = contractElapsed(state, c);
  for (const id of c.sitesFound) state.world.sites[id].knownBy = Math.max(state.world.sites[id].knownBy, CONFIG.publicKnownBy);
  if (portId !== c.to && elapsed <= c.deadline) {
    report.contractResult = 'carried';
    state.accepted = c;
    log(state, `The contract ends at ${state.world.ports[c.to].name}, not here. It stays open: ${c.deadline - elapsed} days left.`, 'info');
    return;
  }
  if (portId === c.to && c.kind === 'find_resource' && c.resource) {
    // Deliver the cargo whether or not we are late: the patron owns it.
    report.delivered = Math.min(c.resource.qty, deliverableQty(state, c));
    let left = report.delivered;
    for (const lot of ship.cargo) {
      if (left <= 0) break;
      if (lot.type !== c.resource.type || !c.sitesFound.includes(lot.siteId)) continue;
      const take = Math.min(left, lot.qty);
      lot.qty -= take;
      left -= take;
    }
    ship.cargo = ship.cargo.filter((l) => l.qty > 0);
  }
  if (portId === c.to && c.done && elapsed <= c.deadline) {
    report.contractResult = 'done';
    report.bonus = c.bonus;
    state.cash += c.bonus;
    state.stats.earned += c.bonus;
    state.reputation++;
    state.contractsDone++;
    log(state, `Contract fulfilled: the ${c.patron} pays a bonus of ${money(c.bonus)}.`, 'good');
  } else {
    report.contractResult = c.done ? 'late' : 'failed';
    state.reputation = Math.max(0, state.reputation - 1);
    log(state, `Contract ${c.done ? 'completed too late' : 'failed'}. No bonus, and our name suffers.`, 'bad');
  }
  // Any of the patron's goods still aboard go back to the patron.
  ship.cargo = ship.cargo.filter((l) => l.type !== 'goods');
}

function addChartItem(state: GameState, kind: ChartItem['kind'], label: string, value: number, ref: number, at: { x: number; y: number }): number {
  const id = state.nextId++;
  state.chartCase.push({ id, kind, label, value, ref, x: Math.round(at.x), y: Math.round(at.y) });
  return id;
}

/**
 * Leave the arrival screen: the financier collects what is due. If there is not enough
 * coin, cargo and charts are sold off to cover it; if even that fails, the ship is seized.
 */
export function settle(state: GameState) {
  state.pending = state.pending.filter((p) => p.kind !== 'arrival');
  const owed = () => state.paymentsDue + Math.max(0, -state.cash);
  if (owed() > 0 && state.cash < state.paymentsDue) {
    const before = state.cash;
    sellCargo(state);
    for (const item of state.chartCase.slice()) {
      if (state.cash >= state.paymentsDue) break;
      sellChartItem(state, item.id);
    }
    if (state.cash > before) log(state, 'The financier’s agent forced the sale of cargo and charts to cover the payment.', 'bad');
  }
  if (state.cash < state.paymentsDue || state.cash < 0) {
    gameOver(
      state,
      'lost',
      'The financier seizes the ship',
      `You owed ${money(Math.round(owed()))} and could not pay. The ship is sold at auction on the quay.`,
    );
    return;
  }
  if (state.paymentsDue > 0) {
    payDebt(state, state.paymentsDue);
  }
  for (const n of state.news) log(state, n, 'bad');
  state.news = [];
}

// ---------------------------------------------------------------------------
// Selling
// ---------------------------------------------------------------------------

export function sellChartItem(state: GameState, id: number) {
  const i = state.chartCase.findIndex((c) => c.id === id);
  if (i < 0 || state.mode === 'sea') return;
  const item = state.chartCase[i];
  const price = chartPrice(state, item);
  state.chartCase.splice(i, 1);
  state.cash += price;
  state.stats.earned += price;
  if (item.kind === 'site') {
    const site = state.world.sites[item.ref];
    site.knownBy = Math.max(site.knownBy, CONFIG.publicKnownBy);
  }
  log(state, `Sold to the Admiralty at ${currentPort(state).name}: ${item.label}, for ${money(price)}.`, 'good');
}

/** What the cargo fetches at this port's market. A patron's goods are not ours to sell. */
export function cargoValue(state: GameState): number {
  const port = currentPort(state);
  return state.ship.cargo.reduce((a, l) => (l.type === 'goods' ? a : a + Math.round(l.qty * unitPrice(state.world.sites[l.siteId], port))), 0);
}

export function sellCargo(state: GameState) {
  if (state.mode === 'sea' || !state.ship.cargo.some((l) => l.type !== 'goods')) return;
  const value = cargoValue(state);
  state.cash += value;
  state.stats.earned += value;
  state.ship.cargo = state.ship.cargo.filter((l) => l.type === 'goods');
  log(state, `Cargo sold on the quay at ${currentPort(state).name} for ${money(value)}.`, 'good');
}

// ---------------------------------------------------------------------------
// Debt
// ---------------------------------------------------------------------------

export function payDebt(state: GameState, amount: number) {
  const pay = Math.min(Math.floor(amount), Math.floor(state.cash), state.debt);
  if (pay <= 0) return;
  state.cash -= pay;
  state.debt -= pay;
  state.paymentsDue = Math.max(0, state.paymentsDue - pay);
  log(state, `Paid ${money(pay)} to the financier. ${money(state.debt)} remains.`, 'info');
  if (state.debt <= 0) {
    // Owning the ship is a milestone, not the end: the sea is still there.
    state.stats.paidOffDay = state.day;
    state.pending.push({
      kind: 'notice',
      title: 'The ship is yours',
      body: `The last of the debt is paid. The financier tears up the bond, and ${currentPort(state).name} toasts the captain who charted ${state.stats.cellsCharted} square leagues of the unknown. No more payments fall due: every crown we earn from here is ours.`,
      choices: [{ id: 'ok', label: 'Sail on' }],
    });
    log(state, 'The last of the debt is paid. The ship is ours outright.', 'good');
  }
}

// ---------------------------------------------------------------------------
// Outfitting
// ---------------------------------------------------------------------------

export function hireCrew(state: GameState, delta: number) {
  const n = Math.max(CONFIG.crewLostBelow, Math.min(CONFIG.crewMax, state.ship.crew + delta));
  state.ship.crew = n;
}

export function buyProvisions(state: GameState, crewDays: number) {
  const room = provisionCap(state) - state.ship.provisions;
  const affordable = Math.floor(state.cash / CONFIG.provisionCost);
  const qty = Math.max(0, Math.min(crewDays, room, affordable));
  if (!qty) return;
  state.ship.provisions += qty;
  state.cash -= qty * CONFIG.provisionCost;
  state.cash = Math.round(state.cash * 100) / 100;
}

export function sellProvisions(state: GameState, crewDays: number) {
  const qty = Math.min(crewDays, state.ship.provisions);
  state.ship.provisions -= qty;
  state.cash += qty * CONFIG.provisionCost * 0.5;
  state.cash = Math.round(state.cash * 100) / 100;
}

export function buySupplies(state: GameState, n: number) {
  const qty = Math.min(n, CONFIG.suppliesMax - state.ship.supplies, Math.floor(state.cash / CONFIG.supplyCost));
  if (qty <= 0) return;
  state.ship.supplies += qty;
  state.cash -= qty * CONFIG.supplyCost;
}

export function repairCost(state: GameState): number {
  return Math.ceil((100 - state.ship.hull) * CONFIG.repairCostPerPoint);
}

export function repairHull(state: GameState) {
  const missing = 100 - state.ship.hull;
  const points = Math.min(missing, Math.floor(state.cash / CONFIG.repairCostPerPoint));
  if (points <= 0) return;
  state.ship.hull += points;
  state.cash -= points * CONFIG.repairCostPerPoint;
  log(state, `The shipwright repairs the hull (+${points}).`, 'info');
}

export type UpgradeKey = 'spyglass' | 'barometer' | 'surveyKit' | 'stores' | 'hold';

export interface UpgradeInfo {
  key: UpgradeKey;
  name: string;
  effect: string;
  level: number;
  maxLevel: number;
  cost: number | null;
}

export function upgradeList(state: GameState): UpgradeInfo[] {
  const u = state.upgrades;
  const U = CONFIG.upgrades;
  return [
    {
      key: 'spyglass',
      name: ['Spyglass', 'Fine spyglass', 'Dutch telescope'][Math.min(u.spyglass, 2)],
      effect: 'See one league farther: more of the sea charted as you sail.',
      level: u.spyglass,
      maxLevel: U.spyglass.length,
      cost: u.spyglass < U.spyglass.length ? U.spyglass[u.spyglass] : null,
    },
    {
      key: 'barometer',
      name: 'Barometer',
      effect: 'Warns of storms a day early. Prepared ships take less damage and find shelter farther away.',
      level: u.barometer ? 1 : 0,
      maxLevel: 1,
      cost: u.barometer ? null : U.barometer,
    },
    {
      key: 'surveyKit',
      name: 'Surveyor’s kit',
      effect: 'Surveys reach 8 leagues along the coast instead of 5.',
      level: u.surveyKit ? 1 : 0,
      maxLevel: 1,
      cost: u.surveyKit ? null : U.surveyKit,
    },
    {
      key: 'stores',
      name: 'Enlarged stores',
      effect: `+${CONFIG.provisionCapPerLevel} crew-days of provision space.`,
      level: u.stores,
      maxLevel: U.stores.length,
      cost: u.stores < U.stores.length ? U.stores[u.stores] : null,
    },
    {
      key: 'hold',
      name: 'Enlarged hold',
      effect: `+${CONFIG.cargoCapPerLevel} units of cargo space.`,
      level: u.hold,
      maxLevel: U.hold.length,
      cost: u.hold < U.hold.length ? U.hold[u.hold] : null,
    },
  ];
}

export function buyUpgrade(state: GameState, key: UpgradeKey) {
  const info = upgradeList(state).find((u) => u.key === key)!;
  if (info.cost === null || state.cash < info.cost || state.mode !== 'port') return;
  state.cash -= info.cost;
  const u = state.upgrades;
  if (key === 'spyglass') u.spyglass++;
  else if (key === 'barometer') u.barometer = true;
  else if (key === 'surveyKit') u.surveyKit = true;
  else if (key === 'stores') u.stores++;
  else u.hold++;
  log(state, `Bought: ${info.name}.`, 'info');
}

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

export function maxTier(state: GameState): number {
  return Math.min(3, Math.floor(state.reputation / 2));
}

export function acceptContract(state: GameState, id: number) {
  if (state.accepted || state.mode !== 'port') return;
  const c = state.contracts.find((x) => x.id === id);
  if (!c) return;
  state.accepted = c;
  state.contracts = state.contracts.filter((x) => x.id !== id);
  state.cash += c.advance;
  log(state, `Contract signed with the ${c.patron}: ${c.title}. Advance of ${money(c.advance)} received.`, 'good');
}

export function cancelContract(state: GameState) {
  const c = state.accepted;
  if (!c || state.cash < c.advance) return;
  state.cash -= c.advance;
  state.contracts.unshift(c);
  state.accepted = null;
  log(state, `Contract returned to the ${c.patron}, advance repaid.`, 'info');
}

function bearing(from: { x: number; y: number }, x: number, y: number): string {
  return compass(x - from.x, y - from.y);
}

/** Rough cost of a voyage of n days with the current crew, used to size advances. */
function estCost(state: GameState, days: number): number {
  const crew = Math.max(state.ship.crew, 10);
  return Math.round(crew * days * (CONFIG.provisionCost + CONFIG.wagePerDay) + crew * CONFIG.wageAdvance + CONFIG.portFee);
}

export function generateContracts(state: GameState): Contract[] {
  const top = maxTier(state);
  const tiers = [top, Math.max(0, top - 1), top];
  const kinds: Contract['kind'][] = withRng(state, (rng) => {
    const all: Contract['kind'][] = ['chart_region', 'find_land', 'find_resource'];
    for (let i = all.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [all[i], all[j]] = [all[j], all[i]];
    }
    return all;
  });
  const out: Contract[] = [];
  for (let i = 0; i < 3; i++) {
    const c = makeContract(state, kinds[i], tiers[i]) ?? makeContract(state, 'chart_region', tiers[i]);
    if (c) out.push(c);
  }
  return out;
}

/** How far out a tier's work lies, as a share of a sea's width from the port. */
function tierBand(tier: number): [number, number] {
  return [0.12 + 0.2 * tier, 0.3 + 0.22 * tier];
}

function contractBase(state: GameState, tier: number) {
  const port = currentPort(state);
  return {
    id: state.nextId++,
    patron: withRng(state, (rng) => rng.pick(['Crown', 'Admiralty'] as const)),
    tier,
    from: port.id,
    to: port.id,
    startDay: null,
    done: false,
    sitesFound: [] as number[],
  };
}

function makeContract(state: GameState, kind: Contract['kind'], tier: number): Contract | null {
  const { world } = state;
  const port = currentPort(state);
  const dock = port.dock;
  const B = bounds(state);
  const span = CONFIG.seaWidth - 6;
  const [lo, hi] = tierBand(tier);

  if (kind === 'chart_region') {
    for (let attempt = 0; attempt < 80; attempt++) {
      const r = 5;
      const { x, y } = withRng(state, (rng) => {
        const a = rng.range(0, Math.PI * 2);
        const d = span * rng.range(lo, hi);
        return { x: Math.round(dock.x + Math.cos(a) * d), y: Math.round(dock.y + Math.sin(a) * d) };
      });
      if (!inRect({ x0: B.x0 + r, y0: B.y0 + r, x1: B.x1 - r, y1: B.y1 - r }, x, y)) continue;
      const target = { x, y, r, share: 0.6 };
      if (regionShare(state, target) > 0.3) continue;
      const dist = Math.hypot(x - dock.x, y - dock.y);
      const days = Math.ceil((2 * dist) / CONFIG.speedOpen) + 8;
      const deadline = Math.ceil(days * 1.5);
      return {
        ...contractBase(state, tier),
        kind,
        title: `Chart the waters ${Math.round(dist)} leagues ${bearing(dock, x, y)}`,
        description: `The sea around the marked position charted: at least 60% of the circle. Back at ${port.name} within ${deadline} days.`,
        advance: Math.round(estCost(state, days) * 0.75),
        bonus: Math.round(120 + dist * 4 + tier * 70),
        deadline,
        target,
      };
    }
    return null;
  }

  if (kind === 'find_land') {
    const withinDays = 8 + tier * 6;
    const reach = withinDays * CONFIG.speedOpen;
    const candidate = world.landmasses.some(
      (lm) => !lm.discovered && inRect(B, lm.cx, lm.cy) && Math.hypot(lm.cx - dock.x, lm.cy - dock.y) <= reach,
    );
    if (!candidate) return null;
    const deadline = withinDays * 2 + 10;
    return {
      ...contractBase(state, tier),
      kind,
      title: `Find new land within ${withinDays} days’ sail`,
      description: `Sight any land not yet on the chart within ${withinDays} days of leaving port, and be back at ${port.name} within ${deadline} days.`,
      advance: Math.round(estCost(state, withinDays * 2) * 0.75),
      bonus: Math.round(140 + tier * 90),
      deadline,
      withinDays,
    };
  }

  if (kind === 'find_resource') {
    // A type that exists on an unsurveyed site at this tier's distance.
    const candidates = world.sites.filter((s) => {
      const d = Math.hypot(s.x - dock.x, s.y - dock.y) / span;
      return !s.surveyed && s.knownBy === 0 && inRect(B, s.x, s.y) && d >= lo - 0.1 && d <= hi + 0.1;
    });
    if (!candidates.length) return null;
    const site = withRng(state, (rng) => rng.pick(candidates));
    const type: ResourceType = site.type;
    const qty = Math.max(3, Math.min(10, Math.round(site.maxStock * 0.6)));
    const nearest = Math.min(
      ...world.sites.filter((s) => s.type === type && !s.surveyed && inRect(B, s.x, s.y)).map((s) => Math.hypot(s.x - dock.x, s.y - dock.y)),
    );
    const days = Math.ceil((2 * nearest) / CONFIG.speedOpen) + 12;
    const deadline = Math.ceil(days * 1.6);
    const label = CONFIG.resources[type].label.toLowerCase();
    return {
      ...contractBase(state, tier),
      kind,
      title: `Bring ${qty} units of ${label} to ${port.name}`,
      description: `Find a new source of ${label} (one nobody has surveyed before) and bring ${qty} units to ${port.name} within ${deadline} days.`,
      advance: Math.round(estCost(state, days) * 0.7),
      bonus: Math.round(qty * CONFIG.resources[type].price * 1.3 + 80 + tier * 60),
      deadline,
      resource: { type, qty },
    };
  }

  return null;
}
