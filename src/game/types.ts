export enum Cell {
  Sea = 0,
  Land = 1,
  Reef = 2,
  /** Drifting ice: a hazard like a reef, in the cold northern sea. It moves each season. */
  Ice = 3,
}

export type ResourceType = 'timber' | 'furs' | 'spice' | 'pearls';

export type LandmassKind = 'islet' | 'island' | 'large island' | 'coast';

export interface Landmass {
  id: number;
  size: number;
  kind: LandmassKind;
  /** Label anchor: the land cell closest to the landmass centroid. */
  cx: number;
  cy: number;
  home: boolean;
  /** Suggested name, offered when the player names it. */
  suggestedName: string;
  /** Name given by the player; empty until named. */
  name: string;
  /** Forage quality for shore parties, 0.5–1.5. */
  forage: number;
  /** On the player's chart. */
  discovered: boolean;
  /** The far port's continent. */
  farShore?: boolean;
  /** Day a shore party last foraged here; the land recovers over a season. */
  lastForaged?: number;
}

export interface Site {
  id: number;
  x: number;
  y: number;
  landmass: number;
  type: ResourceType;
  /** 0–1: how rich the site is; richer sites sit farther out. */
  richness: number;
  /** Cargo units it holds when fully replenished. */
  maxStock: number;
  stock: number;
  /** Player has surveyed it. */
  surveyed: boolean;
  /**
   * How many ships know the site, including the player once surveyed.
   * 1 = the player's secret. Selling or losing the secret raises it.
   */
  knownBy: number;
}

export interface Wreck {
  x: number;
  y: number;
  looted: boolean;
  sighted: boolean;
}

export interface Port {
  id: number;
  name: string;
  /** Who holds the port. */
  power: string;
  /** Town: the land cell the port stands on. */
  x: number;
  y: number;
  /** Sea cell where ships dock. */
  dock: { x: number; y: number };
  /** Price multiplier per cargo type at this port's market. */
  prices: Record<ResourceType, number>;
  /** On the player's chart. The home port always is. */
  known: boolean;
}

export interface Rect {
  x0: number;
  y0: number;
  /** Exclusive. */
  x1: number;
  y1: number;
}

/** Which corner of the first sea holds the far port; the world grows away from it. */
export type Corner = 'ne' | 'se';

export interface World {
  seed: string;
  width: number;
  height: number;
  corner: Corner;
  /** The V1 sea: all that can be sailed until the far port is found. */
  firstSea: Rect;
  /** Cell per index (y * width + x). */
  cells: Uint8Array;
  /** Landmass id per cell, -1 for water. */
  landmassOf: Int16Array;
  landmasses: Landmass[];
  sites: Site[];
  wrecks: Wreck[];
  /** 0 is home; 1 is the far port. */
  ports: Port[];
}

export interface CargoLot {
  /** Site it was loaded at; -1 for a patron's goods. */
  siteId: number;
  type: ResourceType | 'goods';
  qty: number;
}

export type Rations = 'full' | 'short';

export type ShipKind = 'pinnace' | 'brig';

/** Refits belong to a hull: they go with the ship when command changes. */
export interface Refits {
  stores: number;
  hold: number;
}

export interface Ship {
  name: string;
  kind: ShipKind;
  refits: Refits;
  x: number;
  y: number;
  crew: number;
  /** Food and water, in crew-days. */
  provisions: number;
  hull: number;
  /** Repair supplies for patching at sea. */
  supplies: number;
  cargo: CargoLot[];
  rations: Rations;
}

/** Instruments belong to the captain and go with them from ship to ship. */
export interface Upgrades {
  spyglass: number;
  barometer: boolean;
  surveyKit: boolean;
}

/** A trading post built at a surveyed site. It gathers the site's cargo each season. */
export interface Post {
  id: number;
  siteId: number;
  name: string;
  foundedDay: number;
  /** Cargo gathered and waiting to be collected. */
  warehouse: number;
  lastSupplied: number;
  abandoned: boolean;
}

/** A ship the captain is not sailing: laid up in a port, or working a route. */
export interface Vessel {
  id: number;
  name: string;
  kind: ShipKind;
  hull: number;
  refits: Refits;
  /** Port it lies in, or the port its route started from. */
  portId: number;
  routeId: number | null;
}

export interface RouteStop {
  kind: 'port' | 'post';
  id: number;
}

/** A charted round of ports and posts that a vessel sails each season without us. */
export interface Route {
  id: number;
  vesselId: number;
  stops: RouteStop[];
  /** Round-trip length in leagues. */
  length: number;
  /** The charted way round, simplified, for drawing. */
  path: { x: number; y: number }[];
  /** Chance each season of losing the ship. */
  risk: number;
  lastIncome: number;
  lastNote: string;
}

export type ContractKind = 'chart_region' | 'find_land' | 'find_resource' | 'despatches' | 'passage' | 'supply_post';

export interface Contract {
  id: number;
  patron: 'Crown' | 'Admiralty';
  kind: ContractKind;
  title: string;
  description: string;
  tier: number;
  advance: number;
  bonus: number;
  /** Port where it was signed, and port where it must end. */
  from: number;
  to: number;
  /** Must end at `to` within this many days of first setting sail under it. */
  deadline: number;
  /** Day the first voyage under this contract set sail; null until then. */
  startDay: number | null;
  /** Objective reached; the bonus is paid on reaching `to` in time. */
  done: boolean;
  /** find_resource: sites surveyed while under this contract. */
  sitesFound: number[];
  /** supply_post: the patron's post, where the goods are to be landed. */
  post?: { x: number; y: number; name: string };
  /** supply_post: units of the patron's goods carried in the hold. */
  goods?: number;
  /** chart_region: centre and radius; charted share required. */
  target?: { x: number; y: number; r: number; share: number };
  /** find_land: new land must be sighted within this many days of sailing. */
  withinDays?: number;
  /** find_resource: bring home this much of this cargo, from a site unknown when the contract was signed. */
  resource?: { type: ResourceType; qty: number };
}

/** A chart item the player holds and may sell to the Admiralty. */
export interface ChartItem {
  id: number;
  kind: 'area' | 'landmass' | 'site';
  label: string;
  value: number;
  /** area: charted cell count. landmass/site: the id. */
  ref: number;
  /** Where the charted waters lie: each Admiralty pays more for waters near the other port. */
  x: number;
  y: number;
}

export interface Choice {
  id: string;
  label: string;
  hint?: string;
  disabled?: boolean;
  /** How the consequence reads: risky (vermilion), safe (verdigris) or money (gilt). */
  tone?: 'risk' | 'safe' | 'money';
}

export type InterruptKind =
  | 'notice'
  | 'land_ho'
  | 'far_port'
  | 'storm'
  | 'storm_warning'
  | 'sickness'
  | 'becalmed'
  | 'wreck'
  | 'spoiled'
  | 'landfall'
  | 'arrival'
  | 'gameover';

export interface Interrupt {
  kind: InterruptKind;
  title: string;
  body: string;
  choices: Choice[];
  /** Kind-specific payload (e.g. landmass id, wreck index). */
  data?: Record<string, number>;
}

export interface Landfall {
  landmass: number;
  shorePartyDone: boolean;
  surveyed: boolean;
}

export interface Voyage {
  contract: Contract | null;
  startDay: number;
  days: number;
  startProvisions: number;
  waypoints: { x: number; y: number }[];
  /** Where the ship has sailed this voyage. */
  track: { x: number; y: number }[];
  /** Cells charted for the first time on this voyage. */
  newCells: number;
  landmassesFound: number[];
  sitesFound: number[];
  provisionAlerts: number[];
  pointOfNoReturnWarned: boolean;
  becalmedDays: number;
  slowDays: number;
  restDays: number;
  stormTomorrow: boolean;
  lastSignDay: number;
  sign: { x: number; y: number; dir: string; until: number } | null;
  landfallTarget: number;
  landfall: Landfall | null;
  leftHome: boolean;
  /** Port the voyage started from. */
  startPort: number;
  /** Days to the nearest haven, port or trading post: what the point of no return is measured against. */
  havenDays: number;
  /** Nearest known port by charted water: its id, days away and route. */
  homePort: number;
  homeDays: number;
  homeRoute: { x: number; y: number }[];
  /** Days to each port by charted water (Infinity where unknown or unreachable). */
  portDays: number[];
  /** Sum of coordinates of newly charted cells, for placing the voyage's chart. */
  newSum: { x: number; y: number };
  /** Days since the last stop for a decision; drives the pacing filler. */
  quietDays: number;
  /** Sub-day progress, 0..STEPS_PER_DAY-1. */
  step: number;
}

export interface VoyageReport {
  days: number;
  /** Port the voyage ended at. */
  port: number;
  newCells: number;
  landmasses: number[];
  sites: number[];
  contract: Contract | null;
  contractResult: 'done' | 'late' | 'failed' | 'carried' | null;
  bonus: number;
  delivered: number;
  wages: number;
  /** Chart case items added by this voyage. */
  items: number[];
}

export interface LogEntry {
  day: number;
  text: string;
  tone?: 'good' | 'bad' | 'info';
}

export interface GameState {
  version: number;
  world: World;
  /** Port the ship lies in, or last sailed from. */
  portId: number;
  /** The far port has been found and the whole world can be sailed. */
  expanded: boolean;
  /** 1 if the cell is on the player's chart. */
  known: Uint8Array;
  rng: number;
  day: number;
  cash: number;
  debt: number;
  debtStart: number;
  paymentPerSeason: number;
  /** Payments that fell due and are not yet paid. */
  paymentsDue: number;
  reputation: number;
  contractsDone: number;
  ship: Ship;
  upgrades: Upgrades;
  contracts: Contract[];
  nextId: number;
  chartCase: ChartItem[];
  voyage: Voyage | null;
  voyagesSailed: number;
  mode: 'port' | 'sea' | 'over';
  outcome: 'lost' | null;
  paused: boolean;
  /** Why the voyage is paused, shown in the HUD. */
  alert: string | null;
  pending: Interrupt[];
  /** Contract accepted in port for the next voyage. */
  accepted: Contract | null;
  posts: Post[];
  fleet: Vessel[];
  routes: Route[];
  /** Milestones reached, by id. */
  milestones: string[];
  /** The last voyage's report, for the arrival screen. */
  report: VoyageReport | null;
  /** News that happened while at sea, told on return. */
  news: string[];
  log: LogEntry[];
  stats: { cellsCharted: number; landmassesNamed: number; earned: number; treasure: number; paidOffDay?: number; retries?: number };
  /**
   * The game as it stood on the quay before the current (or last) voyage, saved as text. If the
   * voyage ends in disaster, the player can go back to it.
   */
  checkpoint?: string;
}
