import type { ResourceType } from './types';

/** All tuning numbers in one place. */
export const CONFIG = {
  width: 120,
  height: 84,

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
  crewMax: 20,
  crewStart: 12,
  crewLostBelow: 3,
  wageAdvance: 3,
  wagePerDay: 0.1,

  provisionCost: 0.1,
  provisionCapBase: 500,
  provisionCapPerLevel: 200,
  shortRations: 0.6,

  cargoCapBase: 16,
  cargoCapPerLevel: 8,

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

  upgrades: {
    spyglass: [180, 400, 800],
    barometer: 250,
    surveyKit: 300,
    stores: [200, 400],
    hold: [250, 500],
  },
} as const;

export const RESOURCE_TYPES: ResourceType[] = ['timber', 'furs', 'spice', 'pearls'];
