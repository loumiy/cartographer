import { Rng, hashSeed, makeNoise } from '../rng';
import { CONFIG, RESOURCE_TYPES } from './config';
import { farPort, portName, suggestName } from './names';
import { Cell, type Corner, type Landmass, type LandmassKind, type Rect, type ResourceType, type Site, type Wreck, type World } from './types';

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

export type Region = 'first' | 'row' | 'east' | 'diagonal';

/**
 * Which of the four seas a cell lies in. 'row' is the sea beside the first one, on the side
 * away from the far port (north or south); 'diagonal' is the one farthest from both ports.
 */
export function regionOf(world: World, x: number, y: number): Region {
  const fs = world.firstSea;
  const inRows = y >= fs.y0 && y < fs.y1;
  const west = x < fs.x1;
  if (west) return inRows ? 'first' : 'row';
  return inRows ? 'east' : 'diagonal';
}

/** The new row is cold when the map grew north (far port in the south-east), warm when it grew south. */
export function rowIsCold(world: World): boolean {
  return world.corner === 'se';
}

export function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x0 && y >= r.y0 && x < r.x1 && y < r.y1;
}

/** 0 at a port, 1 at a sea's width away. Distance runs from the nearest port. */
export function remoteness(world: World, x: number, y: number): number {
  let d = Infinity;
  for (const p of world.ports) d = Math.min(d, Math.hypot(x - p.dock.x, y - p.dock.y));
  return Math.min(1, Math.max(0, d / (CONFIG.seaWidth - world.ports[0].dock.x)));
}

/** How deep into the unknown a cell lies, for placing riches and hazards: V1's gradient in the first sea, more beyond. */
function depth(world: World, x: number, y: number): number {
  switch (regionOf(world, x, y)) {
    case 'first':
      return Math.min(1, Math.max(0, (x - world.ports[0].dock.x) / (world.firstSea.x1 - world.ports[0].dock.x)));
    case 'row':
      return 0.55;
    case 'east':
      return 0.9;
    case 'diagonal':
      return 1;
  }
}

/**
 * Seeded procedural world: four seas in a 2 × 2 grid. Home is on the west edge of the first
 * sea; the far port sits in its north-east or south-east corner on a continent that runs along
 * the world's edge. The other seas can only be sailed once the far port is found.
 */
export function generateWorld(seed: string): World {
  const { width, height, seaWidth: SW, seaHeight: SH } = CONFIG;
  const s = hashSeed(seed);
  const rng = new Rng(s);
  const noise = makeNoise(s ^ 0x9e3779b9);
  const detail = makeNoise(s ^ 0x85ebca6b);
  const corner: Corner = new Rng(hashSeed(`${seed}:corner`)).chance(0.5) ? 'se' : 'ne';
  const oy = corner === 'se' ? SH : 0;
  const firstSea: Rect = { x0: 0, y0: oy, x1: SW, y1: oy + SH };
  const cells = new Uint8Array(width * height);
  const homeY = oy + Math.floor(SH / 2);

  // The far continent: a band of mainland along the world's edge, from the middle of the first sea eastward.
  const band = (x: number) => {
    if (x < 58) return 0;
    const ramp = x < 70 ? ((x - 58) / 12) * 3 : 3;
    const grow = x >= 100 ? Math.min(3, (x - 100) / 15) : 0;
    return Math.max(0, Math.min(10, Math.round(ramp + detail(x * 0.07, 91.3, 3) * 4 + grow)));
  };
  const continent = (x: number, y: number) => (corner === 'se' ? y >= height - band(x) : y < band(x));

  for (let y = 0; y < height; y++) {
    // Noise is sampled relative to the first sea so its terrain matches the V1 map.
    const ly = y - oy;
    for (let x = 0; x < width; x++) {
      // Home coast: a ragged strip along the west edge.
      const coastEdge = 2 + Math.round(detail(0.5, ly * 0.15, 3) * 3);
      if (x <= coastEdge || continent(x, y)) {
        cells[y * width + x] = Cell.Land;
        continue;
      }
      if (x < 16) continue; // Open water off home.
      const d = (x - 6) / (SW - 6);
      const n = noise(x / 16, ly / 16, 4) * 0.8 + detail(x / 5, ly / 5, 2) * 0.2;
      // Few small islands near home, larger masses farther out.
      const threshold = 0.66 - 0.1 * Math.min(1.4, d);
      // Keep a margin at the world's edges so coasts do not stick to the frame everywhere.
      const edge = Math.min(y, height - 1 - y);
      const edgePenalty = edge < 2 ? 0.08 : 0;
      if (n > threshold + edgePenalty) cells[y * width + x] = Cell.Land;
    }
  }

  // Home port on the west coast at mid-height of the first sea; clear the approaches.
  let portX = 0;
  while (cells[homeY * width + portX + 1] === Cell.Land) portX++;
  const dock = { x: portX + 1, y: homeY };
  for (let y = homeY - 3; y <= homeY + 3; y++) {
    for (let x = dock.x; x < dock.x + 10; x++) cells[y * width + x] = Cell.Sea;
  }

  // Far port in the corner, on the continent's coast, with a cleared harbour.
  const fx = SW - 8;
  const fb = Math.max(3, band(fx));
  const town = corner === 'se' ? { x: fx, y: height - fb } : { x: fx, y: fb - 1 };
  const farDock = corner === 'se' ? { x: fx, y: town.y - 1 } : { x: fx, y: town.y + 1 };
  const dir = corner === 'se' ? -1 : 1;
  for (let k = 0; k < 7; k++) {
    for (let x = fx - 5; x <= fx + 5; x++) cells[(farDock.y + dir * k) * width + x] = Cell.Sea;
  }
  cells[town.y * width + town.x] = Cell.Land;
  connectWithinFirstSea(cells, width, firstSea, dock, farDock);
  fillLakes(cells, width, height, dock);
  joinFirstSeaPockets(cells, width, firstSea, dock);

  const { landmassOf, sizes } = labelLandmasses(cells, width, height);
  // Drop specks of one or two cells: too small to find or name.
  for (let i = 0; i < cells.length; i++) {
    if (landmassOf[i] >= 0 && sizes[landmassOf[i]] < 3 && i % width > 8) cells[i] = Cell.Sea;
  }
  const labelled = labelLandmasses(cells, width, height);

  const far = farPort(new Rng(hashSeed(`${seed}:far`)));
  const world: World = {
    seed,
    width,
    height,
    corner,
    firstSea,
    cells,
    landmassOf: labelled.landmassOf,
    landmasses: [],
    sites: [],
    wrecks: [],
    ports: [
      { id: 0, name: portName(rng), power: 'the Crown', x: portX, y: homeY, dock, prices: CONFIG.portPrices[0], known: true },
      { id: 1, name: far.name, power: far.power, x: town.x, y: town.y, dock: farDock, prices: CONFIG.portPrices[1], known: false },
    ],
  };

  const homeId = labelled.landmassOf[idx(world, 0, homeY)];
  const farId = labelled.landmassOf[idx(world, town.x, town.y)];
  const used = new Set<string>();
  const sums = labelled.sizes.map(() => ({ x: 0, y: 0 }));
  for (let i = 0; i < cells.length; i++) {
    const id = labelled.landmassOf[i];
    if (id >= 0) {
      sums[id].x += i % width;
      sums[id].y += Math.floor(i / width);
    }
  }
  const best = labelled.sizes.map(() => ({ i: -1, d: Infinity }));
  for (let i = 0; i < cells.length; i++) {
    const id = labelled.landmassOf[i];
    if (id < 0) continue;
    const dd = ((i % width) - sums[id].x / labelled.sizes[id]) ** 2 + (Math.floor(i / width) - sums[id].y / labelled.sizes[id]) ** 2;
    if (dd < best[id].d) best[id] = { i, d: dd };
  }
  world.landmasses = labelled.sizes.map((size, id): Landmass => {
    const kind = kindForSize(size);
    const home = id === homeId;
    return {
      id,
      size,
      kind,
      cx: best[id].i % width,
      cy: Math.floor(best[id].i / width),
      home,
      suggestedName: home ? 'The Old Country' : id === farId ? 'The Farther Shore' : suggestName(rng, kind, used),
      name: home ? 'The Old Country' : '',
      forage: rng.range(0.6, 1.4),
      discovered: home,
      farShore: id === farId || undefined,
    };
  });

  placeReefs(world, rng);
  placeIce(world, rng);
  placeSites(world, rng);
  placeWrecks(world, rng);
  return world;
}

/**
 * Water in the first sea that connects to home only through the seas beyond would be out of
 * reach until the far port is found. Small pockets become land; larger ones get a strait cut.
 */
function joinFirstSeaPockets(cells: Uint8Array, width: number, sea: Rect, home: { x: number; y: number }) {
  for (let pass = 0; pass < 20; pass++) {
    const seen = new Uint8Array(cells.length);
    const flood = (start: number, mark: number[]) => {
      const stack = [start];
      seen[start] = 1;
      while (stack.length) {
        const i = stack.pop()!;
        mark.push(i);
        const x = i % width;
        const y = Math.floor(i / width);
        for (const [dx, dy] of DIRS4) {
          const nx = x + dx;
          const ny = y + dy;
          if (!inRect(sea, nx, ny)) continue;
          const j = ny * width + nx;
          if (!seen[j] && cells[j] !== Cell.Land) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    };
    flood(home.y * width + home.x, []);
    let pocket: number[] | null = null;
    for (let y = sea.y0; y < sea.y1 && !pocket; y++) {
      for (let x = sea.x0; x < sea.x1; x++) {
        const i = y * width + x;
        if (seen[i] || cells[i] === Cell.Land) continue;
        const cellsIn: number[] = [];
        flood(i, cellsIn);
        if (cellsIn.length < 6) {
          for (const j of cellsIn) cells[j] = Cell.Land;
          continue;
        }
        pocket = cellsIn;
        break;
      }
    }
    if (!pocket) return;
    const start = pocket[Math.floor(pocket.length / 2)];
    connectWithinFirstSea(cells, width, sea, home, { x: start % width, y: Math.floor(start / width) });
  }
}

/** Make sure the far port can be reached from home without leaving the first sea, cutting a strait if needed. */
function connectWithinFirstSea(cells: Uint8Array, width: number, sea: Rect, from: { x: number; y: number }, to: { x: number; y: number }) {
  const seen = new Uint8Array(cells.length);
  const stack = [from.y * width + from.x];
  seen[stack[0]] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % width;
    const y = Math.floor(i / width);
    for (const [dx, dy] of DIRS4) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inRect(sea, nx, ny)) continue;
      const j = ny * width + nx;
      if (!seen[j] && cells[j] !== Cell.Land) {
        seen[j] = 1;
        stack.push(j);
      }
    }
  }
  // Walk from the far dock toward the middle of the first sea until we meet water reachable from home.
  let x = to.x;
  let y = to.y;
  const tx = Math.round((sea.x0 + sea.x1) / 2);
  const ty = Math.round((sea.y0 + sea.y1) / 2);
  while (!seen[y * width + x] && (x !== tx || y !== ty)) {
    cells[y * width + x] = Cell.Sea;
    if (Math.abs(tx - x) > Math.abs(ty - y)) x += Math.sign(tx - x);
    else y += Math.sign(ty - y);
  }
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

function nearDock(world: World, x: number, y: number, r: number): boolean {
  return world.ports.some((p) => Math.abs(p.dock.x - x) <= r && Math.abs(p.dock.y - y) <= r);
}

function placeReefs(world: World, rng: Rng) {
  for (let y = 1; y < world.height - 1; y++) {
    for (let x = 24; x < world.width; x++) {
      if (cellAt(world, x, y) !== Cell.Sea) continue;
      if (!nearLand(world, x, y, 2) || nearDock(world, x, y, 7)) continue;
      const p = 0.03 + 0.07 * depth(world, x, y);
      if (rng.chance(p)) world.cells[idx(world, x, y)] = Cell.Reef;
    }
  }
}

/** Ice floes in the cold northern sea, in small clusters away from the coast. */
function placeIce(world: World, rng: Rng) {
  if (!rowIsCold(world)) return;
  for (let y = 1; y < world.firstSea.y0 - 1; y++) {
    for (let x = 20; x < world.firstSea.x1; x++) {
      if (cellAt(world, x, y) !== Cell.Sea || nearLand(world, x, y, 1)) continue;
      // Thicker toward the top of the world.
      const p = 0.012 * (1.5 - y / world.firstSea.y0);
      if (!rng.chance(p)) continue;
      world.cells[idx(world, x, y)] = Cell.Ice;
      const [dx, dy] = rng.pick(DIRS4);
      if (cellAt(world, x + dx, y + dy) === Cell.Sea) world.cells[idx(world, x + dx, y + dy)] = Cell.Ice;
    }
  }
}

/** Ice drifts a cell each season into open water nearby. */
export function driftIce(world: World, rng: Rng) {
  const floes: number[] = [];
  for (let i = 0; i < world.cells.length; i++) if (world.cells[i] === Cell.Ice) floes.push(i);
  for (const i of floes) {
    const x = i % world.width;
    const y = Math.floor(i / world.width);
    const [dx, dy] = rng.pick(DIRS4);
    const nx = x + dx;
    const ny = y + dy;
    if (!inBounds(world, nx, ny) || ny >= world.firstSea.y0 || world.cells[idx(world, nx, ny)] !== Cell.Sea) continue;
    if (nearLand(world, nx, ny, 1)) continue;
    world.cells[i] = Cell.Sea;
    world.cells[idx(world, nx, ny)] = Cell.Ice;
  }
}

function siteType(world: World, rng: Rng, x: number, y: number): ResourceType {
  const region = regionOf(world, x, y);
  if (region === 'row') {
    return rowIsCold(world)
      ? rng.weighted<ResourceType>(RESOURCE_TYPES, [1, 1, 0.1, 0.05])
      : rng.weighted<ResourceType>(RESOURCE_TYPES, [0.3, 0.2, 1, 0.6]);
  }
  const d = depth(world, x, y);
  return rng.weighted<ResourceType>(RESOURCE_TYPES, [1.3 - d, 0.6, 0.15 + d, 0.05 + d * d]);
}

function placeSites(world: World, rng: Rng) {
  for (const lm of world.landmasses) {
    if (lm.home) continue;
    const coast: [number, number][] = [];
    for (let i = 0; i < world.cells.length; i++) {
      if (world.landmassOf[i] !== lm.id) continue;
      const x = i % world.width;
      const y = Math.floor(i / world.width);
      if (isCoast(world, x, y) && !nearDock(world, x, y, 6)) coast.push([x, y]);
    }
    if (!coast.length) continue;
    let count = Math.floor(coast.length / 14);
    if (count === 0 && rng.chance(0.65)) count = 1;
    count = Math.min(count, lm.farShore ? 12 : 5);
    const taken: [number, number][] = [];
    for (let k = 0; k < count; k++) {
      const [x, y] = rng.pick(coast);
      if (taken.some(([tx, ty]) => Math.abs(tx - x) + Math.abs(ty - y) < 6)) continue;
      taken.push([x, y]);
      const d = depth(world, x, y);
      const type = siteType(world, rng, x, y);
      const bonus = regionOf(world, x, y) === 'diagonal' ? 0.15 : 0;
      const richness = Math.min(1, Math.max(0, 0.2 + 0.6 * d + bonus + rng.range(-0.15, 0.2)));
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
  const fs = world.firstSea;
  const place = (count: number, ok: (x: number, y: number) => boolean) => {
    let tries = 0;
    let placed = 0;
    while (placed < count && tries++ < 4000) {
      const x = rng.int(2, world.width - 3);
      const y = rng.int(2, world.height - 3);
      if (!ok(x, y) || cellAt(world, x, y) !== Cell.Sea) continue;
      if (wrecks.some((w) => Math.abs(w.x - x) + Math.abs(w.y - y) < 15)) continue;
      wrecks.push({ x, y, looted: false, sighted: false });
      placed++;
    }
  };
  place(6, (x, y) => inRect(fs, x, y) && x >= 30);
  place(10, (x, y) => !inRect(fs, x, y));
  world.wrecks = wrecks;
}
