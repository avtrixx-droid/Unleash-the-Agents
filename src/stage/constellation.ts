// Canvas constellation for the big screen. Up to ~600 glowing nodes, spring
// physics, additive blending. Modes:
//   drift  – lobby: nodes float around their home positions
//   swirl  – matching: a spinning galaxy with flickering trial connections
//   settle – nodes gather into labelled clusters, pair links draw in
//   focus  – everything dims, the staged pair is pulled to the centre

export type Mode = "drift" | "swirl" | "settle" | "focus";

interface N {
  id: string;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hx: number; // home (0..1 normalised)
  hy: number;
  phase: number;
  speed: number;
  radius: number; // swirl orbit radius (normalised)
  angle: number;
  born: number;
  cluster: number | null;
  slot: number; // index inside cluster
  hue: string;
  alpha: number;
}

interface Link {
  a: N;
  b: N;
  color: string;
  born: number;
  staged: boolean;
}

const PALETTE = ["#a78bfa", "#7dd3fc", "#f9a8d4", "#c4b5fd", "#67e8f9", "#e9d5ff"];

export class Constellation {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private nodes = new Map<string, N>();
  private list: N[] = [];
  private links: Link[] = [];
  private flickers: { a: N; b: N; until: number }[] = [];
  private sprites = new Map<string, HTMLCanvasElement>();
  private stars: HTMLCanvasElement | null = null;
  private raf = 0;
  private mode: Mode = "drift";
  private modeSince = performance.now();
  private clusterLabels = new Map<number, string>();
  private clusterSizes = new Map<number, number>();
  private focus = new Set<string>();
  private dim = 0;
  private spawn = { x: 0.2, y: 0.5 };
  private reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  private layout = { cx: 0.5, cy: 0.5, rx: 0.36, ry: 0.32 };
  onFrame?: (count: number) => void;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    this.resize();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(1, rect.width);
    this.h = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.stars = this.makeStars();
  }

  /** Where new nodes fly in from (normalised screen coords), e.g. the QR code. */
  setSpawn(x: number, y: number) {
    this.spawn = { x, y };
  }

  /** Where the swirl / clusters sit (normalised), e.g. left of a side panel. */
  setLayout(l: { cx: number; cy: number; rx: number; ry: number }) {
    this.layout = l;
  }

  setMode(mode: Mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.modeSince = performance.now();
    if (mode === "swirl") for (const n of this.list) n.angle = Math.atan2(n.y - this.h / 2, n.x - this.w / 2);
  }

  setNodes(rows: { id: string; display_name: string }[], animateNew = true) {
    const keep = new Set(rows.map((r) => r.id));
    for (const n of this.list) if (!keep.has(n.id)) this.nodes.delete(n.id);
    for (const r of rows) if (!this.nodes.has(r.id)) this.add(r.id, r.display_name, animateNew);
    this.list = [...this.nodes.values()];
    this.links = this.links.filter((l) => this.nodes.has(l.a.id) && this.nodes.has(l.b.id));
  }

  addNode(id: string, name: string) {
    if (this.nodes.has(id)) return;
    this.add(id, name, true);
    this.list = [...this.nodes.values()];
  }

  private add(id: string, name: string, animate: boolean) {
    // Home positions: sunflower spiral over an ellipse, so nodes spread evenly.
    const i = this.nodes.size;
    const golden = Math.PI * (3 - Math.sqrt(5));
    const r = Math.sqrt((i + 0.5) / 620);
    const a = i * golden;
    const jitter = () => (Math.random() - 0.5) * 0.03;
    const hx = 0.5 + Math.cos(a) * r * 0.47 + jitter();
    const hy = 0.5 + Math.sin(a) * r * 0.46 + jitter();
    const now = performance.now();
    const n: N = {
      id,
      name,
      x: animate ? this.spawn.x * this.w : hx * this.w,
      y: animate ? this.spawn.y * this.h : hy * this.h,
      vx: animate ? (Math.random() - 0.5) * 18 : 0,
      vy: animate ? (Math.random() - 0.5) * 18 : 0,
      hx,
      hy,
      phase: Math.random() * Math.PI * 2,
      speed: 0.25 + Math.random() * 0.5,
      radius: 0.08 + Math.sqrt(Math.random()) * 0.36,
      angle: Math.random() * Math.PI * 2,
      born: animate ? now : now - 10_000,
      cluster: null,
      slot: 0,
      hue: PALETTE[Math.floor(Math.random() * PALETTE.length)],
      alpha: 1,
    };
    this.nodes.set(id, n);
  }

  setClusters(assign: Map<string, number>, labels: Map<number, string>) {
    this.clusterLabels = labels;
    this.clusterSizes = new Map();
    const counters = new Map<number, number>();
    for (const n of this.list) {
      const c = assign.get(n.id) ?? null;
      n.cluster = c;
      if (c != null) {
        n.slot = counters.get(c) ?? 0;
        counters.set(c, n.slot + 1);
      }
    }
    this.clusterSizes = counters;
  }

  setLinks(pairs: { ids: string[]; color: string; staged: boolean }[], stagger = 0) {
    const now = performance.now();
    this.links = [];
    pairs.forEach((p, i) => {
      for (let k = 1; k < p.ids.length; k++) {
        const a = this.nodes.get(p.ids[0]);
        const b = this.nodes.get(p.ids[k]);
        if (a && b) this.links.push({ a, b, color: p.color, born: now + i * stagger, staged: p.staged });
      }
    });
  }

  setFocus(ids: string[]) {
    this.focus = new Set(ids);
  }

  clearLinks() {
    this.links = [];
  }

  // ---------------------------------------------------------------------------

  private clusterCentre(c: number): { x: number; y: number } {
    const { cx, cy, rx, ry } = this.layout;
    const count = Math.max(1, this.clusterSizes.size);
    if (count === 1) return { x: this.w * cx, y: this.h * cy };
    const a = -Math.PI / 2 + (c / count) * Math.PI * 2;
    return { x: this.w * (cx + Math.cos(a) * rx), y: this.h * (cy + Math.sin(a) * ry) };
  }

  /** Sunflower spacing inside a cluster: ~constant density, radius grows with √size. */
  private get spacing() {
    return Math.max(7, Math.min(this.w, this.h) * 0.0105);
  }

  private target(n: N, t: number, i: number): { x: number; y: number; k: number } {
    const since = (t - this.modeSince) / 1000;
    if (this.mode === "swirl") {
      const spin = Math.min(1, since / 6);
      const omega = (0.15 + spin * 1.1) / (0.4 + n.radius * 2.2);
      n.angle += omega * 0.016;
      const breathe = 1 + Math.sin(t / 900 + n.phase) * 0.04;
      const r = n.radius * this.h * this.layout.ry * 2.6 * breathe * (1 - spin * 0.25);
      return { x: this.w * this.layout.cx + Math.cos(n.angle) * r * 1.25, y: this.h * this.layout.cy + Math.sin(n.angle) * r, k: 0.04 };
    }
    if ((this.mode === "settle" || this.mode === "focus") && n.cluster != null) {
      if (this.mode === "focus" && this.focus.has(n.id)) {
        const idx = [...this.focus].indexOf(n.id);
        const total = this.focus.size;
        const x = this.w * (0.5 + (idx - (total - 1) / 2) * 0.36);
        return { x, y: this.h * 0.24 + Math.sin(t / 700 + idx) * 4, k: 0.035 };
      }
      const c = this.clusterCentre(n.cluster);
      const golden = Math.PI * (3 - Math.sqrt(5));
      const r = this.spacing * Math.sqrt(n.slot + 0.5);
      const a = n.slot * golden + t / 9000;
      return { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r * 0.85, k: 0.03 };
    }
    // drift
    const wob = this.reduced ? 0 : 1;
    const x = n.hx * this.w + Math.sin(t / 1000 * n.speed + n.phase) * 14 * wob;
    const y = n.hy * this.h + Math.cos(t / 1300 * n.speed + n.phase * 1.3 + i) * 10 * wob;
    return { x, y, k: 0.012 };
  }

  private sprite(color: string): HTMLCanvasElement {
    let s = this.sprites.get(color);
    if (s) return s;
    s = document.createElement("canvas");
    const size = 64;
    s.width = s.height = size;
    const g = s.getContext("2d")!;
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.12, color);
    grad.addColorStop(0.35, color + "55");
    grad.addColorStop(1, color + "00");
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    this.sprites.set(color, s);
    return s;
  }

  private makeStars(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = Math.round(this.w * this.dpr);
    c.height = Math.round(this.h * this.dpr);
    const g = c.getContext("2d")!;
    g.scale(this.dpr, this.dpr);
    for (let i = 0; i < (this.w * this.h) / 2600; i++) {
      g.fillStyle = `rgba(200,210,255,${Math.random() * 0.35})`;
      const r = Math.random() * 1.1;
      g.beginPath();
      g.arc(Math.random() * this.w, Math.random() * this.h, r, 0, Math.PI * 2);
      g.fill();
    }
    return c;
  }

  private loop(t: number) {
    this.raf = requestAnimationFrame(this.loop);
    const ctx = this.ctx;
    const { w, h } = this;
    const targetDim = this.mode === "focus" ? 0.82 : 0;
    this.dim += (targetDim - this.dim) * 0.04;

    // Background: motion trails while swirling, clean frames otherwise.
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = this.mode === "swirl" && !this.reduced ? "rgba(5,6,10,0.28)" : "rgba(5,6,10,1)";
    ctx.fillRect(0, 0, w, h);
    if (this.stars) {
      ctx.globalAlpha = 0.9;
      ctx.drawImage(this.stars, 0, 0, w, h);
      ctx.globalAlpha = 1;
    }

    // Physics
    const list = this.list;
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      const tg = this.target(n, t, i);
      n.vx = (n.vx + (tg.x - n.x) * tg.k) * 0.88;
      n.vy = (n.vy + (tg.y - n.y) * tg.k) * 0.88;
      n.x += n.vx;
      n.y += n.vy;
      const focused = this.focus.has(n.id) && this.mode === "focus";
      const wantAlpha = focused ? 1 : 1 - this.dim;
      n.alpha += (wantAlpha - n.alpha) * 0.08;
    }

    ctx.globalCompositeOperation = "lighter";

    // Flickering trial connections while swirling
    if (this.mode === "swirl" && list.length > 1) {
      const spawnCount = Math.min(6, Math.ceil(list.length / 80));
      for (let s = 0; s < spawnCount; s++) {
        const a = list[Math.floor(Math.random() * list.length)];
        const b = list[Math.floor(Math.random() * list.length)];
        if (a !== b) this.flickers.push({ a, b, until: t + 120 + Math.random() * 380 });
      }
      this.flickers = this.flickers.filter((f) => f.until > t);
      ctx.lineWidth = 1;
      for (const f of this.flickers) {
        const life = (f.until - t) / 500;
        ctx.strokeStyle = `rgba(125,211,252,${0.35 * life})`;
        ctx.beginPath();
        ctx.moveTo(f.a.x, f.a.y);
        ctx.lineTo(f.b.x, f.b.y);
        ctx.stroke();
      }
    } else if (this.flickers.length) this.flickers = [];

    // Pair links (draw-in animation)
    for (const l of this.links) {
      if (t < l.born) continue;
      const p = Math.min(1, (t - l.born) / 700);
      const ease = 1 - Math.pow(1 - p, 3);
      const focusLink = this.mode === "focus" && l.staged;
      const alpha = (focusLink ? 0.95 : 0.4) * Math.min(l.a.alpha, l.b.alpha) * ease + (focusLink ? 0 : 0);
      if (alpha < 0.01) continue;
      const x2 = l.a.x + (l.b.x - l.a.x) * ease;
      const y2 = l.a.y + (l.b.y - l.a.y) * ease;
      const grad = ctx.createLinearGradient(l.a.x, l.a.y, x2, y2);
      grad.addColorStop(0, l.color + "00");
      grad.addColorStop(0.5, l.color);
      grad.addColorStop(1, l.color + "00");
      ctx.strokeStyle = grad;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = focusLink ? 3 : 1.2;
      ctx.beginPath();
      ctx.moveTo(l.a.x, l.a.y);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      if (focusLink) {
        // energy pulse travelling along the staged beam
        const q = ((t / 1400) % 1 + 1) % 1;
        const px = l.a.x + (l.b.x - l.a.x) * q;
        const py = l.a.y + (l.b.y - l.a.y) * q;
        ctx.globalAlpha = 1;
        ctx.drawImage(this.sprite("#fbbf24"), px - 24, py - 24, 48, 48);
      }
      ctx.globalAlpha = 1;
    }

    // Nodes
    for (const n of list) {
      const age = (t - n.born) / 1000;
      const focused = this.mode === "focus" && this.focus.has(n.id);
      const size = focused ? 70 + Math.sin(t / 300) * 6 : 15 + (age < 1.2 ? (1.2 - age) * 30 : 0);
      ctx.globalAlpha = Math.max(0, Math.min(1, n.alpha));
      ctx.drawImage(this.sprite(focused ? "#fbbf24" : n.hue), n.x - size / 2, n.y - size / 2, size, size);
      if (age > 0 && age < 1.6 && !this.reduced) {
        // arrival ring
        const rr = age * 50;
        ctx.globalAlpha = Math.max(0, 0.5 - age / 3.2);
        ctx.strokeStyle = n.hue;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(n.x, n.y, rr, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    // Names of the newest arrivals (lobby) and cluster labels (settled)
    if (this.mode === "drift") {
      ctx.font = "500 13px Inter, sans-serif";
      ctx.textAlign = "left";
      const recent = list.filter((n) => t - n.born < 5000).slice(-10);
      for (const n of recent) {
        const age = Math.max(0, (t - n.born) / 1000);
        const a = age < 0.6 ? age / 0.6 : Math.max(0, 1 - (age - 3.5) / 1.5);
        ctx.fillStyle = `rgba(238,241,255,${0.85 * a})`;
        ctx.fillText(n.name, n.x + 11, n.y + 4);
      }
    } else if (this.mode === "settle" && this.clusterLabels.size) {
      const since = (t - this.modeSince) / 1000;
      const a = Math.min(1, Math.max(0, (since - 1.2) / 1.2));
      ctx.textAlign = "center";
      for (const [c, label] of this.clusterLabels) {
        const size = this.clusterSizes.get(c) ?? 0;
        if (!size) continue;
        const centre = this.clusterCentre(c);
        const y = centre.y + this.spacing * Math.sqrt(size) * 0.85 + 22;
        ctx.font = "600 15px 'Space Grotesk', sans-serif";
        ctx.fillStyle = `rgba(255,255,255,${0.92 * a})`;
        ctx.fillText(label, centre.x, y);
        ctx.font = "500 11px 'JetBrains Mono', monospace";
        ctx.fillStyle = `rgba(165,173,198,${0.8 * a})`;
        ctx.fillText(`${size} builders`, centre.x, y + 17);
      }
    }
    this.onFrame?.(list.length);
  }
}
