export enum Cell {
  Sea = 0,
  Land = 1,
  Reef = 2,
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

export interface World {
  seed: string;
  width: number;
  height: number;
  /** Cell per index (y * width + x). */
  cells: Uint8Array;
  /** Landmass id per cell, -1 for water. */
  landmassOf: Int16Array;
  landmasses: Landmass[];
  sites: Site[];
  wrecks: Wreck[];
  homePort: { x: number; y: number };
  /** Sea cell where the ship docks. */
  dock: { x: number; y: number };
  portName: string;
}

export interface CargoLot {
  siteId: number;
  type: ResourceType;
  qty: number;
}

export type Rations = 'full' | 'short';

export interface Ship {
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

export interface Upgrades {
  spyglass: number;
  barometer: boolean;
  surveyKit: boolean;
  stores: number;
  hold: number;
}

export type ContractKind = 'chart_region' | 'find_land' | 'find_resource';

export interface Contract {
  id: number;
  patron: 'Crown' | 'Admiralty';
  kind: ContractKind;
  title: string;
  description: string;
  tier: number;
  advance: number;
  bonus: number;
  /** Voyage must end at home within this many days. */
  deadline: number;
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
  objectiveDone: boolean;
  leftHome: boolean;
  /** Estimated days to sail home over charted water, and the route. */
  homeDays: number;
  homeRoute: { x: number; y: number }[];
  /** Days since the last stop for a decision; drives the pacing filler. */
  quietDays: number;
  /** Sub-day progress, 0..STEPS_PER_DAY-1. */
  step: number;
}

export interface VoyageReport {
  days: number;
  newCells: number;
  landmasses: number[];
  sites: number[];
  contract: Contract | null;
  contractResult: 'done' | 'late' | 'failed' | null;
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
  outcome: 'won' | 'lost' | null;
  paused: boolean;
  /** Why the voyage is paused, shown in the HUD. */
  alert: string | null;
  pending: Interrupt[];
  /** Contract accepted in port for the next voyage. */
  accepted: Contract | null;
  /** The last voyage's report, for the arrival screen. */
  report: VoyageReport | null;
  /** News that happened while at sea, told on return. */
  news: string[];
  log: LogEntry[];
  stats: { cellsCharted: number; landmassesNamed: number; earned: number; treasure: number };
}
