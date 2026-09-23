import { CONFIG } from '../game/config';
import { bounds, currentPort, daysOfStores, isSecret, knownPorts, sightRadius, unitPrice } from '../game/core';
import { Cell, type GameState, type Rect, type Site } from '../game/types';
import { readPalette, type Palette } from './palette';

type Pt = { x: number; y: number };

const REVEAL_MS = 400;
/** Screen px per cell that the chart's line weights are designed for (the V1 view). */
const REF_SCALE = 9;
const MAX_SCALE = 28;

interface Label {
  text: string;
  x: number;
  y: number;
  big: boolean;
  muted: boolean;
  /** Small land: set just above its coast rather than across it. */
  above: boolean;
}

/**
 * The chart: a canvas that fills the view, with pan and zoom. The static layer (washes, fog,
 * coasts, hazards) covers the sailable sea at a fixed resolution; it is redrawn only where the
 * chart changed. Symbols, names and the ship are drawn over it each frame in screen space.
 */
export class Chart {
  readonly canvas: HTMLCanvasElement;
  readonly controls: HTMLElement;
  private ctx: CanvasRenderingContext2D;
  private layer = document.createElement('canvas');
  private layerCtx = this.layer.getContext('2d')!;
  /** Layer px per cell. */
  private lp = 8;
  private layerRect: Rect | null = null;
  private palette: Palette = readPalette();
  private knownCount = -1;
  private seasonKey = -1;
  private dpr = 1;
  private cssW = 1;
  private cssH = 1;
  private knownSnapshot: Uint8Array | null = null;
  private recent: { i: number; t: number }[] = [];
  private labels: Label[] = [];
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private view = { x: 0, y: 0, scale: 8 };
  private viewRect: Rect | null = null;
  /** Keep the ship in view while sailing, until the player pans away. */
  follow = true;
  hover: Pt | null = null;
  /** Contract region previewed from the port ledger. */
  preview: { x: number; y: number; r: number } | null = null;
  onTap: (cell: Pt) => void = () => {};
  onRightTap: () => void = () => {};

  constructor(private host: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'chart-canvas';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'Sea chart. Click to plot a course; drag to pan; scroll to zoom.');
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.controls = this.buildControls();
    host.appendChild(this.controls);
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.bindInput();
  }

  refreshPalette() {
    this.palette = readPalette();
    this.layerRect = null;
  }

  private resize() {
    const r = this.host.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.cssW = Math.max(1, r.width);
    this.cssH = Math.max(1, r.height);
    this.canvas.width = Math.max(1, Math.floor(r.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(r.height * dpr));
    this.canvas.style.width = `${r.width}px`;
    this.canvas.style.height = `${r.height}px`;
    if (dpr !== this.dpr) {
      this.dpr = dpr;
      this.layerRect = null;
    }
    if (this.viewRect) this.clampView(this.viewRect);
  }

  // -------------------------------------------------------------------------
  // View: pan and zoom
  // -------------------------------------------------------------------------

  private fitScale(b: Rect): number {
    return Math.min(this.cssW / (b.x1 - b.x0), this.cssH / (b.y1 - b.y0));
  }

  private clampView(b: Rect) {
    const v = this.view;
    const fit = this.fitScale(b);
    v.scale = Math.min(Math.max(fit, MAX_SCALE), Math.max(fit, v.scale));
    const clampAxis = (pos: number, lo: number, hi: number, px: number) => {
      const span = px / v.scale;
      if (hi - lo <= span) return lo - (span - (hi - lo)) / 2;
      return Math.min(hi - span, Math.max(lo, pos));
    };
    v.x = clampAxis(v.x, b.x0, b.x1, this.cssW);
    v.y = clampAxis(v.y, b.y0, b.y1, this.cssH);
  }

  private zoomAt(px: number, py: number, factor: number) {
    const before = this.toCell(px, py);
    this.view.scale *= factor;
    if (this.viewRect) this.clampView(this.viewRect);
    this.view.x = before.x - px / this.view.scale;
    this.view.y = before.y - py / this.view.scale;
    if (this.viewRect) this.clampView(this.viewRect);
  }

  zoomBy(factor: number) {
    this.zoomAt(this.cssW / 2, this.cssH / 2, factor);
  }

  centreOn(p: Pt) {
    this.view.x = p.x - this.cssW / 2 / this.view.scale;
    this.view.y = p.y - this.cssH / 2 / this.view.scale;
    if (this.viewRect) this.clampView(this.viewRect);
  }

  /** Screen (CSS px, relative to canvas) to chart cell coordinates. */
  toCell(px: number, py: number): Pt {
    return { x: this.view.x + px / this.view.scale, y: this.view.y + py / this.view.scale };
  }

  toScreen(p: Pt): Pt {
    return { x: (p.x - this.view.x) * this.view.scale, y: (p.y - this.view.y) * this.view.scale };
  }

  /** Screen position of the ship, for placing the event card away from it. */
  shipScreen(state: GameState): Pt {
    return this.toScreen(state.ship);
  }

  private buildControls(): HTMLElement {
    const box = document.createElement('div');
    box.className = 'chart-controls';
    const mk = (label: string, title: string, fn: () => void, html?: string) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-secondary chart-btn';
      b.title = title;
      b.setAttribute('aria-label', title);
      if (html) b.innerHTML = html;
      else b.textContent = label;
      b.addEventListener('click', fn);
      box.appendChild(b);
      return b;
    };
    mk('+', 'Zoom in', () => this.zoomBy(1.4));
    mk('−', 'Zoom out', () => this.zoomBy(1 / 1.4));
    // A small engraved rose: re-centre on the ship.
    mk(
      '',
      'Centre on the ship',
      () => {
        this.follow = true;
        this.recentre = true;
      },
      '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"><path d="M12 2 L14 10 L22 12 L14 14 L12 22 L10 14 L2 12 L10 10 Z"/><circle cx="12" cy="12" r="1.5"/></svg>',
    );
    return box;
  }

  private recentre = true;

  private bindInput() {
    const c = this.canvas;
    const pointers = new Map<number, Pt>();
    let start: Pt | null = null;
    let dragged = false;
    let pinch = 0;
    const local = (e: PointerEvent | WheelEvent | MouseEvent) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      c.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, local(e));
      if (pointers.size === 1) {
        start = local(e);
        dragged = false;
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
        dragged = true;
      }
    });
    c.addEventListener('pointermove', (e) => {
      const p = local(e);
      this.hover = this.toCell(p.x, p.y);
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      pointers.set(e.pointerId, p);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0) this.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinch);
        pinch = d;
        return;
      }
      if (start && !dragged && Math.hypot(p.x - start.x, p.y - start.y) > 5) dragged = true;
      if (dragged) {
        this.view.x -= (p.x - prev.x) / this.view.scale;
        this.view.y -= (p.y - prev.y) / this.view.scale;
        if (this.viewRect) this.clampView(this.viewRect);
        this.follow = false;
        c.classList.add('dragging');
      }
    });
    const end = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      c.classList.remove('dragging');
      if (pointers.size === 0) {
        if (!dragged && e.type === 'pointerup') {
          const p = local(e);
          this.onTap(this.toCell(p.x, p.y));
        }
        start = null;
        pinch = 0;
      }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => {
      if (!pointers.size) this.hover = null;
    });
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.onRightTap();
    });
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const p = local(e);
        this.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
      },
      { passive: false },
    );
  }

  siteAt(state: GameState, p: Pt): Site | null {
    const reach = Math.max(1, 16 / this.view.scale);
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

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  draw(state: GameState, shipPos: Pt, now: number) {
    const b = bounds(state);
    const boundsChanged = !this.viewRect || this.viewRect.x1 !== b.x1 || this.viewRect.y1 !== b.y1 || this.viewRect.y0 !== b.y0;
    if (boundsChanged) {
      this.viewRect = b;
      this.view.scale = this.fitScale(b);
      this.clampView(b);
      this.follow = true;
      this.recentre = true;
    }
    const season = Math.floor(state.day / CONFIG.season);
    if (!this.layerRect || this.layerRect.x1 !== b.x1 || this.layerRect.y1 !== b.y1 || this.layerRect.y0 !== b.y0 || season !== this.seasonKey) {
      this.buildLayer(state, b);
      this.seasonKey = season;
      this.knownCount = state.stats.cellsCharted;
      this.knownSnapshot = state.known.slice();
      this.computeLabels(state);
    } else if (state.stats.cellsCharted !== this.knownCount) {
      this.updateLayer(state, now);
      this.knownCount = state.stats.cellsCharted;
    }

    // Keep the ship in view: glide toward it when zoomed in and following.
    if (this.follow && state.mode === 'sea') {
      const s = this.toScreen(shipPos);
      const margin = Math.min(this.cssW, this.cssH) * 0.2;
      const off = s.x < margin || s.y < margin || s.x > this.cssW - margin || s.y > this.cssH - margin;
      if (this.recentre || off) {
        const tx = shipPos.x - this.cssW / 2 / this.view.scale;
        const ty = shipPos.y - this.cssH / 2 / this.view.scale;
        const k = this.recentre ? 1 : 0.08;
        this.view.x += (tx - this.view.x) * k;
        this.view.y += (ty - this.view.y) * k;
        this.clampView(b);
        this.recentre = false;
      }
    } else if (this.recentre) {
      this.centreOn(state.ship);
      this.recentre = false;
    }

    const ctx = this.ctx;
    const p = this.palette;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = p.vellum;
    ctx.fillRect(0, 0, this.cssW, this.cssH);
    const lr = this.layerRect!;
    const tl = this.toScreen({ x: lr.x0, y: lr.y0 });
    const sc = this.view.scale;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.layer, tl.x, tl.y, (lr.x1 - lr.x0) * sc, (lr.y1 - lr.y0) * sc);
    this.drawRevealFade(now);
    this.drawOverlays(state, shipPos);
  }

  // -------------------------------------------------------------------------
  // Static layer
  // -------------------------------------------------------------------------

  private buildLayer(state: GameState, b: Rect) {
    this.lp = Math.min(14, Math.max(8, Math.round(8 * this.dpr)));
    this.layer.width = (b.x1 - b.x0) * this.lp;
    this.layer.height = (b.y1 - b.y0) * this.lp;
    this.layerCtx = this.layer.getContext('2d')!;
    this.layerRect = { ...b };
    this.paintRegion(state, b);
  }

  /** Redraw only around the cells charted since the last frame, and remember them for the fade-in. */
  private updateLayer(state: GameState, now: number) {
    const known = state.known;
    const snap = this.knownSnapshot;
    const W = state.world.width;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < known.length; i++) {
      if (!known[i] || (snap && snap[i])) continue;
      const x = i % W;
      const y = (i - x) / W;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
      if (!this.reducedMotion) this.recent.push({ i, t: now });
    }
    this.knownSnapshot = known.slice();
    if (x0 === Infinity) return;
    const pad = 3;
    const lr = this.layerRect!;
    this.paintRegion(state, {
      x0: Math.max(lr.x0, x0 - pad),
      y0: Math.max(lr.y0, y0 - pad),
      x1: Math.min(lr.x1, x1 + pad + 1),
      y1: Math.min(lr.y1, y1 + pad + 1),
    });
    this.computeLabels(state);
  }

  /** Newly charted cells start under fog and the fog fades off them: ink arriving on the page. */
  private drawRevealFade(now: number) {
    if (!this.recent.length) return;
    const ctx = this.ctx;
    const c = this.view.scale;
    const w = CONFIG.width;
    this.recent = this.recent.filter((r) => now - r.t < REVEAL_MS);
    ctx.fillStyle = this.palette.fog;
    for (const r of this.recent) {
      ctx.globalAlpha = 1 - (now - r.t) / REVEAL_MS;
      const s = this.toScreen({ x: r.i % w, y: Math.floor(r.i / w) });
      ctx.fillRect(s.x - 0.5, s.y - 0.5, c + 1, c + 1);
    }
    ctx.globalAlpha = 1;
  }

  /** Paint one rectangle of the layer, in layer coordinates (cells × lp). */
  private paintRegion(state: GameState, r: Rect) {
    const { world, known } = state;
    const p = this.palette;
    const ctx = this.layerCtx;
    const lr = this.layerRect!;
    const c = this.lp;
    const k = c / REF_SCALE;
    const W = world.width;
    const X = (x: number) => (x - lr.x0) * c;
    const Y = (y: number) => (y - lr.y0) * c;
    const layerW = this.layer.width;
    const layerH = this.layer.height;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    ctx.rect(X(r.x0), Y(r.y0), (r.x1 - r.x0) * c, (r.y1 - r.y0) * c);
    ctx.clip();

    // 1. Fog with a 45° hatch.
    ctx.fillStyle = p.fog;
    ctx.fillRect(X(r.x0), Y(r.y0), (r.x1 - r.x0) * c, (r.y1 - r.y0) * c);
    ctx.strokeStyle = p.inkFaint;
    ctx.lineWidth = Math.max(1, k);
    ctx.beginPath();
    const pitch = 6 * k;
    const top = Y(r.y0);
    const bottom = Y(r.y1);
    const h = bottom - top;
    const first = Math.floor((X(r.x0) - h - top) / pitch) * pitch + top;
    for (let d = first; d < X(r.x1) + h; d += pitch) {
      ctx.moveTo(d, top);
      ctx.lineTo(d + h, bottom);
    }
    ctx.stroke();

    // 2. Sea wash on charted water: soft round dabs so the edge of the known is not a grid.
    const ex0 = Math.max(0, r.x0 - 1);
    const ey0 = Math.max(0, r.y0 - 1);
    const ex1 = Math.min(world.width, r.x1 + 1);
    const ey1 = Math.min(world.height, r.y1 + 1);
    ctx.fillStyle = p.sea;
    ctx.beginPath();
    for (let y = ey0; y < ey1; y++) {
      for (let x = ex0; x < ex1; x++) {
        const i = y * W + x;
        if (!known[i] || world.cells[i] === Cell.Land) continue;
        const cx = X(x + 0.5);
        const cy = Y(y + 0.5);
        ctx.moveTo(cx + c * 0.78, cy);
        ctx.arc(cx, cy, c * 0.78, 0, Math.PI * 2);
      }
    }
    ctx.fill();

    // 3. Rhumb lines from the home-port rose.
    const home = world.ports[0];
    const rx = X(home.x + 0.5);
    const ry = Y(home.y + 0.5);
    ctx.strokeStyle = p.inkFaint;
    ctx.lineWidth = 0.75 * k;
    ctx.beginPath();
    const len = Math.hypot(layerW, layerH) * 1.5;
    for (let n = 0; n < 16; n++) {
      const a = (n * Math.PI) / 8;
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx + Math.cos(a) * len, ry + Math.sin(a) * len);
    }
    ctx.stroke();

    // 4. Land wash and coastline, contoured through cell centres (marching squares).
    // Beyond the world's edge, repeat the edge cell so coasts do not run along the border.
    const H = world.height;
    const clampX = (x: number) => Math.min(W - 1, Math.max(0, x));
    const clampY = (y: number) => Math.min(H - 1, Math.max(0, y));
    const landAt = (x: number, y: number) => {
      const i = clampY(y) * W + clampX(x);
      return known[i] && world.cells[i] === Cell.Land ? 1 : 0;
    };
    const knownAt = (x: number, y: number) => known[clampY(y) * W + clampX(x)] === 1;
    const land = new Path2D();
    const coast = new Path2D();
    for (let y = ey0 - 1; y < ey1; y++) {
      for (let x = ex0 - 1; x < ex1; x++) {
        const tl = landAt(x, y);
        const tr = landAt(x + 1, y);
        const br = landAt(x + 1, y + 1);
        const bl = landAt(x, y + 1);
        const code = tl | (tr << 1) | (br << 2) | (bl << 3);
        if (code === 0) continue;
        const PX = (fx: number) => X(x + 0.5 + fx);
        const PY = (fy: number) => Y(y + 0.5 + fy);
        // Walk the square: corners where land, edge midpoints where the edge crosses the coast.
        const poly: [number, number][] = [];
        if (tl) poly.push([PX(0), PY(0)]);
        if (tl !== tr) poly.push([PX(0.5), PY(0)]);
        if (tr) poly.push([PX(1), PY(0)]);
        if (tr !== br) poly.push([PX(1), PY(0.5)]);
        if (br) poly.push([PX(1), PY(1)]);
        if (br !== bl) poly.push([PX(0.5), PY(1)]);
        if (bl) poly.push([PX(0), PY(1)]);
        if (bl !== tl) poly.push([PX(0), PY(0.5)]);
        land.moveTo(poly[0][0], poly[0][1]);
        for (let n = 1; n < poly.length; n++) land.lineTo(poly[n][0], poly[n][1]);
        land.closePath();
        if (code === 15) continue;
        // Coast only where the sea side is charted too.
        if (!(knownAt(x, y) && knownAt(x + 1, y) && knownAt(x + 1, y + 1) && knownAt(x, y + 1))) continue;
        const mids: Record<string, [number, number]> = {
          t: [PX(0.5), PY(0)],
          r: [PX(1), PY(0.5)],
          b: [PX(0.5), PY(1)],
          l: [PX(0), PY(0.5)],
        };
        for (const [a, bb] of SEGMENTS[code]) {
          coast.moveTo(mids[a][0], mids[a][1]);
          coast.lineTo(mids[bb][0], mids[bb][1]);
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
      ctx.lineWidth = (outer * 2 + 1) * k;
      ctx.stroke(coast);
      ctx.strokeStyle = p.sea;
      ctx.lineWidth = (outer * 2 - gap) * k;
      ctx.stroke(coast);
    }
    ctx.fillStyle = p.land;
    ctx.fill(land);
    ctx.strokeStyle = p.land;
    ctx.lineWidth = 0.6 * k;
    ctx.stroke(land); // Hide hairline seams between squares.
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 1.5 * k;
    ctx.stroke(coast);

    // Hazards, in vermilion: reefs a cross with a dot cluster; ice an open diamond with a dot.
    ctx.strokeStyle = p.vermilion;
    ctx.fillStyle = p.vermilion;
    ctx.lineWidth = 1.5 * k;
    const hr = Math.max(2.5 * k, c * 0.32);
    for (let y = ey0; y < ey1; y++) {
      for (let x = ex0; x < ex1; x++) {
        const i = y * W + x;
        const cell = world.cells[i];
        if (!known[i] || (cell !== Cell.Reef && cell !== Cell.Ice)) continue;
        const sx = X(x + 0.5);
        const sy = Y(y + 0.5);
        ctx.beginPath();
        if (cell === Cell.Reef) {
          ctx.moveTo(sx - hr, sy);
          ctx.lineTo(sx + hr, sy);
          ctx.moveTo(sx, sy - hr);
          ctx.lineTo(sx, sy + hr);
          ctx.stroke();
          for (const [dx, dy] of [
            [0.55, 0.55],
            [-0.5, 0.6],
            [0.6, -0.45],
          ]) {
            ctx.beginPath();
            ctx.arc(sx + dx * hr, sy + dy * hr, 0.9 * k, 0, Math.PI * 2);
            ctx.fill();
          }
        } else {
          ctx.moveTo(sx, sy - hr);
          ctx.lineTo(sx + hr, sy);
          ctx.lineTo(sx, sy + hr);
          ctx.lineTo(sx - hr, sy);
          ctx.closePath();
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(sx, sy, 0.9 * k, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  /** Place names at the middle of what has been charted of each landmass, not of what is still fog. */
  private computeLabels(state: GameState) {
    const { world, known } = state;
    const sums = world.landmasses.map(() => ({ x: 0, y: 0, n: 0, top: Infinity, bottom: -Infinity }));
    for (let i = 0; i < known.length; i++) {
      const id = world.landmassOf[i];
      if (id < 0 || !known[i]) continue;
      const s = sums[id];
      const y = Math.floor(i / world.width);
      s.x += i % world.width;
      s.y += y;
      s.n++;
      s.top = Math.min(s.top, y);
      s.bottom = Math.max(s.bottom, y);
    }
    this.labels = [];
    // Larger land first: its names claim their place before small islands do.
    const order = world.landmasses.slice().sort((a, b) => sums[b.id].n - sums[a.id].n);
    for (const lm of order) {
      const sum = sums[lm.id];
      if (!lm.discovered || lm.home || !sum.n) continue;
      const small = sum.n < 16;
      // A continent along the world's edge: set the name on its seaward side.
      const cy = small ? sum.top : sum.y / sum.n + 0.5;
      this.labels.push({
        text: lm.name || `Unnamed ${lm.kind}`,
        x: sum.x / sum.n + 0.5,
        y: cy,
        big: lm.kind === 'coast' || lm.kind === 'large island',
        muted: !lm.name,
        above: small,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Overlays: names, symbols, voyage lines, the ship
  // -------------------------------------------------------------------------

  private drawNames(state: GameState) {
    const ctx = this.ctx;
    const p = this.palette;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const place = (text: string, s: Pt, size: number, color: string, align: 'center' | 'left' = 'center') => {
      ctx.font = `italic ${size}px ${p.fontDisplay}`;
      const w = ctx.measureText(text).width;
      const hgt = size + 4;
      const left = align === 'center' ? s.x - w / 2 : s.x;
      // Nudge the name up or down until it clears the names already set.
      let y = s.y;
      for (const dy of [0, -hgt, hgt, -2 * hgt, 2 * hgt]) {
        const r = { x: left, y: s.y + dy - hgt / 2, w, h: hgt };
        if (!placed.some((q) => r.x < q.x + q.w && q.x < r.x + r.w && r.y < q.y + q.h && q.y < r.y + r.h)) {
          y = s.y + dy;
          break;
        }
      }
      placed.push({ x: left, y: y - hgt / 2, w, h: hgt });
      ctx.fillStyle = color;
      ctx.textAlign = align;
      ctx.fillText(text, s.x, y);
    };
    for (const port of knownPorts(state)) {
      const s = this.toScreen({ x: port.x + 0.5, y: port.y + 0.5 });
      place(port.name, { x: s.x + 14, y: s.y - 16 }, 18, p.ink, 'left');
    }
    const sc = this.view.scale;
    for (const l of this.labels) {
      // Zoomed out, unnamed small land goes unlabelled so the chart stays legible.
      if (l.muted && !l.big && sc < (l.above ? 14 : 10)) continue;
      const s = this.toScreen({ x: l.x, y: l.y });
      place(l.text, { x: s.x, y: l.above ? s.y - 10 : s.y }, l.big ? 18 : 14, l.muted ? p.inkMuted : p.ink);
    }
  }

  private drawOverlays(state: GameState, shipPos: Pt) {
    const ctx = this.ctx;
    const p = this.palette;
    const c = this.view.scale;
    const v = state.voyage;
    const b = bounds(state);
    const tl = this.toScreen({ x: b.x0, y: b.y0 });
    const br = this.toScreen({ x: b.x1, y: b.y1 });

    // Point of no return: the range at which current stores still bring us to a port.
    const days = v ? daysOfStores(state) : daysOfStores(state) / 2;
    if (Number.isFinite(days) && days > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
      ctx.clip();
      ctx.strokeStyle = p.vermilion;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([8, 6]);
      const ports = v ? knownPorts(state) : [currentPort(state)];
      for (const port of ports) {
        const d = this.toScreen({ x: port.dock.x + 0.5, y: port.dock.y + 0.5 });
        ctx.beginPath();
        ctx.arc(d.x, d.y, days * CONFIG.speedOpen * c, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Contract objective: dotted verdigris outline.
    const contract = v?.contract ?? state.accepted;
    const target = contract?.target ?? this.preview;
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

    // A patron's post to be supplied: a small flag in the objective's verdigris.
    const post = contract?.kind === 'supply_post' && !contract.done ? contract.post : undefined;
    if (post) {
      const s = this.toScreen({ x: post.x + 0.5, y: post.y + 0.5 });
      ctx.strokeStyle = p.verdigris;
      ctx.fillStyle = p.verdigris;
      ctx.lineWidth = 2;
      ctx.setLineDash([2, 5]);
      ctx.beginPath();
      ctx.arc(s.x, s.y, Math.max(14, 3 * c), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(s.x - 3, s.y + 8);
      ctx.lineTo(s.x - 3, s.y - 8);
      ctx.stroke();
      ctx.fillRect(s.x - 3, s.y - 8, 9, 6);
    }

    // Our routes: verdigris, the ink of the known and safe.
    if (state.routes.length) {
      ctx.strokeStyle = p.verdigris;
      ctx.lineWidth = 1.5;
      for (const r of state.routes) {
        if (!r.path.length) continue;
        ctx.beginPath();
        r.path.forEach((pt, i) => {
          const s = this.toScreen(pt);
          if (i === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        });
        ctx.closePath();
        ctx.stroke();
      }
    }

    // Trading posts: a small storehouse beside the site; abandoned ones in muted, broken line.
    for (const post of state.posts) {
      const site = state.world.sites[post.siteId];
      drawPost(ctx, this.toScreen({ x: site.x + 0.5, y: site.y + 0.5 }), post.abandoned, p);
    }

    // Resource sites: gilt discs; kept secrets carry a seal ring.
    for (const s of state.world.sites) {
      if (!s.surveyed) continue;
      const pt = this.toScreen({ x: s.x + 0.5, y: s.y + 0.5 });
      if (pt.x < -20 || pt.y < -20 || pt.x > this.cssW + 20 || pt.y > this.cssH + 20) continue;
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
        for (let n = 0; n < 8; n++) {
          const a = (n * Math.PI) / 4;
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

    // Ports: the home rose, anchors for the others.
    for (const port of knownPorts(state)) {
      const s = this.toScreen({ x: port.x + 0.5, y: port.y + 0.5 });
      if (port.id === 0) drawRose(ctx, s.x, s.y, Math.max(10, Math.min(22, c * 1.6)), p);
      else drawAnchor(ctx, s, p);
    }

    this.drawNames(state);

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

    // Hovered site: a caption beside it, priced at the port we are in or last left.
    if (this.hover) {
      const site = this.siteAt(state, this.hover);
      if (site) {
        const pt = this.toScreen({ x: site.x + 0.5, y: site.y + 0.5 });
        const port = currentPort(state);
        const label = `${CONFIG.resources[site.type].label}: ${site.stock}/${site.maxStock} units, £${unitPrice(site, port).toFixed(0)} each at ${port.name}${
          isSecret(site) ? ' · secret' : site.knownBy > 1 ? ` · known to ${site.knownBy} ships` : ''
        }`;
        ctx.font = `500 14px ${p.fontBody}`;
        const w = ctx.measureText(label).width + 16;
        const x = Math.max(4, Math.min(pt.x + 14, this.cssW - w - 4));
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

/** A trading post: an engraved storehouse, set just above its site. */
function drawPost(ctx: CanvasRenderingContext2D, s: Pt, abandoned: boolean, p: Palette) {
  ctx.save();
  ctx.translate(s.x + 9, s.y - 12);
  ctx.strokeStyle = abandoned ? p.inkMuted : p.ink;
  ctx.fillStyle = p.vellum;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'miter';
  if (abandoned) ctx.setLineDash([2, 2]);
  ctx.beginPath();
  ctx.moveTo(-6, 6);
  ctx.lineTo(-6, -1);
  ctx.lineTo(0, -6);
  ctx.lineTo(6, -1);
  ctx.lineTo(6, 6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-2, 6);
  ctx.lineTo(-2, 2);
  ctx.lineTo(2, 2);
  ctx.lineTo(2, 6);
  ctx.stroke();
  ctx.restore();
}

/** Harbour: a small anchor, per the chart conventions. */
function drawAnchor(ctx: CanvasRenderingContext2D, s: Pt, p: Palette) {
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.fillStyle = p.vellum;
  ctx.strokeStyle = p.ink;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'square';
  ctx.beginPath();
  ctx.arc(0, -8, 2.5, 0, Math.PI * 2);
  ctx.moveTo(0, -5.5);
  ctx.lineTo(0, 9);
  ctx.moveTo(-5, -2);
  ctx.lineTo(5, -2);
  ctx.moveTo(-8, 3);
  ctx.quadraticCurveTo(-7, 9, 0, 9);
  ctx.quadraticCurveTo(7, 9, 8, 3);
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
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  // A hull seen side-on, broken by a jagged gap, with a toppled mast.
  ctx.moveTo(-10, 0);
  ctx.lineTo(-7, 5);
  ctx.lineTo(-2, 5);
  ctx.lineTo(-1, 2);
  ctx.lineTo(-3, 0);
  ctx.moveTo(1, 0);
  ctx.lineTo(2, 3);
  ctx.lineTo(1, 5);
  ctx.lineTo(7, 5);
  ctx.lineTo(10, 0);
  ctx.moveTo(-10, 0);
  ctx.lineTo(-3, 0);
  ctx.moveTo(1, 0);
  ctx.lineTo(10, 0);
  ctx.moveTo(4, 0);
  ctx.lineTo(9, -8);
  ctx.moveTo(5, -6);
  ctx.lineTo(9, -4);
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
