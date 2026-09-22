import { Rng, hashSeed, makeNoise } from '../rng';
import { CONFIG, RESOURCE_TYPES } from './config';
import { portName, suggestName } from './names';
import { Cell, type Landmass, type LandmassKind, type ResourceType, type Site, type Wreck, type World } from './types';

const DIRS4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function idx(world: { width: number }, x: number, y: number): number {
  return y * world.width + x;
}

export function inBounds(world: { width: number; height: number }, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < world.width && y < world.height;
}

export function cellAt(world: World, x: number, y: number): Cell {
  if (!inBounds(world, x, y)) return Cell.Land;
  return world.cells[idx(world, x, y)];
}

export function kindForSize(size: number): LandmassKind {
  if (size < 8) return 'islet';
  if (size < 40) return 'island';
  if (size < 160) return 'large island';
  return 'coast';
}

/** 0 at the home port, 1 at the far edge of the sea. */
export function remoteness(world: World, x: number): number {
  return Math.min(1, Math.max(0, (x - world.dock.x) / (world.width - world.dock.x)));
}

/**
 * Seeded procedural sea. Home coast on the west edge; land thickens and sites get
 * richer toward the east, so difficulty rises with distance from home.
 */
export function generateWorld(seed: string): World {
  const { width, height } = CONFIG;
  const s = hashSeed(seed);
  const rng = new Rng(s);
  const noise = makeNoise(s ^ 0x9e3779b9);
  const detail = makeNoise(s ^ 0x85ebca6b);
  const cells = new Uint8Array(width * height);
  const homeY = Math.floor(height / 2);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Home coast: a ragged strip along the west edge.
      const coastEdge = 2 + Math.round(detail(0.5, y * 0.15, 3) * 3);
      if (x <= coastEdge) {
        cells[y * width + x] = Cell.Land;
        continue;
      }
      const d = (x - 6) / (width - 6);
      if (x < 16) continue; // Open water off home.
      const n = noise(x / 16, y / 16, 4) * 0.8 + detail(x / 5, y / 5, 2) * 0.2;
      // Few small islands near home, larger masses farther out.
      const threshold = 0.66 - 0.1 * d;
      // Keep a margin at the north/south edges so coasts do not stick to the frame everywhere.
      const edge = Math.min(y, height - 1 - y);
      const edgePenalty = edge < 2 ? 0.08 : 0;
      if (n > threshold + edgePenalty) cells[y * width + x] = Cell.Land;
    }
  }

  // Port on the home coast at mid-height; clear the approaches.
  let portX = 0;
  while (cells[homeY * width + portX + 1] === Cell.Land) portX++;
  const dock = { x: portX + 1, y: homeY };
  for (let y = homeY - 3; y <= homeY + 3; y++) {
    for (let x = dock.x; x < dock.x + 10; x++) cells[y * width + x] = Cell.Sea;
  }

  fillLakes(cells, width, height, dock);

  const { landmassOf, sizes } = labelLandmasses(cells, width, height);
  // Drop specks of one or two cells: too small to find or name.
  for (let i = 0; i < cells.length; i++) {
    if (landmassOf[i] >= 0 && sizes[landmassOf[i]] < 3 && i % width > 8) cells[i] = Cell.Sea;
  }
  const labelled = labelLandmasses(cells, width, height);

  const world: World = {
    seed,
    width,
    height,
    cells,
    landmassOf: labelled.landmassOf,
    landmasses: [],
    sites: [],
    wrecks: [],
    homePort: { x: portX, y: homeY },
    dock,
    portName: portName(rng),
  };

  const homeId = labelled.landmassOf[idx(world, 0, homeY)];
  const used = new Set<string>();
  world.landmasses = labelled.sizes.map((size, id): Landmass => {
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < cells.length; i++) {
      if (labelled.landmassOf[i] === id) {
        sx += i % width;
        sy += Math.floor(i / width);
      }
    }
    const mx = sx / size;
    const my = sy / size;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < cells.length; i++) {
      if (labelled.landmassOf[i] !== id) continue;
      const dd = (i % width - mx) ** 2 + (Math.floor(i / width) - my) ** 2;
      if (dd < bestD) {
        bestD = dd;
        best = i;
      }
    }
    const kind = kindForSize(size);
    const home = id === homeId;
    return {
      id,
      size,
      kind,
      cx: best % width,
      cy: Math.floor(best / width),
      home,
      suggestedName: home ? 'The Old Country' : suggestName(rng, kind, used),
      name: home ? 'The Old Country' : '',
      forage: rng.range(0.6, 1.4),
      discovered: home,
    };
  });

  placeReefs(world, rng);
  placeSites(world, rng);
  placeWrecks(world, rng);
  return world;
}

/** Any water not connected to the home dock becomes land, so every sea cell is reachable. */
function fillLakes(cells: Uint8Array, width: number, height: number, dock: { x: number; y: number }) {
  const seen = new Uint8Array(cells.length);
  const stack = [dock.y * width + dock.x];
  seen[stack[0]] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % width;
    const y = Math.floor(i / width);
    for (const [dx, dy] of DIRS4) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = ny * width + nx;
      if (!seen[j] && cells[j] !== Cell.Land) {
        seen[j] = 1;
        stack.push(j);
      }
    }
  }
  for (let i = 0; i < cells.length; i++) if (!seen[i]) cells[i] = Cell.Land;
}

function labelLandmasses(cells: Uint8Array, width: number, height: number) {
  const landmassOf = new Int16Array(cells.length).fill(-1);
  const sizes: number[] = [];
  for (let start = 0; start < cells.length; start++) {
    if (cells[start] !== Cell.Land || landmassOf[start] >= 0) continue;
    const id = sizes.length;
    let size = 0;
    const stack = [start];
    landmassOf[start] = id;
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % width;
      const y = Math.floor(i / width);
      for (const [dx, dy] of DIRS4) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        if (cells[j] === Cell.Land && landmassOf[j] < 0) {
          landmassOf[j] = id;
          stack.push(j);
        }
      }
    }
    sizes.push(size);
  }
  return { landmassOf, sizes };
}

export function isCoast(world: World, x: number, y: number): boolean {
  if (cellAt(world, x, y) !== Cell.Land) return false;
  for (const [dx, dy] of DIRS4) {
    if (inBounds(world, x + dx, y + dy) && cellAt(world, x + dx, y + dy) !== Cell.Land) return true;
  }
  return false;
}

function nearLand(world: World, x: number, y: number, r: number): boolean {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (inBounds(world, x + dx, y + dy) && cellAt(world, x + dx, y + dy) === Cell.Land) return true;
    }
  }
  return false;
}

function placeReefs(world: World, rng: Rng) {
  for (let y = 1; y < world.height - 1; y++) {
    for (let x = 24; x < world.width; x++) {
      if (cellAt(world, x, y) !== Cell.Sea) continue;
      if (!nearLand(world, x, y, 2)) continue;
      const p = 0.03 + 0.07 * remoteness(world, x);
      if (rng.chance(p)) world.cells[idx(world, x, y)] = Cell.Reef;
    }
  }
}

function placeSites(world: World, rng: Rng) {
  for (const lm of world.landmasses) {
    if (lm.home) continue;
    const coast: [number, number][] = [];
    for (let i = 0; i < world.cells.length; i++) {
      if (world.landmassOf[i] !== lm.id) continue;
      const x = i % world.width;
      const y = Math.floor(i / world.width);
      if (isCoast(world, x, y)) coast.push([x, y]);
    }
    let count = Math.floor(coast.length / 14);
    if (count === 0 && rng.chance(0.65)) count = 1;
    count = Math.min(count, 5);
    const taken: [number, number][] = [];
    for (let k = 0; k < count; k++) {
      const [x, y] = rng.pick(coast);
      if (taken.some(([tx, ty]) => Math.abs(tx - x) + Math.abs(ty - y) < 6)) continue;
      taken.push([x, y]);
      const d = remoteness(world, x);
      const type = rng.weighted<ResourceType>(RESOURCE_TYPES, [1.3 - d, 0.6, 0.15 + d, 0.05 + d * d]);
      const richness = Math.min(1, Math.max(0, 0.2 + 0.6 * d + rng.range(-0.15, 0.2)));
      const maxStock = Math.round(CONFIG.resources[type].stock * (0.6 + 0.8 * richness));
      const site: Site = {
        id: world.sites.length,
        x,
        y,
        landmass: lm.id,
        type,
        richness,
        maxStock,
        stock: maxStock,
        surveyed: false,
        knownBy: 0,
      };
      world.sites.push(site);
    }
  }
}

function placeWrecks(world: World, rng: Rng) {
  const wrecks: Wreck[] = [];
  let tries = 0;
  while (wrecks.length < 6 && tries++ < 2000) {
    const x = rng.int(30, world.width - 2);
    const y = rng.int(2, world.height - 3);
    if (cellAt(world, x, y) !== Cell.Sea) continue;
    if (wrecks.some((w) => Math.abs(w.x - x) + Math.abs(w.y - y) < 15)) continue;
    wrecks.push({ x, y, looted: false, sighted: false });
  }
  world.wrecks = wrecks;
}
