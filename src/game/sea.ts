import { CONFIG } from './config';
import {
  adjacentLandmass,
  alert,
  cargoCap,
  cargoUsed,
  compass,
  dailyRations,
  daysOfStores,
  distToDock,
  isKnown,
  knownLandNear,
  landmassLabel,
  log,
  money,
  provisionCap,
  raise,
  sightRadius,
  speed,
  updateHomeEstimate,
  withRng,
} from './core';
import { arrive, processSeason } from './economy';
import { findPath, simplifyPath } from './pathfind';
import { Cell, type Choice, type GameState, type Interrupt } from './types';
import { cellAt, idx, inBounds, remoteness } from './world';

type Pt = { x: number; y: number };

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/** Advance the voyage by one sub-day step. The UI calls this at a rate set by the time speed. */
export function stepSea(state: GameState) {
  const v = state.voyage;
  if (state.mode !== 'sea' || !v || state.paused || state.pending.length) return;

  const held = v.restDays > 0 || v.becalmedDays > 0;
  if (!held) {
    // Time only runs while under way: with no course, wait for orders.
    if (!v.waypoints.length) {
      alert(state, 'Awaiting orders. Click the chart to plot a course.');
      return;
    }
    moveShip(state, speed(state) / CONFIG.stepsPerDay);
    if (state.mode !== 'sea') return;
    if (!v.waypoints.length && !state.pending.length && !state.paused) {
      alert(state, 'Course complete. Awaiting orders.');
    }
  }

  v.step++;
  if (v.step >= CONFIG.stepsPerDay) {
    v.step = 0;
    endDay(state, false);
  }
}

/** Pass whole days without movement (resting, salvaging, going ashore). */
export function passDays(state: GameState, n: number) {
  for (let i = 0; i < n && state.mode === 'sea'; i++) endDay(state, true);
}

function endDay(state: GameState, quiet: boolean) {
  const v = state.voyage!;
  const ship = state.ship;
  state.day++;
  v.days++;
  v.quietDays++;
  if (v.restDays > 0) v.restDays--;
  if (v.becalmedDays > 0) v.becalmedDays--;
  if (v.slowDays > 0) v.slowDays--;
  if (v.sign && v.sign.until < state.day) v.sign = null;

  // Provisions: the voyage clock.
  ship.provisions -= dailyRations(state);
  if (ship.provisions < 0) {
    ship.provisions = 0;
    const lost = withRng(state, (rng) => Math.max(1, Math.round(ship.crew * rng.range(0.05, 0.12))));
    ship.crew -= lost;
    alert(state, `The stores are empty. ${lost} of the crew died of hunger and thirst.`, 'bad');
  }

  if (state.day % CONFIG.season === 0) processSeason(state);
  if (checkLost(state)) return;

  updateHomeEstimate(state);
  checkProvisionAlerts(state);
  if (!quiet && !state.pending.length) rollEvents(state);
}

function checkProvisionAlerts(state: GameState) {
  const v = state.voyage!;
  const share = state.ship.provisions / Math.max(1, v.startProvisions);
  for (const t of [0.5, 0.25]) {
    if (share <= t && !v.provisionAlerts.includes(t)) {
      v.provisionAlerts.push(t);
      alert(state, `Stores are down to ${Math.round(t * 100)}%: ${Math.floor(daysOfStores(state))} days left.`, 'bad');
    }
  }
  const left = daysOfStores(state);
  if (!v.pointOfNoReturnWarned && v.leftHome && left <= v.homeDays + 3) {
    v.pointOfNoReturnWarned = true;
    alert(
      state,
      `Point of no return: ${Math.floor(left)} days of stores, and home lies ${v.homeDays} days away. Turn back or find a place to forage.`,
      'bad',
    );
  } else if (v.pointOfNoReturnWarned && left > v.homeDays + 8) {
    v.pointOfNoReturnWarned = false;
  }
}

function checkLost(state: GameState): boolean {
  const ship = state.ship;
  if (ship.hull > 0 && ship.crew >= CONFIG.crewLostBelow) return false;
  const why =
    ship.hull <= 0
      ? 'The hull gives way and the sea takes her. Your ship is lost with all her charts.'
      : 'Too few hands remain to work the ship. She drifts until she is found, empty, by strangers.';
  gameOver(state, 'lost', 'Lost at sea', why);
  return true;
}

export function gameOver(state: GameState, outcome: 'lost', title: string, body: string) {
  if (state.mode === 'over') return;
  state.mode = 'over';
  state.outcome = outcome;
  state.pending = [{ kind: 'gameover', title, body, choices: [{ id: 'new', label: 'Begin a new game' }] }];
  log(state, `${title}. ${body}`, 'bad');
}

// ---------------------------------------------------------------------------
// Movement and charting
// ---------------------------------------------------------------------------

function moveShip(state: GameState, dist: number) {
  const v = state.voyage!;
  const ship = state.ship;
  const world = state.world;
  while (dist > 1e-9 && v.waypoints.length) {
    const wp = v.waypoints[0];
    const dx = wp.x - ship.x;
    const dy = wp.y - ship.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) {
      v.waypoints.shift();
      continue;
    }
    const mv = Math.min(dist, d, 0.5);
    const nx = ship.x + (dx / d) * mv;
    const ny = ship.y + (dy / d) * mv;
    const fromCell = [Math.floor(ship.x), Math.floor(ship.y)];
    const cx = Math.floor(nx);
    const cy = Math.floor(ny);
    const cell = cellAt(world, cx, cy);
    if (cell === Cell.Land) {
      v.waypoints = [];
      reveal(state);
      alert(state, 'Breakers ahead: land blocks the course. Plot a new heading.');
      return;
    }
    ship.x = nx;
    ship.y = ny;
    dist -= mv;
    if (mv >= d - 1e-9) v.waypoints.shift();

    if (cell === Cell.Reef && (cx !== fromCell[0] || cy !== fromCell[1])) {
      const dmg = withRng(state, (rng) => rng.int(8, 18));
      ship.hull = Math.max(0, ship.hull - dmg);
      alert(state, `We scraped over a reef! The hull takes ${dmg} damage.`, 'bad');
      if (checkLost(state)) return;
    }

    const last = v.track[v.track.length - 1];
    if (!last || Math.hypot(last.x - ship.x, last.y - ship.y) >= 0.75) v.track.push({ x: ship.x, y: ship.y });
    if (!v.leftHome && distToDock(state) > 3) v.leftHome = true;
    reveal(state);
    if (v.leftHome && distToDock(state) < 1) {
      arrive(state);
      return;
    }
    if (v.landfallTarget >= 0 && adjacentLandmass(state, v.landfallTarget) === v.landfallTarget) {
      const lm = v.landfallTarget;
      v.landfallTarget = -1;
      v.waypoints = [];
      openLandfall(state, lm);
      return;
    }
    if (state.pending.length || state.paused) return;
  }
}

/** Clear fog around the ship and react to whatever comes into view. */
export function reveal(state: GameState) {
  const { world, ship, known } = state;
  const v = state.voyage;
  const r = sightRadius(state);
  const cx = ship.x;
  const cy = ship.y;
  const newLand: number[] = [];
  let reefAhead = false;
  const heading = v?.waypoints[0];

  for (let y = Math.floor(cy - r); y <= Math.floor(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.floor(cx + r); x++) {
      if (!inBounds(world, x, y)) continue;
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > r + 0.25) continue;
      const i = idx(world, x, y);
      if (known[i]) continue;
      known[i] = 1;
      state.stats.cellsCharted++;
      if (v) v.newCells++;
      const cell = world.cells[i];
      if (cell === Cell.Land) {
        const lm = world.landmasses[world.landmassOf[i]];
        if (!lm.discovered) {
          lm.discovered = true;
          newLand.push(lm.id);
        }
      } else if (cell === Cell.Reef && heading) {
        // Warn only for reefs roughly along the course.
        const hx = heading.x - cx;
        const hy = heading.y - cy;
        const rx = x + 0.5 - cx;
        const ry = y + 0.5 - cy;
        const along = (hx * rx + hy * ry) / Math.max(1e-6, Math.hypot(hx, hy));
        const across = Math.abs(hx * ry - hy * rx) / Math.max(1e-6, Math.hypot(hx, hy));
        if (along > 0 && across < 1.5) reefAhead = true;
      }
    }
  }

  if (!v) return;

  for (const lmId of newLand) {
    v.landmassesFound.push(lmId);
    const lm = world.landmasses[lmId];
    log(state, `Land ho! A new ${lm.kind} to the ${compass(lm.cx - cx, lm.cy - cy)}.`, 'good');
    if (v.contract?.kind === 'find_land' && !v.objectiveDone && v.days <= (v.contract.withinDays ?? 0)) {
      v.objectiveDone = true;
      log(state, 'Contract objective reached: new land found. Return home to claim the bonus.', 'good');
    }
  }
  if (newLand.length) {
    const lm = world.landmasses[newLand[0]];
    raise(state, {
      kind: 'land_ho',
      title: 'Land ho!',
      body: `The lookout sights ${newLand.length > 1 ? 'new land in several places' : `a ${lm.kind}`} to the ${compass(
        lm.cx - cx,
        lm.cy - cy,
      )}. Nobody at home has charted it.`,
      choices: [
        { id: 'landfall', label: 'Make for the coast', hint: 'Sail in and make landfall', tone: 'safe' },
        { id: 'sail', label: 'Hold course', hint: 'Chart it from the sea and sail on' },
      ],
      data: { landmass: lm.id },
    });
  }

  for (let w = 0; w < world.wrecks.length; w++) {
    const wreck = world.wrecks[w];
    if (wreck.sighted || !known[idx(world, wreck.x, wreck.y)]) continue;
    wreck.sighted = true;
    raise(state, {
      kind: 'wreck',
      title: 'Wreck sighted',
      body: 'A hulk lies half-sunk off the bow, her masts gone. There may be something aboard worth the risk.',
      choices: [
        { id: 'salvage', label: 'Send a boat to salvage', hint: '1 day; may find coin or supplies, may lose men', tone: 'risk' },
        { id: 'leave', label: 'Leave her to the sea' },
      ],
      data: { wreck: w },
    });
  }

  if (reefAhead && !state.pending.length) alert(state, 'Reef sighted across our course. Steer around it or risk the hull.', 'bad');
  checkRegionObjective(state);
}

function checkRegionObjective(state: GameState) {
  const v = state.voyage!;
  const c = v.contract;
  if (!c || c.kind !== 'chart_region' || v.objectiveDone || !c.target) return;
  if (regionShare(state, c.target) >= c.target.share) {
    v.objectiveDone = true;
    alert(state, 'Contract objective reached: the region is charted. Return home to claim the bonus.', 'good');
  }
}

export function regionShare(state: GameState, t: { x: number; y: number; r: number }): number {
  let total = 0;
  let seen = 0;
  for (let y = t.y - t.r; y <= t.y + t.r; y++) {
    for (let x = t.x - t.r; x <= t.x + t.r; x++) {
      if (!inBounds(state.world, x, y) || Math.hypot(x - t.x, y - t.y) > t.r) continue;
      total++;
      if (isKnown(state, x, y)) seen++;
    }
  }
  return total ? seen / total : 1;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function rollEvents(state: GameState) {
  const v = state.voyage!;
  const ship = state.ship;
  const rem = remoteness(state.world, ship.x);
  const coastal = knownLandNear(state, ship.x, ship.y, CONFIG.coastRange);

  if (v.stormTomorrow) {
    v.stormTomorrow = false;
    raiseStorm(state, true);
    return;
  }

  const roll = withRng(state, (rng) => rng.next());
  let p = 0;
  const stormP = (0.02 + 0.035 * rem) * (coastal ? 0.6 : 1);
  const sickP = 0.004 + (ship.rations === 'short' ? 0.03 : 0) + 0.0006 * v.days + (ship.provisions <= 0 ? 0.08 : 0);
  const calmP = v.becalmedDays > 0 ? 0 : coastal ? 0.006 : 0.02;
  const spoilP = ship.provisions > 0 ? 0.01 : 0;

  if (roll < (p += stormP)) {
    if (state.upgrades.barometer) {
      v.stormTomorrow = true;
      alert(state, 'The barometer is falling fast: a storm will break tomorrow. Make for shelter, or brace for it.', 'bad');
    } else {
      raiseStorm(state, false);
    }
    return;
  }
  if (roll < (p += sickP)) {
    raise(state, {
      kind: 'sickness',
      title: 'Sickness aboard',
      body:
        ship.rations === 'short'
          ? 'Short rations have told on the crew: fever runs through the forecastle.'
          : 'Fever runs through the forecastle. Men lie groaning in their hammocks.',
      choices: [
        { id: 'rest', label: 'Heave to and rest the crew', hint: '2 days lost; at most 1 death', tone: 'safe' },
        { id: 'press', label: 'Press on', hint: '1–3 deaths; slower for 4 days', tone: 'risk' },
      ],
    });
    return;
  }
  if (roll < (p += calmP)) {
    raise(state, {
      kind: 'becalmed',
      title: 'Becalmed',
      body: 'The wind has died. The sails hang slack and the sea lies flat as glass.',
      choices: [
        { id: 'wait', label: 'Wait for wind', hint: '2–4 days without progress', tone: 'safe' },
        { id: 'tow', label: 'Tow with the boats', hint: '1 day lost, slow for 3; 1 in 5 chance of a death', tone: 'risk' },
      ],
    });
    return;
  }
  if (roll < (p += spoilP)) {
    const share = withRng(state, (rng) => rng.range(0.1, 0.25));
    const lost = Math.round(ship.provisions * share);
    ship.provisions -= lost;
    raise(state, {
      kind: 'spoiled',
      title: 'Spoiled stores',
      body: `Seawater has got into the bread room. ${Math.round(share * 100)}% of the stores are ruined: ${Math.floor(
        lost / Math.max(1, dailyRations(state)),
      )} days’ worth.`,
      choices: [{ id: 'ok', label: 'Curse our luck' }],
    });
    return;
  }

  maybeSignOfLand(state);
}

const SIGNS = [
  'Seabirds wheel overhead and fly off',
  'Driftwood and torn branches float by, carried from',
  'Mats of floating weed drift from',
  'A bank of cloud sits unmoving on the horizon to the',
  'The water turns green and cloudy toward the',
];

/** Signs of land at the edge of vision point toward undiscovered coasts, and fill quiet stretches. */
function maybeSignOfLand(state: GameState) {
  const v = state.voyage!;
  const ship = state.ship;
  if (state.day - v.lastSignDay < 3) return;
  const p = v.quietDays >= 5 ? 0.7 : 0.12;
  if (!withRng(state, (rng) => rng.chance(p))) return;
  const r = sightRadius(state);
  const reach = r + 9;
  const { world } = state;
  let best: Pt | null = null;
  let bestD = Infinity;
  for (let y = Math.floor(ship.y - reach); y <= ship.y + reach; y++) {
    for (let x = Math.floor(ship.x - reach); x <= ship.x + reach; x++) {
      if (!inBounds(world, x, y) || cellAt(world, x, y) !== Cell.Land) continue;
      const lm = world.landmasses[world.landmassOf[idx(world, x, y)]];
      if (lm.discovered) continue;
      const d = Math.hypot(x + 0.5 - ship.x, y + 0.5 - ship.y);
      if (d > r && d <= reach && d < bestD) {
        bestD = d;
        best = { x: x + 0.5, y: y + 0.5 };
      }
    }
  }
  if (!best) return;
  const dir = compass(best.x - ship.x, best.y - ship.y);
  const text = withRng(state, (rng) => rng.pick(SIGNS));
  v.lastSignDay = state.day;
  v.sign = { x: best.x, y: best.y, dir, until: state.day + 4 };
  const toThe = text.endsWith('the') ? ` ${dir}` : text.endsWith('from') ? ` the ${dir}` : ` to the ${dir}`;
  alert(state, `${text}${toThe}. Land may lie that way.`, 'info');
}

function shelterWithin(state: GameState, r: number): Pt[] | null {
  const { world, ship } = state;
  let best: Pt[] | null = null;
  let bestLen = Infinity;
  for (let y = Math.floor(ship.y - r); y <= ship.y + r; y++) {
    for (let x = Math.floor(ship.x - r); x <= ship.x + r; x++) {
      if (!isKnown(state, x, y) || cellAt(world, x, y) !== Cell.Sea) continue;
      if (!knownLandNear(state, x + 0.5, y + 0.5, 1)) continue;
      const d = Math.hypot(x + 0.5 - ship.x, y + 0.5 - ship.y);
      if (d > r || d >= bestLen) continue;
      const path = findPath(world, { known: state.known }, ship, { x: x + 0.5, y: y + 0.5 });
      if (path && path.length <= r * 1.5) {
        best = path;
        bestLen = d;
      }
    }
  }
  return best;
}

function raiseStorm(state: GameState, warned: boolean) {
  const shelterRange = warned ? 10 : 6;
  const shelter = shelterWithin(state, shelterRange);
  const choices: Choice[] = [
    { id: 'run', label: 'Run before the wind', hint: 'Hull −0 to 6; blown 3–7 leagues off course' },
    { id: 'ride', label: 'Ride it out', hint: warned ? 'Hull −7 to 17; lose 1 day' : 'Hull −12 to 28; lose 1 day', tone: 'risk' },
    {
      id: 'shelter',
      label: 'Make for shelter',
      hint: shelter ? 'Hull −0 to 4; 1–3 days lost' : `No charted land within ${shelterRange} leagues`,
      tone: 'safe',
      disabled: !shelter,
    },
  ];
  raise(state, {
    kind: 'storm',
    title: 'Storm!',
    body: warned
      ? 'As the glass foretold, the storm breaks. At least the hatches are battened.'
      : 'Black cloud races up from the horizon. Within the hour the sea is white and the rigging screams.',
    choices,
    data: { warned: warned ? 1 : 0 },
  });
}

// ---------------------------------------------------------------------------
// Resolving decisions
// ---------------------------------------------------------------------------

/** Apply the player's choice for the decision at the front of the queue. */
export function resolve(state: GameState, choiceId: string) {
  const it = state.pending[0];
  if (!it) return;
  const choice = it.choices.find((c) => c.id === choiceId);
  if (!choice || choice.disabled) return;
  state.pending.shift();
  const v = state.voyage;
  const ship = state.ship;

  switch (it.kind) {
    case 'land_ho':
      if (choiceId === 'landfall') setCourseToLandmass(state, it.data!.landmass);
      break;

    case 'storm': {
      const warned = it.data?.warned === 1;
      if (choiceId === 'run') {
        runBeforeStorm(state);
      } else if (choiceId === 'ride') {
        const dmg = withRng(state, (rng) => Math.round(rng.int(12, 28) * (warned ? 0.6 : 1) * (0.8 + 0.4 * remoteness(state.world, ship.x))));
        ship.hull = Math.max(0, ship.hull - dmg);
        log(state, `We rode out the storm. The hull took ${dmg} damage.`, 'bad');
        passDays(state, 1);
      } else if (choiceId === 'shelter') {
        const path = shelterWithin(state, warned ? 10 : 6);
        if (path) {
          // An empty path means we already lie in the lee of the land.
          const last = path[path.length - 1] ?? ship;
          ship.x = last.x;
          ship.y = last.y;
          const dmg = withRng(state, (rng) => rng.int(0, 4));
          ship.hull = Math.max(0, ship.hull - dmg);
          log(state, `We ran for the lee of the land and sheltered there.${dmg ? ` Minor damage: ${dmg}.` : ''}`, 'info');
          reveal(state);
          passDays(state, Math.max(1, Math.ceil(path.length / CONFIG.speedCoast)));
        }
      }
      checkLost(state);
      break;
    }

    case 'sickness': {
      if (choiceId === 'rest') {
        const dead = withRng(state, (rng) => rng.int(0, 1));
        ship.crew -= dead;
        log(state, dead ? 'We rested the crew. One man died of the fever.' : 'We rested the crew. All pulled through.', dead ? 'bad' : 'info');
        passDays(state, 2);
      } else {
        const dead = withRng(state, (rng) => rng.int(1, 3));
        ship.crew -= dead;
        if (v) v.slowDays = Math.max(v.slowDays, 4);
        log(state, `We pressed on. ${dead} of the crew died, and the rest work slowly.`, 'bad');
      }
      checkLost(state);
      break;
    }

    case 'becalmed':
      if (v) {
        if (choiceId === 'wait') {
          v.becalmedDays = withRng(state, (rng) => rng.int(2, 4));
          log(state, `Becalmed for ${v.becalmedDays} days.`, 'info');
        } else {
          v.becalmedDays = 1;
          v.slowDays = Math.max(v.slowDays, 3);
          const hurt = withRng(state, (rng) => rng.chance(0.2));
          if (hurt) ship.crew -= 1;
          log(state, hurt ? 'We towed with the boats. One man collapsed at the oars and did not recover.' : 'We towed with the boats until the wind returned.', hurt ? 'bad' : 'info');
          checkLost(state);
        }
      }
      break;

    case 'wreck':
      if (choiceId === 'salvage') salvage(state, it.data!.wreck);
      break;

    case 'landfall':
      landfallAction(state, choiceId);
      break;

    default:
      break;
  }

  if (state.mode === 'sea' && !state.pending.length && !state.alert) state.paused = false;
}

function runBeforeStorm(state: GameState) {
  const ship = state.ship;
  const v = state.voyage!;
  const { dx, dy, n } = withRng(state, (rng) => {
    const a = rng.range(0, Math.PI * 2);
    return { dx: Math.cos(a), dy: Math.sin(a), n: rng.int(3, 7) };
  });
  let dmg = withRng(state, (rng) => rng.int(0, 6));
  for (let i = 0; i < n * 2; i++) {
    const nx = ship.x + dx * 0.5;
    const ny = ship.y + dy * 0.5;
    const cell = cellAt(state.world, Math.floor(nx), Math.floor(ny));
    if (cell === Cell.Land) {
      dmg += withRng(state, (rng) => rng.int(10, 20));
      log(state, 'Driven onto a lee shore, we struck ground before clawing off.', 'bad');
      break;
    }
    ship.x = nx;
    ship.y = ny;
    reveal(state);
  }
  ship.hull = Math.max(0, ship.hull - dmg);
  v.waypoints = [];
  log(state, `We ran before the storm and were blown ${n} leagues ${compass(dx, dy)}.${dmg ? ` Hull damage: ${dmg}.` : ''}`, 'info');
  state.paused = true;
  state.alert = 'The storm has passed. We have been blown off course: plot a new heading.';
}

function salvage(state: GameState, w: number) {
  const wreck = state.world.wrecks[w];
  const ship = state.ship;
  wreck.looted = true;
  passDays(state, 1);
  if (state.mode !== 'sea') return;
  const rem = remoteness(state.world, wreck.x);
  const outcome = withRng(state, (rng) => rng.weighted(['treasure', 'supplies', 'nothing', 'accident'], [0.28, 0.35, 0.22, 0.15]));
  if (outcome === 'treasure') {
    const gold = withRng(state, (rng) => Math.round(rng.range(250, 550) * (0.8 + rem)));
    state.cash += gold;
    state.stats.treasure += gold;
    state.stats.earned += gold;
    raiseResult(state, 'Treasure!', `Under the rotten decking lies a strongbox of coin: ${money(gold)}.`);
  } else if (outcome === 'supplies') {
    ship.supplies = Math.min(CONFIG.suppliesMax, ship.supplies + 3);
    ship.provisions = Math.min(provisionCap(state), ship.provisions + 60);
    raiseResult(state, 'Salvage', 'We bring off spars, canvas, cordage and some sealed casks: 3 repair supplies and a few days of stores.');
  } else if (outcome === 'nothing') {
    raiseResult(state, 'Picked clean', 'Someone has been here before us. Nothing of value remains.');
  } else {
    const hurt = withRng(state, (rng) => rng.int(1, 2));
    ship.crew -= hurt;
    raiseResult(state, 'Accident', `The hulk shifts as the boat crew works her. ${hurt} ${hurt > 1 ? 'men are' : 'man is'} lost.`);
    checkLost(state);
  }
}

function raiseResult(state: GameState, title: string, body: string) {
  state.pending.unshift({ kind: 'notice', title, body, choices: [{ id: 'ok', label: 'Continue' }] });
  log(state, body, 'info');
}

// ---------------------------------------------------------------------------
// Player orders at sea
// ---------------------------------------------------------------------------

/** Add a waypoint. If known land stands in the way, route around it over the chart as known. */
export function addWaypoint(state: GameState, x: number, y: number) {
  const v = state.voyage;
  if (!v || state.mode !== 'sea') return;
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (!inBounds(state.world, cx, cy)) return;
  if (isKnown(state, cx, cy) && cellAt(state.world, cx, cy) === Cell.Land) return;
  const from = v.waypoints.length ? v.waypoints[v.waypoints.length - 1] : state.ship;
  const target = { x: cx + 0.5, y: cy + 0.5 };
  if (segmentBlocked(state, from, target)) {
    const path = findPath(state.world, { known: state.known, allowUnknown: true }, from, target);
    if (path) {
      v.waypoints.push(...simplifyPath(path));
    } else {
      v.waypoints.push(target);
    }
  } else {
    v.waypoints.push(target);
  }
  v.landfallTarget = -1;
  if (state.alert) {
    state.alert = null;
  }
}

function segmentBlocked(state: GameState, a: Pt, b: Pt): boolean {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.ceil(d * 3);
  for (let i = 1; i <= n; i++) {
    const x = Math.floor(a.x + ((b.x - a.x) * i) / n);
    const y = Math.floor(a.y + ((b.y - a.y) * i) / n);
    if (isKnown(state, x, y) && cellAt(state.world, x, y) !== Cell.Sea) return true;
  }
  return false;
}

export function clearCourse(state: GameState) {
  if (!state.voyage) return;
  state.voyage.waypoints = [];
  state.voyage.landfallTarget = -1;
}

export function removeLastWaypoint(state: GameState) {
  state.voyage?.waypoints.pop();
}

export function courseHome(state: GameState) {
  const v = state.voyage;
  if (!v) return;
  updateHomeEstimate(state);
  if (!v.homeRoute.length) return;
  v.waypoints = simplifyPath(v.homeRoute);
  v.landfallTarget = -1;
  state.alert = null;
  log(state, `We turn for home: about ${v.homeDays} ${v.homeDays === 1 ? 'day' : 'days'}.`, 'info');
}

export function setRations(state: GameState, r: 'full' | 'short') {
  state.ship.rations = r;
  log(state, r === 'short' ? 'Rations cut. The stores will last longer, but sickness is likelier.' : 'Full rations restored.', 'info');
}

export function canPatch(state: GameState): boolean {
  return state.mode === 'sea' && state.ship.supplies > 0 && state.ship.hull < 100;
}

export function patchHull(state: GameState) {
  if (!canPatch(state)) return;
  state.ship.supplies--;
  state.ship.hull = Math.min(100, state.ship.hull + CONFIG.patchAmount);
  log(state, `The carpenter patches the hull (+${CONFIG.patchAmount}).`, 'info');
}

export function togglePause(state: GameState) {
  if (state.mode !== 'sea' || state.pending.length) return;
  state.paused = !state.paused;
  if (!state.paused) state.alert = null;
}

// ---------------------------------------------------------------------------
// Landfall
// ---------------------------------------------------------------------------

function setCourseToLandmass(state: GameState, lmId: number) {
  const v = state.voyage!;
  if (adjacentLandmass(state, lmId) === lmId) {
    openLandfall(state, lmId);
    return;
  }
  const { world, ship } = state;
  let best: Pt[] | null = null;
  let bestD = Infinity;
  const candidates: { x: number; y: number; d: number }[] = [];
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      if (!isKnown(state, x, y) || cellAt(world, x, y) === Cell.Land) continue;
      let touches = false;
      for (let dy = -1; dy <= 1 && !touches; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (isKnown(state, nx, ny) && world.landmassOf[idx(world, nx, ny)] === lmId && cellAt(world, nx, ny) === Cell.Land) {
            touches = true;
            break;
          }
        }
      }
      if (touches) candidates.push({ x, y, d: Math.hypot(x + 0.5 - ship.x, y + 0.5 - ship.y) });
    }
  }
  candidates.sort((a, b) => a.d - b.d);
  for (const c of candidates.slice(0, 8)) {
    const path = findPath(world, { known: state.known }, ship, { x: c.x + 0.5, y: c.y + 0.5 });
    if (path && path.length < bestD) {
      best = path;
      bestD = path.length;
    }
  }
  if (!best) {
    alert(state, 'We can find no safe approach to that coast. Plot a course in by hand.');
    return;
  }
  v.waypoints = simplifyPath(best);
  v.landfallTarget = lmId;
  log(state, `Standing in toward ${landmassLabel(state, lmId)}.`, 'info');
}

/** Landfall is available whenever the ship lies next to land other than home. */
export function canGoAshore(state: GameState): boolean {
  return state.mode === 'sea' && !state.pending.length && adjacentLandmass(state) >= 0;
}

export function goAshore(state: GameState) {
  if (!canGoAshore(state)) return;
  openLandfall(state, adjacentLandmass(state));
}

export function openLandfall(state: GameState, lmId: number, result?: string) {
  const v = state.voyage!;
  if (!v.landfall || v.landfall.landmass !== lmId) {
    v.landfall = { landmass: lmId, shorePartyDone: false, surveyed: false };
    log(state, `Landfall on ${landmassLabel(state, lmId)}.`, 'info');
  }
  state.pending.unshift(buildLandfall(state, result));
  v.quietDays = 0;
}

export function sitesInReach(state: GameState, surveyedOnly: boolean) {
  const r = state.upgrades.surveyKit ? 8 : 5;
  return state.world.sites.filter(
    (s) => (!surveyedOnly || s.surveyed) && Math.hypot(s.x + 0.5 - state.ship.x, s.y + 0.5 - state.ship.y) <= r,
  );
}

function buildLandfall(state: GameState, result?: string): Interrupt {
  const v = state.voyage!;
  const lf = v.landfall!;
  const lm = state.world.landmasses[lf.landmass];
  const space = cargoCap(state) - cargoUsed(state);
  const choices: Choice[] = [
    {
      id: 'shore',
      label: 'Send a shore party',
      hint: lf.shorePartyDone ? 'Already foraged here' : 'Refill stores; 1 day; small risk to the party',
      disabled: lf.shorePartyDone,
    },
    {
      id: 'survey',
      label: 'Survey the coast',
      hint: lf.surveyed ? 'Already surveyed' : 'Find timber, furs, spice or pearls; 1 day',
      disabled: lf.surveyed,
    },
  ];
  for (const site of sitesInReach(state, true)) {
    choices.push({
      id: `load:${site.id}`,
      label: `Load ${CONFIG.resources[site.type].label.toLowerCase()}`,
      hint: site.stock <= 0 ? 'Stripped bare until next season' : space <= 0 ? 'The hold is full' : `${Math.min(space, site.stock)} of ${site.stock} units`,
      disabled: site.stock <= 0 || space <= 0,
      tone: 'money',
    });
  }
  choices.push({ id: 'leave', label: 'Weigh anchor', hint: 'Back to the voyage' });
  return {
    kind: 'landfall',
    title: `Landfall: ${lm.name || `unnamed ${lm.kind}`}`,
    body: result ?? `We anchor off ${lm.name ? lm.name : `this ${lm.kind}`}. The boats are ready.`,
    choices,
    data: { landmass: lm.id },
  };
}

function landfallAction(state: GameState, choiceId: string) {
  const v = state.voyage!;
  const lf = v.landfall!;
  const ship = state.ship;
  const lm = state.world.landmasses[lf.landmass];
  if (choiceId === 'leave') {
    v.landfall = null;
    updateHomeEstimate(state);
    return;
  }
  let result = '';
  if (choiceId === 'shore') {
    lf.shorePartyDone = true;
    passDays(state, 1);
    if (state.mode !== 'sea') return;
    const gain = withRng(state, (rng) => Math.round(ship.crew * rng.range(7, 13) * lm.forage));
    const room = provisionCap(state) - ship.provisions;
    const got = Math.max(0, Math.min(room, gain));
    ship.provisions += got;
    result = `The shore party returns with water and game: ${Math.floor(got / Math.max(1, dailyRations(state)))} days of stores.`;
    const mishap = withRng(state, (rng) => rng.weighted(['none', 'injury', 'fever'], [0.84, 0.1, 0.06]));
    if (mishap === 'injury') {
      ship.crew -= 1;
      result += ' One man did not come back: a fall on the rocks.';
    } else if (mishap === 'fever') {
      v.slowDays = Math.max(v.slowDays, 3);
      result += ' Several men came back feverish from the marshes; the ship will sail slower for a few days.';
    }
    log(state, result, mishap === 'none' ? 'good' : 'bad');
    if (checkLost(state)) return;
  } else if (choiceId === 'survey') {
    lf.surveyed = true;
    passDays(state, 1);
    if (state.mode !== 'sea') return;
    const found = sitesInReach(state, false).filter((s) => !s.surveyed);
    if (!found.length) {
      result = 'The survey party walks the shore and finds nothing worth the carrying.';
    } else {
      const names: string[] = [];
      for (const site of found) {
        site.surveyed = true;
        site.knownBy = Math.max(1, site.knownBy);
        v.sitesFound.push(site.id);
        names.push(`${CONFIG.resources[site.type].label.toLowerCase()} (${site.maxStock} units a season)`);
      }
      result = `The survey finds ${names.join(' and ')}.`;
    }
    log(state, result, found.length ? 'good' : 'info');
  } else if (choiceId.startsWith('load:')) {
    const site = state.world.sites[Number(choiceId.slice(5))];
    const qty = Math.min(cargoCap(state) - cargoUsed(state), site.stock);
    if (qty > 0) {
      site.stock -= qty;
      const lot = ship.cargo.find((l) => l.siteId === site.id);
      if (lot) lot.qty += qty;
      else ship.cargo.push({ siteId: site.id, type: site.type, qty });
      result = `We load ${qty} units of ${CONFIG.resources[site.type].label.toLowerCase()}.`;
      log(state, result, 'good');
      checkResourceObjective(state);
    }
  }
  if (state.mode === 'sea') openLandfall(state, lf.landmass, result);
}

function checkResourceObjective(state: GameState) {
  const v = state.voyage!;
  const c = v.contract;
  if (!c || c.kind !== 'find_resource' || v.objectiveDone || !c.resource) return;
  if (deliverableQty(state) >= c.resource.qty) {
    v.objectiveDone = true;
    log(state, 'Contract objective reached: the cargo is aboard. Return home to deliver it.', 'good');
  }
}

/** Cargo that counts for a find_resource contract: the right type, from sites first surveyed this voyage. */
export function deliverableQty(state: GameState): number {
  const v = state.voyage;
  const c = v?.contract;
  if (!v || !c?.resource) return 0;
  return state.ship.cargo
    .filter((l) => l.type === c.resource!.type && v.sitesFound.includes(l.siteId))
    .reduce((a, l) => a + l.qty, 0);
}

export function nameLandmass(state: GameState, lmId: number, name: string) {
  const lm = state.world.landmasses[lmId];
  const clean = name.trim().slice(0, 40);
  if (!clean || lm.home) return;
  if (!lm.name) state.stats.landmassesNamed++;
  lm.name = clean;
  log(state, `We name it ${clean}.`, 'good');
  if (state.pending[0]?.kind === 'landfall') {
    state.pending[0] = buildLandfall(state, `It shall be called ${clean}.`);
  }
}
