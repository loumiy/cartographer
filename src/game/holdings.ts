import { CONFIG } from './config';
import { cargoCap, cargoUsed, crewMax, isKnown, knownFactor, levelsSum, log, money, postAnchor, postAt, provisionCap, raise, withRng } from './core';
import { shipName } from './names';
import { findPath, pathLength, simplifyPath } from './pathfind';
import { Cell, type GameState, type Post, type Route, type RouteStop, type ShipKind, type Site, type Vessel } from './types';
import { cellAt } from './world';

// ---------------------------------------------------------------------------
// Trading posts
// ---------------------------------------------------------------------------

export function timberAboard(state: GameState): number {
  return state.ship.cargo.filter((l) => l.type === 'timber').reduce((a, l) => a + l.qty, 0);
}

function takeTimber(state: GameState, qty: number) {
  let left = qty;
  for (const lot of state.ship.cargo) {
    if (lot.type !== 'timber' || left <= 0) continue;
    const take = Math.min(left, lot.qty);
    lot.qty -= take;
    left -= take;
  }
  state.ship.cargo = state.ship.cargo.filter((l) => l.qty > 0);
}

/** Why a post can't be founded at this site now, or null. */
export function cannotFound(state: GameState, site: Site): string | null {
  const P = CONFIG.post;
  if (!site.surveyed) return 'Survey the site first';
  if (postAt(state, site.id)) return 'There is a post here already';
  if (state.cash < P.cost) return `Needs ${money(P.cost)}`;
  if (timberAboard(state) < P.timber) return `Needs ${P.timber} units of timber in the hold`;
  return null;
}

export function foundPost(state: GameState, site: Site): Post | null {
  if (cannotFound(state, site)) return null;
  const P = CONFIG.post;
  state.cash -= P.cost;
  takeTimber(state, P.timber);
  const post: Post = {
    id: state.nextId++,
    siteId: site.id,
    // Named for its land once the land has a name; numbered until then.
    name: `${CONFIG.resources[site.type].label} post no. ${state.posts.length + 1}`,
    foundedDay: state.day,
    warehouse: 0,
    lastSupplied: state.day,
    abandoned: false,
  };
  // The post takes the site's output from now on.
  post.warehouse = site.stock;
  site.stock = 0;
  state.posts.push(post);
  log(state, `We found a trading post: the ${postLabel(state, post)}.`, 'good');
  checkMilestones(state);
  return post;
}

/** A post goes by the name of its land, once that land is named. */
export function postLabel(state: GameState, post: Post): string {
  const site = state.world.sites[post.siteId];
  const lm = state.world.landmasses[site.landmass];
  return lm.name ? `${CONFIG.resources[site.type].label} post on ${lm.name}` : post.name;
}

export function seasonsSinceSupplied(state: GameState, post: Post): number {
  return Math.floor((state.day - post.lastSupplied) / CONFIG.season);
}

/** Output per season, from full down to nothing as the post goes unsupplied. */
export function postOutput(state: GameState, post: Post): number {
  if (post.abandoned) return 0;
  const since = seasonsSinceSupplied(state, post);
  const site = state.world.sites[post.siteId];
  const full = site.maxStock * CONFIG.post.yield;
  if (since < CONFIG.post.fullFor) return full;
  if (since < CONFIG.post.halfFor) return Math.round(full / 2);
  return 0;
}

export function warehouseCap(state: GameState, post: Post): number {
  return state.world.sites[post.siteId].maxStock * CONFIG.post.yield * CONFIG.post.warehouseSeasons;
}

/** Chance a route's ship is lost in a season: only a share of storm hits sink her, fewer for a brig. */
export function routeLossChance(state: GameState, route: { risk: number; vesselId: number }): number {
  const v = state.fleet.find((f) => f.id === route.vesselId);
  return stormChance(route.risk, v?.kind) * CONFIG.route.lossShare;
}

function stormChance(risk: number, kind: ShipKind | undefined): number {
  return Math.min(CONFIG.route.maxRisk, risk) * (kind === 'brig' ? CONFIG.route.brigRisk : 1);
}

export function cannotResupply(state: GameState): string | null {
  const P = CONFIG.post;
  if (timberAboard(state) < P.supplyTimber) return `Needs ${P.supplyTimber} units of timber`;
  if (state.ship.provisions < P.supplyStores + state.ship.crew * 3) return `Needs ${P.supplyStores} crew-days of stores to spare`;
  return null;
}

export function resupplyPost(state: GameState, post: Post) {
  if (cannotResupply(state)) return;
  takeTimber(state, CONFIG.post.supplyTimber);
  state.ship.provisions -= CONFIG.post.supplyStores;
  post.lastSupplied = state.day;
  log(state, `We land timber and stores at the ${postLabel(state, post)}.`, 'good');
}

/** Load what the post's warehouse holds, as far as the hold allows. */
export function collectFromPost(state: GameState, post: Post): number {
  const qty = Math.min(post.warehouse, cargoCap(state) - cargoUsed(state));
  if (qty <= 0) return 0;
  const site = state.world.sites[post.siteId];
  post.warehouse -= qty;
  const lot = state.ship.cargo.find((l) => l.siteId === site.id);
  if (lot) lot.qty += qty;
  else state.ship.cargo.push({ siteId: site.id, type: site.type, qty });
  log(state, `We load ${qty} units of ${CONFIG.resources[site.type].label.toLowerCase()} from the ${postLabel(state, post)}.`, 'good');
  return qty;
}

export function postStorePrice(): number {
  return CONFIG.provisionCost * CONFIG.post.markup;
}

/** Fill the stores at a post's markup. */
export function buyStoresAtPost(state: GameState) {
  const price = postStorePrice();
  const qty = Math.max(0, Math.min(provisionCap(state) - state.ship.provisions, Math.floor(state.cash / price)));
  if (!qty) return;
  state.ship.provisions += qty;
  state.cash = Math.round((state.cash - qty * price) * 100) / 100;
  log(state, `We buy ${Math.floor(qty / Math.max(1, state.ship.crew))} days of stores at the post, at a price.`, 'info');
}

export function postRepairCost(state: GameState): number {
  return Math.ceil((100 - state.ship.hull) * CONFIG.repairCostPerPoint * CONFIG.post.markup);
}

export function repairAtPost(state: GameState) {
  const perPoint = CONFIG.repairCostPerPoint * CONFIG.post.markup;
  const points = Math.min(100 - state.ship.hull, Math.floor(state.cash / perPoint));
  if (points <= 0) return;
  state.ship.hull += points;
  state.cash -= Math.ceil(points * perPoint);
  log(state, `The post’s carpenters repair the hull (+${points}).`, 'info');
}

// ---------------------------------------------------------------------------
// Ships
// ---------------------------------------------------------------------------

export function buyShip(state: GameState, kind: ShipKind): Vessel | null {
  const cost = CONFIG.ships[kind].cost;
  if (state.mode !== 'port' || state.cash < cost) return null;
  state.cash -= cost;
  const used = [state.ship.name, ...state.fleet.map((f) => f.name)];
  const vessel: Vessel = {
    id: state.nextId++,
    name: withRng(state, (rng) => shipName(rng, used)),
    kind,
    hull: 100,
    refits: { stores: 0, hold: 0 },
    portId: state.portId,
    routeId: null,
  };
  state.fleet.push(vessel);
  log(state, `We buy a ${CONFIG.ships[kind].label.toLowerCase()}, the ${vessel.name}. She lies at ${state.world.ports[state.portId].name}.`, 'good');
  return vessel;
}

/** Why the captain can't shift to this vessel now, or null. */
export function cannotCommand(state: GameState, v: Vessel): string | null {
  if (state.mode !== 'port') return 'Only in port';
  if (v.routeId !== null) return 'She is working a route';
  if (v.portId !== state.portId) return `She lies at ${state.world.ports[v.portId].name}`;
  const hold = CONFIG.ships[v.kind].hold + levelsSum(CONFIG.holdLevels, v.refits.hold);
  if (cargoUsed(state) > hold) return 'Her hold is too small for our cargo';
  return null;
}

/** Shift command: crew, stores and cargo move across; the old ship stays in port as a vessel. */
export function takeCommand(state: GameState, vesselId: number) {
  const v = state.fleet.find((f) => f.id === vesselId);
  if (!v || cannotCommand(state, v)) return;
  const old = state.ship;
  const laidUp: Vessel = { id: v.id, name: old.name, kind: old.kind, hull: old.hull, refits: old.refits, portId: state.portId, routeId: null };
  state.fleet = state.fleet.map((f) => (f.id === v.id ? laidUp : f));
  state.ship = { ...old, name: v.name, kind: v.kind, hull: v.hull, refits: v.refits };
  state.ship.crew = Math.min(state.ship.crew, crewMax(state));
  state.ship.provisions = Math.min(state.ship.provisions, provisionCap(state));
  log(state, `We take command of the ${v.name}. The ${old.name} lies at ${state.world.ports[state.portId].name}.`, 'info');
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function stopName(state: GameState, stop: RouteStop): string {
  if (stop.kind === 'port') return state.world.ports[stop.id].name;
  const post = state.posts.find((p) => p.id === stop.id);
  return post ? postLabel(state, post) : 'a lost post';
}

function stopPoint(state: GameState, stop: RouteStop): { x: number; y: number } | null {
  if (stop.kind === 'port') {
    const d = state.world.ports[stop.id].dock;
    return { x: d.x + 0.5, y: d.y + 0.5 };
  }
  const post = state.posts.find((p) => p.id === stop.id && !p.abandoned);
  return post ? postAnchor(state, post) : null;
}

export interface RoutePlan {
  length: number;
  path: { x: number; y: number }[];
  risk: number;
  /** Rough takings per season, after costs. */
  estimate: number;
}

/**
 * Check a route: every leg, and the leg back to the start, must run over charted water.
 * Risk grows with known hazards along the way and falls where the route follows a charted coast.
 */
export function planRoute(state: GameState, stops: RouteStop[]): RoutePlan | string {
  if (stops.length < 2) return 'Choose at least two stops';
  if (!stops.some((s) => s.kind === 'port')) return 'A route needs at least one port';
  const R = CONFIG.route;
  let length = 0;
  const way: { x: number; y: number }[] = [];
  let hazards = 0;
  let open = 0;
  let steps = 0;
  for (let i = 0; i < stops.length; i++) {
    const a = stopPoint(state, stops[i]);
    const b = stopPoint(state, stops[(i + 1) % stops.length]);
    if (!a || !b) return `No anchorage charted at ${stopName(state, stops[a ? (i + 1) % stops.length : i])}`;
    const path = findPath(state.world, { known: state.known }, a, b);
    if (!path) return `No charted water between ${stopName(state, stops[i])} and ${stopName(state, stops[(i + 1) % stops.length])}`;
    length += pathLength(a, path);
    way.push(a, ...simplifyPath(path));
    for (const p of path) {
      steps++;
      let nearHazard = false;
      let nearLand = false;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = Math.floor(p.x) + dx;
          const y = Math.floor(p.y) + dy;
          if (!isKnown(state, x, y)) continue;
          const c = cellAt(state.world, x, y);
          if (c === Cell.Reef || c === Cell.Ice) nearHazard = true;
          if (c === Cell.Land) nearLand = true;
        }
      }
      if (nearHazard) hazards++;
      if (!nearLand) open++;
    }
  }
  const risk = Math.min(R.maxRisk, R.baseRisk + R.hazardRisk * hazards + R.openRisk * (open / Math.max(1, steps)));
  return { length: Math.round(length), path: way, risk, estimate: Math.round(routeTakings(state, stops, length).net) };
}

/** What a route earns in a season: posts' warehouses sold at the best port on the route, or port-to-port trade. */
function routeTakings(state: GameState, stops: RouteStop[], length: number) {
  const R = CONFIG.route;
  const ports = stops.filter((s) => s.kind === 'port').map((s) => state.world.ports[s.id]);
  const posts = stops.filter((s) => s.kind === 'post').map((s) => state.posts.find((p) => p.id === s.id)).filter((p): p is Post => !!p && !p.abandoned);
  let gross = 0;
  let carried = 0;
  for (const post of posts) {
    const site = state.world.sites[post.siteId];
    const qty = Math.max(post.warehouse, postOutput(state, post));
    const best = Math.max(...ports.map((p) => p.prices[site.type]));
    gross += qty * CONFIG.resources[site.type].price * (0.8 + 0.4 * site.richness) * Math.max(R.priceFloor, knownFactor(site.knownBy)) * best;
    carried += qty;
  }
  if (!posts.length && ports.length >= 2) gross += R.portTrade + length * R.portTradePerLeague;
  const costs = R.costs + R.postUpkeep * posts.length;
  return { gross, costs, carried, posts, net: gross * (1 - R.masterShare) - costs };
}

export function createRoute(state: GameState, vesselId: number, stops: RouteStop[]): Route | string {
  const v = state.fleet.find((f) => f.id === vesselId);
  if (!v) return 'No such ship';
  if (v.routeId !== null) return 'She is already on a route';
  if (v.portId !== state.portId) return `She lies at ${state.world.ports[v.portId].name}`;
  if (!stops.some((s) => s.kind === 'port' && s.id === v.portId)) return `The route must call at ${state.world.ports[v.portId].name}, where she lies`;
  const plan = planRoute(state, stops);
  if (typeof plan === 'string') return plan;
  const route: Route = { id: state.nextId++, vesselId, stops, length: plan.length, path: plan.path, risk: plan.risk, lastIncome: 0, lastNote: 'Not yet sailed' };
  state.routes.push(route);
  v.routeId = route.id;
  log(state, `The ${v.name} sails on a route: ${stops.map((s) => stopName(state, s)).join(', ')}.`, 'good');
  checkMilestones(state);
  return route;
}

export function endRoute(state: GameState, routeId: number) {
  const route = state.routes.find((r) => r.id === routeId);
  if (!route) return;
  const v = state.fleet.find((f) => f.id === route.vesselId);
  if (v) {
    v.routeId = null;
    v.portId = route.stops.find((s) => s.kind === 'port')!.id;
    log(state, `The ${v.name} comes off her route and lies at ${state.world.ports[v.portId].name}.`, 'info');
  }
  state.routes = state.routes.filter((r) => r.id !== routeId);
}

// ---------------------------------------------------------------------------
// Each season
// ---------------------------------------------------------------------------

/** Posts gather or decline; route ships earn, suffer, or are lost. Results are told at the next port. */
export function processHoldings(state: GameState) {
  for (const post of state.posts) {
    if (post.abandoned) continue;
    const site = state.world.sites[post.siteId];
    if (seasonsSinceSupplied(state, post) >= CONFIG.post.abandonAt) {
      post.abandoned = true;
      state.news.push(`The ${postLabel(state, post)} has been abandoned: nobody brought supplies for ${CONFIG.post.abandonAt} seasons.`);
      continue;
    }
    post.warehouse = Math.min(warehouseCap(state, post), post.warehouse + postOutput(state, post));
    site.stock = 0;
    const since = seasonsSinceSupplied(state, post);
    if (since === CONFIG.post.fullFor) state.news.push(`The ${postLabel(state, post)} is short of supplies: its output has halved.`);
  }

  for (const route of state.routes.slice()) {
    const v = state.fleet.find((f) => f.id === route.vesselId);
    if (!v) continue;
    const R = CONFIG.route;
    // A storm hit usually means damage and a poor season; only rarely is the ship lost.
    const hit = withRng(state, (rng) => rng.chance(stormChance(route.risk, v.kind)));
    if (hit && withRng(state, (rng) => rng.chance(R.lossShare))) {
      state.fleet = state.fleet.filter((f) => f.id !== v.id);
      state.routes = state.routes.filter((r) => r.id !== route.id);
      state.news.push(`The ${v.name} did not come in from her route. She is given up for lost.`);
      continue;
    }
    const takings = routeTakings(state, route.stops, route.length);
    for (const post of takings.posts) {
      post.warehouse = 0;
      post.lastSupplied = state.day; // The route ship keeps its posts supplied.
    }
    let net = takings.net;
    let note = takings.carried ? `Carried ${Math.round(takings.carried)} units` : 'Traded between ports';
    if (hit) {
      v.hull = Math.max(10, v.hull - Math.round(R.hitDamage * CONFIG.ships[v.kind].toughness));
      net /= 2;
      note += '; a storm cost half the season';
    }
    // She is kept in repair between rounds, paid out of the takings.
    const repairs = Math.ceil((100 - v.hull) * CONFIG.repairCostPerPoint);
    if (repairs > 0) {
      net -= repairs;
      v.hull = 100;
      note += `; repairs ${money(repairs)}`;
    }
    net = Math.round(net);
    route.lastIncome = net;
    route.lastNote = note;
    state.cash += net;
    if (net > 0) state.stats.earned += net;
    state.news.push(`The ${v.name}’s route ${net >= 0 ? `earned ${money(net)}` : `lost ${money(-net)}`} this season. ${note}.`);
  }
  checkMilestones(state);
}

// ---------------------------------------------------------------------------
// Milestones: goals without an ending
// ---------------------------------------------------------------------------

export const MILESTONES: { id: string; title: string; text: string }[] = [
  { id: 'far_shore', title: 'The far shore', text: 'We crossed the first sea and found a port on the far side.' },
  { id: 'first_post', title: 'A post of our own', text: 'We founded our first trading post.' },
  { id: 'first_route', title: 'A ship that sails without us', text: 'One of our ships works a route on her own.' },
  { id: 'half_charted', title: 'Half the world', text: 'Half of the known world is on our chart.' },
  { id: 'three_posts', title: 'Three posts', text: 'We hold three trading posts at once.' },
  {
    id: 'charter',
    title: 'A Crown charter',
    text: `The Crown grants a charter for a trading company in our name, and a purse of ${money(CONFIG.charterReward)} to go with it.`,
  },
];

function reached(state: GameState, id: string): boolean {
  const active = state.posts.filter((p) => !p.abandoned).length;
  switch (id) {
    case 'far_shore':
      return state.expanded;
    case 'first_post':
      return state.posts.length > 0;
    case 'first_route':
      return state.routes.length > 0;
    case 'half_charted':
      return state.stats.cellsCharted >= (state.world.width * state.world.height) / 2;
    case 'three_posts':
      return active >= 3;
    case 'charter':
      return ['first_route', 'half_charted', 'three_posts'].every((m) => state.milestones.includes(m));
    default:
      return false;
  }
}

export function checkMilestones(state: GameState) {
  for (const m of MILESTONES) {
    if (state.milestones.includes(m.id) || !reached(state, m.id)) continue;
    state.milestones.push(m.id);
    if (m.id === 'charter') {
      state.cash += CONFIG.charterReward;
      state.reputation += 2;
    }
    log(state, `${m.title}: ${m.text}`, 'good');
    raise(state, { kind: 'notice', title: m.title, body: m.text, choices: [{ id: 'ok', label: 'Sail on' }] });
  }
}
