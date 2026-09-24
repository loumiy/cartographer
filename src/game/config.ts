import type { ResourceType } from './types';

/** All tuning numbers in one place. */
export const CONFIG = {
  /** One sea: the V1 map. The world is a 2 × 2 grid of seas. */
  seaWidth: 120,
  seaHeight: 84,
  width: 240,
  height: 168,

  stepsPerDay: 8,
  /** Cells per day in open water. */
  speedOpen: 3,
  /** Cells per day within COAST_RANGE of charted land: slower, but safer. */
  speedCoast: 2,
  coastRange: 2,
  baseSight: 4,

  season: 60,
  seasonNames: ['Spring', 'Summer', 'Autumn', 'Winter'],
  startYear: 1612,

  startCash: 200,
  debt: 2500,
  paymentPerSeason: 200,

  crewMin: 6,
  crewStart: 12,
  crewLostBelow: 3,
  wageAdvance: 3,
  wagePerDay: 0.1,

  provisionCost: 0.1,
  /**
   * Enlarged-stores refits, crew-days added per level. Fully refitted, a pinnace carries 1,100
   * crew-days: 92 days at 12 crew, half again what perfect island hopping needs to reach the
   * farthest corner of the first sea on any seed tested (tests/range.test.ts).
   */
  storesLevels: [150, 200, 250],
  shortRations: 0.6,

  /**
   * A shore party brings back crew × (7–13 days) × the land's forage quality × its size factor,
   * in crew-days. Land that has been foraged recovers over a season.
   */
  forageBySize: { islet: 0.6, island: 1, 'large island': 1.3, coast: 1.5 } as Record<string, number>,

  /** Enlarged-hold refits, cargo units added per level. */
  holdLevels: [8, 8, 8],

  /** Hulls. A brig carries more and takes storm and reef damage less hard. */
  ships: {
    pinnace: { label: 'Pinnace', stores: 500, hold: 16, crewMax: 20, toughness: 1, cost: 700 },
    brig: { label: 'Brig', stores: 800, hold: 32, crewMax: 30, toughness: 0.7, cost: 1600 },
  },

  post: {
    cost: 400,
    timber: 15,
    /** A resupply run: timber and stores landed at the post. */
    supplyTimber: 5,
    supplyStores: 50,
    /** Seasons since last supplied: full output below the first, half below the second, abandoned at the third. */
    fullFor: 3,
    halfFor: 5,
    abandonAt: 6,
    /** Warehouse holds this many seasons of output. */
    warehouseSeasons: 3,
    /** Stores and repairs at a post cost this much more than in port. */
    markup: 1.5,
  },

  route: {
    /** Wages and victuals for a route ship, per season. */
    costs: 40,
    /** Per post on the route: the route ship keeps it supplied. */
    postUpkeep: 30,
    /** The route ship's master takes this share of the takings. */
    masterShare: 0.25,
    /** A route between two ports with no posts earns on trade alone. */
    portTrade: 60,
    baseRisk: 0.02,
    hazardRisk: 0.004,
    damageChance: 0.12,
  },

  charterReward: 500,

  supplyCost: 6,
  suppliesMax: 10,
  patchAmount: 8,
  repairCostPerPoint: 2,
  portFee: 10,

  chartRatePerCell: 0.5,
  landmassValue: { islet: 30, island: 70, 'large island': 120, coast: 180 } as Record<string, number>,
  /** Site sale value as a share of one full hold of its cargo at the secret price. */
  siteSaleShare: 0.7,
  /** knownBy after a sale or a lost secret. */
  publicKnownBy: 4,
  knownByMax: 10,

  resources: {
    timber: { price: 7, stock: 20, label: 'Timber' },
    furs: { price: 14, stock: 14, label: 'Furs' },
    spice: { price: 28, stock: 10, label: 'Spice' },
    pearls: { price: 46, stock: 7, label: 'Pearls' },
  } as Record<ResourceType, { price: number; stock: number; label: string }>,

  /** Market price multipliers: each port pays well for what grows far from it. */
  portPrices: [
    { timber: 0.8, furs: 1.2, spice: 1.3, pearls: 1.0 },
    { timber: 1.3, furs: 0.9, spice: 0.8, pearls: 1.1 },
  ] as Record<ResourceType, number>[],
  /** Chart prices once both ports are known: waters near the other port pay more. */
  chartFarBonus: 1.25,
  chartNearFactor: 0.85,

  upgrades: {
    spyglass: [180, 400, 800],
    barometer: 250,
    surveyKit: 300,
    stores: [150, 350, 700],
    hold: [200, 400, 700],
    /** Refit costs for a brig's larger hull. */
    brigFactor: 1.5,
  },
} as const;

export const RESOURCE_TYPES: ResourceType[] = ['timber', 'furs', 'spice', 'pearls'];
