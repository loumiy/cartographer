import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/game/config';
import { levelsSum } from '../src/game/core';
import { Cell, type World } from '../src/game/types';
import { generateWorld } from '../src/game/world';

/**
 * Island hopping, planned with a perfect chart: the fewest days of stores that get the ship from
 * home to a corner of the first sea and on to a port, foraging once at each landmass on the way.
 */
function rangeNeeds(w: World) {
  const fs = w.firstSea;
  const W = w.width;
  const inFs = (x: number, y: number) => x >= fs.x0 && y >= fs.y0 && x < fs.x1 && y < fs.y1;
  const sea = (x: number, y: number) => inFs(x, y) && w.cells[y * W + x] !== Cell.Land;
  const coastal = new Uint8Array(W * w.height);
  for (let y = fs.y0; y < fs.y1; y++) {
    for (let x = fs.x0; x < fs.x1; x++) {
      search: for (let dy = -CONFIG.coastRange; dy <= CONFIG.coastRange; dy++) {
        for (let dx = -CONFIG.coastRange; dx <= CONFIG.coastRange; dx++) {
          if (inFs(x + dx, y + dy) && w.cells[(y + dy) * W + x + dx] === Cell.Land) {
            coastal[y * W + x] = 1;
            break search;
          }
        }
      }
    }
  }
  // Days to every sea cell of the first sea from one point.
  const days = (sx: number, sy: number) => {
    const d = new Float64Array(W * w.height).fill(Infinity);
    const heap: [number, number][] = [];
    const push = (k: number, i: number) => {
      heap.push([k, i]);
      let n = heap.length - 1;
      while (n > 0 && heap[(n - 1) >> 1][0] > heap[n][0]) {
        [heap[n], heap[(n - 1) >> 1]] = [heap[(n - 1) >> 1], heap[n]];
        n = (n - 1) >> 1;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let n = 0;
        for (;;) {
          const l = 2 * n + 1;
          const r = l + 1;
          let m = n;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === n) break;
          [heap[n], heap[m]] = [heap[m], heap[n]];
          n = m;
        }
      }
      return top;
    };
    d[sy * W + sx] = 0;
    push(0, sy * W + sx);
    while (heap.length) {
      const [dd, i] = pop();
      if (dd > d[i]) continue;
      const x = i % W;
      const y = (i - x) / W;
      for (const [ex, ey, m] of [
        [1, 0, 1],
        [-1, 0, 1],
        [0, 1, 1],
        [0, -1, 1],
        [1, 1, Math.SQRT2],
        [1, -1, Math.SQRT2],
        [-1, 1, Math.SQRT2],
        [-1, -1, Math.SQRT2],
      ]) {
        const nx = x + ex;
        const ny = y + ey;
        if (!sea(nx, ny)) continue;
        const j = ny * W + nx;
        const cost = m / (coastal[j] ? CONFIG.speedCoast : CONFIG.speedOpen);
        if (dd + cost < d[j]) {
          d[j] = dd + cost;
          push(d[j], j);
        }
      }
    }
    return d;
  };

  type Node = { x: number; y: number; forageDays: number; lm: number };
  const nodes: Node[] = [];
  for (const p of w.ports) nodes.push({ x: p.dock.x, y: p.dock.y, forageDays: 0, lm: -1 });
  for (const lm of w.landmasses) {
    if (lm.home) continue;
    const anchors: [number, number][] = [];
    for (let i = 0; i < w.cells.length; i++) {
      if (w.landmassOf[i] !== lm.id) continue;
      const x = i % W;
      const y = (i - x) / W;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        if (sea(x + dx, y + dy) && w.cells[(y + dy) * W + x + dx] === Cell.Sea) anchors.push([x + dx, y + dy]);
      }
    }
    if (!anchors.length) continue;
    // Average shore party: 10 days of stores × forage quality × size.
    const forageDays = 10 * lm.forage * (CONFIG.forageBySize[lm.kind] ?? 1);
    for (const k of [0, 1, 2]) {
      const [x, y] = anchors[Math.floor((k * anchors.length) / 3)];
      nodes.push({ x, y, forageDays, lm: lm.id });
    }
  }
  const corners = [
    [fs.x0, fs.y0],
    [fs.x0, fs.y1 - 1],
    [fs.x1 - 1, fs.y0],
    [fs.x1 - 1, fs.y1 - 1],
  ].map(([cx, cy]) => {
    let best = [cx, cy];
    let bd = Infinity;
    for (let y = fs.y0; y < fs.y1; y++) {
      for (let x = fs.x0; x < fs.x1; x++) {
        if (!sea(x, y)) continue;
        const d = Math.hypot(x - cx, y - cy);
        if (d < bd) {
          bd = d;
          best = [x, y];
        }
      }
    }
    return nodes.push({ x: best[0], y: best[1], forageDays: 0, lm: -1 }) - 1;
  });
  const D = nodes.map((n) => {
    const d = days(n.x, n.y);
    return nodes.map((m) => d[m.y * W + m.x]);
  });

  const bestArrival = (cap: number, start: number, stores: number, target: number, hop: boolean) => {
    const best = new Float64Array(nodes.length).fill(-1);
    const foraged = new Set<number>();
    best[start] = stores;
    const open = [start];
    let arrival = -1;
    while (open.length) {
      open.sort((a, b) => best[a] - best[b]);
      const i = open.pop()!;
      for (let j = 0; j < nodes.length; j++) {
        if (!(D[i][j] <= best[i])) continue;
        let s = best[i] - D[i][j];
        if (j === target) arrival = Math.max(arrival, s);
        const n = nodes[j];
        const forage = hop && n.forageDays > 0 && !foraged.has(n.lm);
        if (forage) s = Math.min(cap, s + n.forageDays) - 1;
        if (s > best[j] + 0.5) {
          best[j] = s;
          if (forage) foraged.add(n.lm);
          open.push(j);
        }
      }
    }
    return arrival;
  };
  const feasible = (cap: number, corner: number, hop: boolean) => {
    const a = bestArrival(cap, 0, cap, corner, hop);
    return a >= 0 && (bestArrival(cap, corner, a, 0, hop) >= 0 || bestArrival(cap, corner, a, 1, hop) >= 0);
  };
  const need = (corner: number, hop: boolean) => {
    let lo = 5;
    let hi = 300;
    if (!feasible(hi, corner, hop)) return Infinity;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (feasible(m, corner, hop)) hi = m;
      else lo = m;
    }
    return hi;
  };
  return {
    hop: corners.map((c) => need(c, true)),
    direct: corners.map((c) => need(c, false)),
  };
}

describe('range of the first ship', () => {
  it('reaches all four corners of the first sea by island hopping once fully refitted', () => {
    const crew = CONFIG.crewStart;
    const fullDays = (CONFIG.ships.pinnace.stores + levelsSum(CONFIG.storesLevels, CONFIG.storesLevels.length)) / crew;
    const baseDays = CONFIG.ships.pinnace.stores / crew;
    const worstHop: number[] = [];
    const worstDirect: number[] = [];
    for (let k = 0; k < 12; k++) {
      const needs = rangeNeeds(generateWorld(`range-${k}`));
      for (const n of needs.hop) expect(Number.isFinite(n)).toBe(true);
      worstHop.push(Math.max(...needs.hop));
      worstDirect.push(Math.max(...needs.direct));
    }
    // The chart is never perfect in play, so the fully refitted ship carries half again the
    // stores that perfect island hopping needs, on every seed.
    expect(fullDays).toBeGreaterThanOrEqual(1.5 * Math.max(...worstHop));
    // Hopping matters: it cuts what the farthest corner needs by at least a third on average.
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(mean(worstHop)).toBeLessThan((2 / 3) * mean(worstDirect));
    // No ship reaches the farthest corner and back without a stop: every seed needs more than the base stores.
    for (const d of worstDirect) expect(d).toBeGreaterThan(baseDays);
    // And the unrefitted ship cannot comfortably reach every corner, even hopping.
    expect(worstHop.filter((d) => 1.5 * d > baseDays).length).toBeGreaterThan(0);
  }, 120_000);
});
