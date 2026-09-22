import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/game/config';
import { isSecret, unitPrice } from '../src/game/core';
import {
  acceptContract,
  arrive,
  buyProvisions,
  canSail,
  payDebt,
  processSeason,
  sellCargo,
  sellChartItem,
  setSail,
  settle,
} from '../src/game/economy';
import { deserialize, newGame, serialize } from '../src/game/state';

function atSea(seed = 'econ') {
  const s = newGame(seed);
  buyProvisions(s, 200);
  setSail(s);
  return s;
}

describe('economy', () => {
  it('starts in port, able to sail', () => {
    const s = newGame('start');
    expect(s.mode).toBe('port');
    expect(s.contracts.length).toBeGreaterThan(0);
    expect(canSail(s)).toBeNull();
  });

  it('a freelance voyage fills the chart case with what was found', () => {
    const s = atSea();
    const site = s.world.sites[0];
    site.surveyed = true;
    site.knownBy = 1;
    s.voyage!.sitesFound.push(site.id);
    s.voyage!.landmassesFound.push(site.landmass);
    s.voyage!.newCells = 300;
    s.voyage!.days = 20;
    arrive(s);
    expect(s.mode).toBe('port');
    expect(s.chartCase.map((c) => c.kind).sort()).toEqual(['area', 'landmass', 'site']);
    expect(isSecret(site)).toBe(true);
  });

  it('selling a site pays now and cuts the cargo price', () => {
    const s = newGame('sell');
    const site = s.world.sites[0];
    site.surveyed = true;
    site.knownBy = 1;
    s.chartCase.push({ id: 99, kind: 'site', label: 'x', value: 100, ref: site.id });
    const secretPrice = unitPrice(site);
    const cash = s.cash;
    sellChartItem(s, 99);
    expect(s.cash).toBe(cash + 100);
    expect(site.knownBy).toBe(CONFIG.publicKnownBy);
    expect(unitPrice(site)).toBeLessThan(secretPrice * 0.6);
  });

  it('public routes get more crowded each season; secrets may leak', () => {
    const s = newGame('seasons');
    const [pub, secret] = s.world.sites;
    pub.surveyed = true;
    pub.knownBy = CONFIG.publicKnownBy;
    secret.surveyed = true;
    secret.knownBy = 1;
    let leaked = false;
    for (let i = 0; i < 40; i++) {
      processSeason(s);
      if (secret.knownBy > 1) leaked = true;
    }
    expect(pub.knownBy).toBe(CONFIG.knownByMax);
    expect(leaked).toBe(true);
    expect(s.news.length).toBeGreaterThan(0);
  });

  it('seasons put debt payments due, collected on return', () => {
    const s = atSea('debt');
    processSeason(s);
    expect(s.paymentsDue).toBe(CONFIG.paymentPerSeason);
    s.cash = 1000;
    arrive(s);
    settle(s);
    expect(s.paymentsDue).toBe(0);
    expect(s.debt).toBe(CONFIG.debt - CONFIG.paymentPerSeason);
  });

  it('forces a sale of cargo to cover the debt, and seizes the ship if even that fails', () => {
    const s = atSea('broke');
    processSeason(s);
    s.cash = 0;
    s.ship.cargo = [];
    arrive(s);
    settle(s);
    expect(s.mode).toBe('over');
    expect(s.outcome).toBe('lost');

    const t = atSea('cargo');
    processSeason(t);
    t.cash = 0;
    const site = t.world.sites.find((x) => x.type === 'pearls' || x.type === 'spice')!;
    site.knownBy = 1;
    t.ship.cargo = [{ siteId: site.id, type: site.type, qty: 40 }];
    arrive(t);
    settle(t);
    expect(t.mode).toBe('port');
    expect(t.ship.cargo.length).toBe(0);
  });

  it('paying the debt off wins', () => {
    const s = newGame('win');
    s.cash = CONFIG.debt + 10;
    payDebt(s, CONFIG.debt);
    expect(s.outcome).toBe('won');
  });

  it('contracts pay an advance and a bonus on completion', () => {
    const s = newGame('contract');
    const c = s.contracts[0];
    const cash = s.cash;
    acceptContract(s, c.id);
    expect(s.cash).toBe(cash + c.advance);
    buyProvisions(s, 200);
    setSail(s);
    s.voyage!.objectiveDone = true;
    s.voyage!.days = 5;
    const before = s.cash;
    arrive(s);
    expect(s.reputation).toBe(1);
    expect(s.cash).toBeGreaterThan(before);
    expect(s.chartCase.length).toBe(0); // The patron owns the chart.
  });

  it('cargo sells at the site price', () => {
    const s = newGame('cargo');
    const site = s.world.sites[0];
    site.knownBy = 1;
    s.ship.cargo = [{ siteId: site.id, type: site.type, qty: 10 }];
    const cash = s.cash;
    sellCargo(s);
    expect(s.cash).toBe(cash + Math.round(10 * unitPrice(site)));
  });

  it('round-trips through a save', () => {
    const s = atSea('save');
    const t = deserialize(serialize(s))!;
    expect(t.known).toBeInstanceOf(Uint8Array);
    expect(Array.from(t.known)).toEqual(Array.from(s.known));
    expect(t.world.landmassOf).toBeInstanceOf(Int16Array);
    expect(t.voyage?.startProvisions).toBe(s.voyage?.startProvisions);
  });
});
