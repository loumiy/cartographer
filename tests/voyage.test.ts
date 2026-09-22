import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/game/config';
import { buyProvisions, sellCargo, sellChartItem, setSail, settle } from '../src/game/economy';
import { addWaypoint, courseHome, resolve } from '../src/game/sea';
import { newGame } from '../src/game/state';
import type { GameState } from '../src/game/types';
import { answerAll, runUntilStop } from './helpers';

function sail(seed: string): GameState {
  const s = newGame(seed);
  buyProvisions(s, 300);
  setSail(s);
  return s;
}

describe('voyage', () => {
  it('sails toward a waypoint, charting as it goes and eating stores', () => {
    const s = sail('east');
    const known0 = s.known.reduce((a, b) => a + b, 0);
    const prov0 = s.ship.provisions;
    addWaypoint(s, s.ship.x + 10, s.ship.y);
    let guard = 0;
    while (s.voyage!.waypoints.length && guard++ < 100) {
      runUntilStop(s);
      answerAll(s, ['sail', 'ride', 'rest', 'wait', 'leave', 'ok']);
    }
    expect(s.ship.x).toBeGreaterThan(s.world.dock.x + 5);
    expect(s.known.reduce((a, b) => a + b, 0)).toBeGreaterThan(known0);
    expect(s.ship.provisions).toBeLessThan(prov0);
    expect(s.day).toBeGreaterThan(0);
  });

  it('turning for home brings the ship back to port', () => {
    const s = sail('home');
    addWaypoint(s, s.ship.x + 12, s.ship.y);
    for (let i = 0; i < 60 && s.voyage?.waypoints.length; i++) {
      runUntilStop(s);
      answerAll(s, ['sail', 'ride', 'rest', 'wait', 'leave', 'ok']);
    }
    for (let i = 0; i < 100 && s.mode === 'sea'; i++) {
      courseHome(s);
      runUntilStop(s);
      answerAll(s, ['sail', 'ride', 'rest', 'wait', 'leave', 'ok']);
    }
    expect(s.mode).toBe('port');
    expect(s.pending[0]?.kind).toBe('arrival');
  });

  it('refuses a waypoint on charted land', () => {
    const s = sail('land');
    addWaypoint(s, 0, s.ship.y);
    expect(s.voyage!.waypoints.length).toBe(0);
  });

  it('empty stores kill the crew until the ship is lost', () => {
    const s = sail('starve');
    s.ship.provisions = 0;
    for (let i = 0; i < 500 && s.mode === 'sea'; i++) {
      if (!s.voyage!.waypoints.length) addWaypoint(s, 20 + (i % 3) * 5, 20 + ((i * 17) % 50));
      runUntilStop(s);
      answerAll(s, ['wait', 'rest', 'ride', 'ok', 'sail', 'leave']);
    }
    expect(s.mode).toBe('over');
    expect(s.outcome).toBe('lost');
  });

  it('pauses and lets the player make landfall on new land', () => {
    // Sail around until land is sighted, then take the landfall choice.
    for (const seed of ['l1', 'l2', 'l3', 'l4', 'l5']) {
      const s = sail(seed);
      addWaypoint(s, 60, s.ship.y);
      for (let i = 0; i < 200 && s.mode === 'sea'; i++) {
        runUntilStop(s);
        const p = s.pending[0];
        if (p?.kind === 'land_ho') {
          resolve(s, 'landfall');
          continue;
        }
        if (p?.kind === 'landfall') {
          resolve(s, 'survey');
          expect(s.pending[0]?.kind).toBe('landfall');
          expect(s.voyage!.landfall!.surveyed).toBe(true);
          return;
        }
        answerAll(s, ['sail', 'ride', 'rest', 'wait', 'ok']);
        if (!s.voyage?.waypoints.length && !s.pending.length) addWaypoint(s, 60 + i, (s.ship.y + 7 * i) % 80);
      }
    }
    throw new Error('never made landfall');
  });
});

describe('full run by a simple bot', () => {
  it('plays many voyages without breaking invariants', () => {
    for (const seed of ['bot-1', 'bot-2', 'bot-3']) {
      const s = newGame(seed);
      for (let voyage = 0; voyage < 8 && s.mode !== 'over'; voyage++) {
        buyProvisions(s, 600);
        if (s.ship.crew < CONFIG.crewMin) s.ship.crew = CONFIG.crewMin;
        setSail(s);
        if (s.mode !== 'sea') break;
        const target = { x: 30 + voyage * 8, y: 10 + ((voyage * 23) % 60) };
        addWaypoint(s, target.x, target.y);
        let turned = false;
        for (let i = 0; i < 400 && s.mode === 'sea'; i++) {
          runUntilStop(s);
          answerAll(s, ['landfall', 'shore', 'survey', 'ride', 'rest', 'wait', 'salvage', 'ok']);
          // Landfall loop: shore, survey, load, leave.
          while (s.pending[0]?.kind === 'landfall') {
            const load = s.pending[0].choices.find((c) => c.id.startsWith('load:') && !c.disabled);
            const shore = s.pending[0].choices.find((c) => c.id === 'shore' && !c.disabled);
            const survey = s.pending[0].choices.find((c) => c.id === 'survey' && !c.disabled);
            resolve(s, (shore ?? survey ?? load)?.id ?? 'leave');
          }
          if (s.mode !== 'sea') break;
          const v = s.voyage!;
          if (!turned && (v.pointOfNoReturnWarned || !v.waypoints.length)) {
            turned = true;
          }
          if (turned) courseHome(s);
          expect(s.ship.provisions).toBeGreaterThanOrEqual(0);
          expect(s.ship.hull).toBeGreaterThanOrEqual(0);
        }
        if (s.pending[0]?.kind === 'arrival') {
          settle(s);
          sellCargo(s);
          // Sell the survey work, keep the secret routes.
          for (const item of s.chartCase.slice()) if (item.kind !== 'site') sellChartItem(s, item.id);
        }
      }
      expect(['port', 'sea', 'over']).toContain(s.mode);
      expect(s.stats.cellsCharted).toBeGreaterThan(80);
      expect(s.voyagesSailed).toBeGreaterThan(1);
    }
  });
});
