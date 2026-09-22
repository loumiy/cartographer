import { CONFIG } from '../game/config';
import { daysOfStores, isSecret, sightRadius, unitPrice } from '../game/core';
import { Cell, type GameState, type Site } from '../game/types';
import { idx } from '../game/world';
import { readPalette, type Palette } from './palette';

type Pt = { x: number; y: number };

const REVEAL_MS = 400;

/**
 * The chart: a canvas that fills the view. A static layer (washes, fog, coasts) is cached
 * and rebuilt when the chart changes; symbols and the ship are drawn over it every frame.
 */
export class Chart {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private layer = document.createElement('canvas');
  private palette: Palette = readPalette();
  private knownCount = -1;
  private namesKey = '';
  private cell = 8;
  private ox = 0;
  private oy = 0;
  private dpr = 1;
  private knownSnapshot: Uint8Array | null = null;
  private recent: { i: number; t: number }[] = [];
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  hover: Pt | null = null;
  /** Contract region previewed from the port ledger. */
  preview: { x: number; y: number; r: number } | null = null;

  constructor(private host: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'chart-canvas';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'Sea chart. Click to plot a course.');
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
  }

  refreshPalette() {
    this.palette = readPalette();
    this.knownCount = -1;
  }

  private resize() {
    const r = this.host.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.floor(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(r.height * this.dpr));
    this.canvas.style.width = `${r.width}px`;
    this.canvas.style.height = `${r.height}px`;
    this.cell = Math.min(r.width / CONFIG.width, r.height / CONFIG.height);
    this.ox = (r.width - this.cell * CONFIG.width) / 2;
    this.oy = (r.height - this.cell * CONFIG.height) / 2;
    this.knownCount = -1;
  }

  /** Screen (CSS px, relative to canvas) to chart cell coordinates. */
  toCell(px: number, py: number): Pt {
    return { x: (px - this.ox) / this.cell, y: (py - this.oy) / this.cell };
  }

  toScreen(p: Pt): Pt {
    return { x: this.ox + p.x * this.cell, y: this.oy + p.y * this.cell };
  }

  /** Screen position of the ship, for placing the event card away from it. */
  shipScreen(state: GameState): Pt {
    return this.toScreen(state.ship);
  }

  siteAt(state: GameState, p: Pt): Site | null {
    const reach = Math.max(1, 16 / this.cell);
    let best: Site | null = null;
    let bestD = reach;
    for (const s of state.world.sites) {
      if (!s.surveyed) continue;
      const d = Math.hypot(s.x + 0.5 - p.x, s.y + 0.5 - p.y);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  draw(state: GameState, shipPos: Pt, now: number) {
    const count = state.stats.cellsCharted;
    const names = state.world.landmasses.map((l) => (l.discovered ? l.name || '?' : '')).join('|');
    if (count !== this.knownCount || names !== this.namesKey) {
      this.trackReveals(state, now);
      this.buildLayer(state);
      this.knownCount = count;
      this.namesKey = names;
    }
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.layer, 0, 0, this.canvas.width / this.dpr, this.canvas.height / this.dpr);
    this.drawRevealFade(now);
    this.drawOverlays(state, shipPos);
  }

  // -------------------------------------------------------------------------
  // Static layer
  // -------------------------------------------------------------------------

  private trackReveals(state: GameState, now: number) {
    const known = state.known;
    if (this.knownSnapshot && this.knownSnapshot.length === known.length && !this.reducedMotion) {
      for (let i = 0; i < known.length; i++) {
        if (known[i] && !this.knownSnapshot[i]) this.recent.push({ i, t: now });
      }
    }
    this.knownSnapshot = known.slice();
  }

  /** Newly charted cells start under fog and the fog fades off them: ink arriving on the page. */
  private drawRevealFade(now: number) {
    if (!this.recent.length) return;
    const ctx = this.ctx;
    const c = this.cell;
    const w = CONFIG.width;
    this.recent = this.recent.filter((r) => now - r.t < REVEAL_MS);
    ctx.fillStyle = this.palette.fog;
    for (const r of this.recent) {
      ctx.globalAlpha = 1 - (now - r.t) / REVEAL_MS;
      ctx.fillRect(this.ox + (r.i % w) * c - 0.5, this.oy + Math.floor(r.i / w) * c - 0.5, c + 1, c + 1);
    }
    ctx.globalAlpha = 1;
  }

  private buildLayer(state: GameState) {
    const { world, known } = state;
    const p = this.palette;
    this.layer.width = this.canvas.width;
    this.layer.height = this.canvas.height;
    const ctx = this.layer.getContext('2d')!;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const c = this.cell;
    const W = world.width;
    const H = world.height;
    const cssW = this.canvas.width / this.dpr;
    const cssH = this.canvas.height / this.dpr;

    // 1. Vellum ground, then fog with a 45° hatch over the chart area.
    ctx.fillStyle = p.vellum;
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.ox, this.oy, W * c, H * c);
    ctx.clip();
    ctx.fillStyle = p.fog;
    ctx.fillRect(this.ox, this.oy, W * c, H * c);
    ctx.strokeStyle = p.inkFaint;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let d = -cssH; d < cssW + cssH; d += 6) {
      ctx.moveTo(d, 0);
      ctx.lineTo(d + cssH, cssH);
    }
    ctx.stroke();

    // 2. Sea wash on charted water: soft round dabs so the edge of the known is not a grid.
    ctx.fillStyle = p.sea;
    ctx.beginPath();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!known[i] || world.cells[i] === Cell.Land) continue;
        const cx = this.ox + (x + 0.5) * c;
        const cy = this.oy + (y + 0.5) * c;
        ctx.moveTo(cx + c * 0.78, cy);
        ctx.arc(cx, cy, c * 0.78, 0, Math.PI * 2);
      }
    }
    ctx.fill();

    // 3. Rhumb lines from the home-port rose.
    const rose = this.toScreen({ x: world.homePort.x + 0.5, y: world.homePort.y + 0.5 });
    ctx.strokeStyle = p.inkFaint;
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    const len = Math.hypot(cssW, cssH);
    for (let k = 0; k < 16; k++) {
      const a = (k * Math.PI) / 8;
      ctx.moveTo(rose.x, rose.y);
      ctx.lineTo(rose.x + Math.cos(a) * len, rose.y + Math.sin(a) * len);
    }
    ctx.stroke();

    // 4. Land wash and coastline, contoured through cell centres (marching squares).
    // Beyond the frame, repeat the edge cell so coasts do not run along the border.
    const clampX = (x: number) => Math.min(W - 1, Math.max(0, x));
    const clampY = (y: number) => Math.min(H - 1, Math.max(0, y));
    const landAt = (x: number, y: number) => {
      const i = clampY(y) * W + clampX(x);
      return known[i] && world.cells[i] === Cell.Land ? 1 : 0;
    };
    const knownAt = (x: number, y: number) => known[clampY(y) * W + clampX(x)] === 1;
    const land = new Path2D();
    const coast = new Path2D();
    for (let y = -1; y < H; y++) {
      for (let x = -1; x < W; x++) {
        const tl = landAt(x, y);
        const tr = landAt(x + 1, y);
        const br = landAt(x + 1, y + 1);
        const bl = landAt(x, y + 1);
        const code = tl | (tr << 1) | (br << 2) | (bl << 3);
        if (code === 0) continue;
        const X = (fx: number) => this.ox + (x + 0.5 + fx) * c;
        const Y = (fy: number) => this.oy + (y + 0.5 + fy) * c;
        // Walk the square: corners where land, edge midpoints where the edge crosses the coast.
        const poly: [number, number][] = [];
        if (tl) poly.push([X(0), Y(0)]);
        if (tl !== tr) poly.push([X(0.5), Y(0)]);
        if (tr) poly.push([X(1), Y(0)]);
        if (tr !== br) poly.push([X(1), Y(0.5)]);
        if (br) poly.push([X(1), Y(1)]);
        if (br !== bl) poly.push([X(0.5), Y(1)]);
        if (bl) poly.push([X(0), Y(1)]);
        if (bl !== tl) poly.push([X(0), Y(0.5)]);
        land.moveTo(poly[0][0], poly[0][1]);
        for (let k = 1; k < poly.length; k++) land.lineTo(poly[k][0], poly[k][1]);
        land.closePath();
        if (code === 15) continue;
        // Coast only where the sea side is charted too.
        if (!(knownAt(x, y) && knownAt(x + 1, y) && knownAt(x + 1, y + 1) && knownAt(x, y + 1))) continue;
        const mids: Record<string, [number, number]> = {
          t: [X(0.5), Y(0)],
          r: [X(1), Y(0.5)],
          b: [X(0.5), Y(1)],
          l: [X(0), Y(0.5)],
        };
        const segs = SEGMENTS[code];
        for (const [a, b] of segs) {
          coast.moveTo(mids[a][0], mids[a][1]);
          coast.lineTo(mids[b][0], mids[b][1]);
        }
      }
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Waterlining: two faint lines 3px and 7px seaward. Stroke wide, knock back with sea, then land covers the inland half.
    for (const [outer, gap] of [
      [7, 1],
      [3, 1],
    ]) {
      ctx.strokeStyle = p.inkFaint;
      ctx.lineWidth = outer * 2 + 1;
      ctx.stroke(coast);
      ctx.strokeStyle = p.sea;
      ctx.lineWidth = outer * 2 - gap;
      ctx.stroke(coast);
    }
    ctx.fillStyle = p.land;
    ctx.fill(land);
    ctx.strokeStyle = p.land;
    ctx.lineWidth = 0.6;
    ctx.stroke(land); // Hide hairline seams between squares.
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 1.5;
    ctx.stroke(coast);

    // Reefs: vermilion cross with a dot cluster.
    ctx.strokeStyle = p.vermilion;
    ctx.fillStyle = p.vermilion;
    ctx.lineWidth = 1.5;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = idx(world, x, y);
        if (!known[i] || world.cells[i] !== Cell.Reef) continue;
        const s = this.toScreen({ x: x + 0.5, y: y + 0.5 });
        const r = Math.max(2.5, c * 0.32);
        ctx.beginPath();
        ctx.moveTo(s.x - r, s.y);
        ctx.lineTo(s.x + r, s.y);
        ctx.moveTo(s.x, s.y - r);
        ctx.lineTo(s.x, s.y + r);
        ctx.stroke();
        for (const [dx, dy] of [
          [0.55, 0.55],
          [-0.5, 0.6],
          [0.6, -0.45],
        ]) {
          ctx.beginPath();
          ctx.arc(s.x + dx * r, s.y + dy * r, 0.9, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();

    // Home-port compass rose and name.
    drawRose(ctx, rose.x, rose.y, Math.max(10, c * 1.6), p);
    this.drawPlaceNames(ctx, state);
  }

  private drawPlaceNames(ctx: CanvasRenderingContext2D, state: GameState) {
    const p = this.palette;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const port = this.toScreen({ x: state.world.homePort.x + 0.5, y: state.world.homePort.y + 0.5 });
    ctx.font = `italic 18px ${p.fontDisplay}`;
    ctx.fillStyle = p.ink;
    ctx.textAlign = 'left';
    ctx.fillText(state.world.portName, port.x + 14, port.y - 16);
    ctx.textAlign = 'center';
    // Label each landmass at the middle of what has been charted of it, not of what is still fog.
    const { world, known } = state;
    const sums = world.landmasses.map(() => ({ x: 0, y: 0, n: 0, top: Infinity }));
    for (let i = 0; i < known.length; i++) {
      const id = world.landmassOf[i];
      if (id < 0 || !known[i]) continue;
      const s = sums[id];
      const y = Math.floor(i / world.width);
      s.x += i % world.width;
      s.y += y;
      s.n++;
      s.top = Math.min(s.top, y);
    }
    for (const lm of world.landmasses) {
      const sum = sums[lm.id];
      if (!lm.discovered || lm.home || !sum.n) continue;
      const big = lm.kind === 'coast' || lm.kind === 'large island';
      ctx.font = `italic ${big ? 18 : 14}px ${p.fontDisplay}`;
      ctx.fillStyle = lm.name ? p.ink : p.inkMuted;
      const label = lm.name || `Unnamed ${lm.kind}`;
      // Small or barely seen land carries its name just off the coast, above it.
      const small = sum.n < 16;
      const at = small ? { x: sum.x / sum.n + 0.5, y: sum.top } : { x: sum.x / sum.n + 0.5, y: sum.y / sum.n + 0.5 };
      const s = this.toScreen(at);
      ctx.fillText(label, s.x, small ? s.y - 10 : s.y);
    }
  }

  // -------------------------------------------------------------------------
  // Overlays: symbols, voyage lines, the ship
  // -------------------------------------------------------------------------

  private drawOverlays(state: GameState, shipPos: Pt) {
    const ctx = this.ctx;
    const p = this.palette;
    const c = this.cell;
    const v = state.voyage;

    // Point of no return: the range at which current stores still bring us home.
    const dock = this.toScreen({ x: state.world.dock.x + 0.5, y: state.world.dock.y + 0.5 });
    const days = v ? daysOfStores(state) : daysOfStores(state) / 2;
    if (Number.isFinite(days) && days > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(this.ox, this.oy, CONFIG.width * c, CONFIG.height * c);
      ctx.clip();
      ctx.strokeStyle = p.vermilion;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.arc(dock.x, dock.y, days * CONFIG.speedOpen * c, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Contract objective: dotted verdigris outline.
    const target = v?.contract?.target ?? state.accepted?.target ?? this.preview;
    if (target) {
      const t = this.toScreen({ x: target.x + 0.5, y: target.y + 0.5 });
      ctx.strokeStyle = p.verdigris;
      ctx.lineWidth = 2;
      ctx.setLineDash([2, 5]);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(t.x, t.y, (target.r + 0.5) * c, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Resource sites: gilt discs; kept secrets carry a seal ring.
    for (const s of state.world.sites) {
      if (!s.surveyed) continue;
      const pt = this.toScreen({ x: s.x + 0.5, y: s.y + 0.5 });
      ctx.fillStyle = p.gilt;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = p.ink;
      ctx.lineWidth = 1;
      ctx.stroke();
      if (isSecret(s)) {
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 8.5, 0, Math.PI * 2);
        ctx.stroke();
        // Seal ticks.
        for (let k = 0; k < 8; k++) {
          const a = (k * Math.PI) / 4;
          ctx.beginPath();
          ctx.moveTo(pt.x + Math.cos(a) * 8.5, pt.y + Math.sin(a) * 8.5);
          ctx.lineTo(pt.x + Math.cos(a) * 10.5, pt.y + Math.sin(a) * 10.5);
          ctx.stroke();
        }
      }
    }

    // Wrecks: broken hull glyph.
    for (const w of state.world.wrecks) {
      if (!w.sighted || w.looted) continue;
      drawWreck(ctx, this.toScreen({ x: w.x + 0.5, y: w.y + 0.5 }), p);
    }

    if (v) {
      // Track sailed: solid, muted.
      if (v.track.length > 1) {
        ctx.strokeStyle = p.inkMuted;
        ctx.lineWidth = 1;
        ctx.beginPath();
        v.track.forEach((pt, i) => {
          const s = this.toScreen(pt);
          if (i === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        });
        const sp = this.toScreen(shipPos);
        ctx.lineTo(sp.x, sp.y);
        ctx.stroke();
      }
      // Planned course: dashed ink 6/4.
      if (v.waypoints.length) {
        ctx.strokeStyle = p.ink;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        const sp = this.toScreen(shipPos);
        ctx.moveTo(sp.x, sp.y);
        for (const wp of v.waypoints) {
          const s = this.toScreen(wp);
          ctx.lineTo(s.x, s.y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        const end = this.toScreen(v.waypoints[v.waypoints.length - 1]);
        ctx.beginPath();
        ctx.moveTo(end.x - 4, end.y - 4);
        ctx.lineTo(end.x + 4, end.y + 4);
        ctx.moveTo(end.x + 4, end.y - 4);
        ctx.lineTo(end.x - 4, end.y + 4);
        ctx.stroke();
      }
      // Signs of land: small birds at the edge of sight, toward the land.
      if (v.sign) {
        const r = sightRadius(state) + 1.2;
        const a = Math.atan2(v.sign.y - state.ship.y, v.sign.x - state.ship.x);
        const at = this.toScreen({ x: shipPos.x + Math.cos(a) * r, y: shipPos.y + Math.sin(a) * r });
        drawBirds(ctx, at, p);
      }
    }

    drawShip(ctx, this.toScreen(shipPos), v?.waypoints[0] ? Math.atan2(v.waypoints[0].y - shipPos.y, v.waypoints[0].x - shipPos.x) : 0, p);

    // Hovered site: a caption beside it.
    if (this.hover) {
      const site = this.siteAt(state, this.hover);
      if (site) {
        const pt = this.toScreen({ x: site.x + 0.5, y: site.y + 0.5 });
        const label = `${CONFIG.resources[site.type].label}: ${site.stock}/${site.maxStock} units, £${unitPrice(site).toFixed(0)} each${
          isSecret(site) ? ' · secret' : site.knownBy > 1 ? ` · known to ${site.knownBy} ships` : ''
        }`;
        ctx.font = `500 14px ${p.fontBody}`;
        const w = ctx.measureText(label).width + 16;
        const x = Math.min(pt.x + 14, this.canvas.width / this.dpr - w - 4);
        ctx.fillStyle = p.vellumDeep;
        ctx.fillRect(x, pt.y - 13, w, 26);
        ctx.strokeStyle = p.ink;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, pt.y - 12.5, w - 1, 25);
        ctx.fillStyle = p.ink;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x + 8, pt.y);
      }
    }
  }
}

/** Coast segments per marching-squares case, as pairs of edge midpoints. Saddles keep land connected. */
const SEGMENTS: Record<number, [string, string][]> = {
  1: [['l', 't']],
  2: [['t', 'r']],
  3: [['l', 'r']],
  4: [['r', 'b']],
  5: [
    ['t', 'r'],
    ['b', 'l'],
  ],
  6: [['t', 'b']],
  7: [['l', 'b']],
  8: [['b', 'l']],
  9: [['t', 'b']],
  10: [
    ['l', 't'],
    ['r', 'b'],
  ],
  11: [['r', 'b']],
  12: [['l', 'r']],
  13: [['t', 'r']],
  14: [['l', 't']],
};

function drawRose(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, p: Palette) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = p.ink;
  ctx.fillStyle = p.vellum;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'miter';
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4 - Math.PI / 2;
    const len = k % 2 === 0 ? r : r * 0.6;
    const w = k % 2 === 0 ? r * 0.2 : r * 0.14;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * len, Math.sin(a) * len);
    ctx.lineTo(Math.cos(a + Math.PI / 2) * w, Math.sin(a + Math.PI / 2) * w);
    ctx.lineTo(0, 0);
    ctx.lineTo(Math.cos(a - Math.PI / 2) * w, Math.sin(a - Math.PI / 2) * w);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Half of each point inked in, as on engraved roses.
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * len, Math.sin(a) * len);
    ctx.lineTo(0, 0);
    ctx.lineTo(Math.cos(a - Math.PI / 2) * w, Math.sin(a - Math.PI / 2) * w);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = p.vellum;
  }
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawShip(ctx: CanvasRenderingContext2D, s: Pt, heading: number, p: Palette) {
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.fillStyle = p.vellum;
  ctx.strokeStyle = p.ink;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.rotate(heading);
  ctx.fillStyle = p.ink;
  ctx.beginPath();
  ctx.moveTo(8, 0);
  ctx.quadraticCurveTo(3, -4, -6, -3);
  ctx.lineTo(-6, 3);
  ctx.quadraticCurveTo(3, 4, 8, 0);
  ctx.fill();
  ctx.restore();
}

function drawWreck(ctx: CanvasRenderingContext2D, s: Pt, p: Palette) {
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.strokeStyle = p.ink;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'square';
  ctx.beginPath();
  // Two halves of a hull, broken in the middle, and a leaning mast.
  ctx.moveTo(-8, -1);
  ctx.quadraticCurveTo(-6, 4, -1, 4);
  ctx.moveTo(1, 2);
  ctx.quadraticCurveTo(6, 3, 8, -2);
  ctx.moveTo(-3, 3);
  ctx.lineTo(1, -6);
  ctx.stroke();
  ctx.restore();
}

function drawBirds(ctx: CanvasRenderingContext2D, s: Pt, p: Palette) {
  ctx.save();
  ctx.strokeStyle = p.inkMuted;
  ctx.lineWidth = 1.5;
  for (const [dx, dy, k] of [
    [0, 0, 1],
    [9, 5, 0.8],
    [-7, 6, 0.7],
  ]) {
    const x = s.x + dx;
    const y = s.y + dy;
    ctx.beginPath();
    ctx.moveTo(x - 5 * k, y);
    ctx.quadraticCurveTo(x - 2.5 * k, y - 4 * k, x, y);
    ctx.quadraticCurveTo(x + 2.5 * k, y - 4 * k, x + 5 * k, y);
    ctx.stroke();
  }
  ctx.restore();
}
