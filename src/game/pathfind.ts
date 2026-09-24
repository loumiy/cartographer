import { Cell, type Rect, type World } from './types';

export interface PathOptions {
  /** Cells on the player's chart; unknown cells are only passable when `allowUnknown` is set. */
  known: Uint8Array;
  allowUnknown?: boolean;
  /** Cells outside this rectangle are impassable. */
  bounds?: Rect;
  /** Treat known reefs and ice as impassable instead of costly. */
  avoidHazards?: boolean;
}

const NEIGHBOURS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
] as const;

const REEF_COST = 25;

/**
 * A* over the chart as the player knows it. Known land is impassable, known reefs are
 * expensive. Unknown cells are treated as open water when allowed: the planner never
 * knows more than the chart. Returns cell centres from start (exclusive) to goal, or null.
 */
export function findPath(
  world: World,
  opts: PathOptions,
  from: { x: number; y: number },
  to: { x: number; y: number },
): { x: number; y: number }[] | null {
  const { width, height } = world;
  const sx = Math.floor(from.x);
  const sy = Math.floor(from.y);
  const gx = Math.floor(to.x);
  const gy = Math.floor(to.y);
  const n = width * height;
  const g = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap = new MinHeap();
  const start = sy * width + sx;
  const goal = gy * width + gx;

  const b = opts.bounds;
  const passable = (i: number) => {
    if (b) {
      const x = i % width;
      const y = (i - x) / width;
      if (x < b.x0 || y < b.y0 || x >= b.x1 || y >= b.y1) return false;
    }
    if (!opts.known[i]) return !!opts.allowUnknown;
    if (opts.avoidHazards && (world.cells[i] === Cell.Reef || world.cells[i] === Cell.Ice)) return false;
    return world.cells[i] !== Cell.Land;
  };
  if (!passable(goal) && goal !== start) return null;

  const h = (x: number, y: number) => {
    const dx = Math.abs(x - gx);
    const dy = Math.abs(y - gy);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };

  g[start] = 0;
  heap.push(start, h(sx, sy));
  while (heap.size) {
    const i = heap.pop();
    if (i === goal) break;
    if (closed[i]) continue;
    closed[i] = 1;
    const x = i % width;
    const y = (i - x) / width;
    for (const [dx, dy, cost] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = ny * width + nx;
      if (closed[j] || !passable(j)) continue;
      // No cutting diagonally between two land cells.
      if (dx !== 0 && dy !== 0 && (!passable(y * width + nx) || !passable(ny * width + x))) continue;
      const hazard = world.cells[j] === Cell.Reef || world.cells[j] === Cell.Ice;
      const step = cost + (opts.known[j] && hazard ? REEF_COST : 0);
      const ng = g[i] + step;
      if (ng < g[j]) {
        g[j] = ng;
        came[j] = i;
        heap.push(j, ng + h(nx, ny));
      }
    }
  }
  if (start !== goal && came[goal] < 0) return null;
  const out: { x: number; y: number }[] = [];
  for (let i = goal; i !== start; i = came[i]) {
    out.push({ x: (i % width) + 0.5, y: Math.floor(i / width) + 0.5 });
  }
  return out.reverse();
}

/** Path length in cells (diagonals count √2). */
export function pathLength(from: { x: number; y: number }, path: { x: number; y: number }[]): number {
  let len = 0;
  let px = from.x;
  let py = from.y;
  for (const p of path) {
    len += Math.hypot(p.x - px, p.y - py);
    px = p.x;
    py = p.y;
  }
  return len;
}

/** Drop intermediate points that lie on a straight run, so plotted courses stay readable. */
export function simplifyPath(path: { x: number; y: number }[]): { x: number; y: number }[] {
  if (path.length < 3) return path.slice();
  const out = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const a = out[out.length - 1];
    const b = path[i];
    const c = path[i + 1];
    const dx1 = Math.sign(b.x - a.x);
    const dy1 = Math.sign(b.y - a.y);
    const dx2 = Math.sign(c.x - b.x);
    const dy2 = Math.sign(c.y - b.y);
    if (dx1 !== dx2 || dy1 !== dy2) out.push(b);
  }
  out.push(path[path.length - 1]);
  return out;
}

class MinHeap {
  private items: number[] = [];
  private keys: number[] = [];

  get size() {
    return this.items.length;
  }

  push(item: number, key: number) {
    this.items.push(item);
    this.keys.push(key);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): number {
    const top = this.items[0];
    const lastItem = this.items.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.items.length) {
      this.items[0] = lastItem;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.items.length && this.keys[l] < this.keys[m]) m = l;
        if (r < this.items.length && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number) {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
  }
}
