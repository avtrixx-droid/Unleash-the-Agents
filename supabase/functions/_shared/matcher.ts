// Pure matching engine: no I/O, no dependencies. Runs in Deno (edge function),
// in the browser (stage demo mode) and in Node (scripts/test-matcher.ts).

export interface Person {
  id: string;
  name: string;
  building: string;
  need: string;
  /** L2-normalised embedding of `building`. */
  b: Float32Array;
  /** L2-normalised embedding of `need`. */
  n: Float32Array;
}

export interface Group {
  members: number[]; // indices into the people array
  score: number; // mean pairwise score, 0..1-ish
  staged: boolean;
}

export interface MatchResult {
  groups: Group[];
  clusterOf: number[]; // person index -> cluster id
  clusterCount: number;
}

const BUILD_SIMILARITY_WEIGHT = 0.3;

export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function normalise(v: Float32Array): Float32Array {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const inv = s > 0 ? 1 / Math.sqrt(s) : 0;
  for (let i = 0; i < v.length; i++) v[i] *= inv;
  return v;
}

/**
 * Complementary score: what A needs vs what B builds, both ways, plus a
 * smaller bonus for building similar things. Symmetric n×n matrix.
 */
export function scoreMatrix(people: Person[]): Float32Array {
  const n = people.length;
  const s = new Float32Array(n * n);
  for (let i = 0; i < n; i++) {
    const pi = people[i];
    for (let j = i + 1; j < n; j++) {
      const pj = people[j];
      const v =
        (dot(pi.n, pj.b) + dot(pj.n, pi.b) + BUILD_SIMILARITY_WEIGHT * dot(pi.b, pj.b)) /
        (2 + BUILD_SIMILARITY_WEIGHT);
      s[i * n + j] = v;
      s[j * n + i] = v;
    }
  }
  return s;
}

/**
 * Everyone gets exactly one group. Groups are pairs; with an odd count one
 * group becomes a trio. `fixed` forces a staged pair.
 */
export function pairUp(n: number, s: Float32Array, fixed?: [number, number]): Group[] {
  const taken = new Uint8Array(n);
  const pairs: [number, number][] = [];
  let stagedPair: [number, number] | null = null;
  if (fixed && fixed[0] !== fixed[1] && fixed[0] >= 0 && fixed[1] >= 0 && fixed[0] < n && fixed[1] < n) {
    stagedPair = fixed;
    taken[fixed[0]] = taken[fixed[1]] = 1;
  }

  // Greedy: highest-scoring edges first.
  const edges: number[] = [];
  for (let i = 0; i < n; i++) {
    if (taken[i]) continue;
    for (let j = i + 1; j < n; j++) if (!taken[j]) edges.push(i * n + j);
  }
  edges.sort((x, y) => s[y] - s[x]);
  for (const e of edges) {
    const i = Math.floor(e / n);
    const j = e - i * n;
    if (taken[i] || taken[j]) continue;
    taken[i] = taken[j] = 1;
    pairs.push([i, j]);
  }

  // Local improvement: try swapping partners between two pairs.
  for (let pass = 0; pass < 4; pass++) {
    let improved = false;
    for (let p = 0; p < pairs.length; p++) {
      for (let q = p + 1; q < pairs.length; q++) {
        const [a, b] = pairs[p];
        const [c, d] = pairs[q];
        const cur = s[a * n + b] + s[c * n + d];
        const alt1 = s[a * n + c] + s[b * n + d];
        const alt2 = s[a * n + d] + s[b * n + c];
        if (alt1 > cur + 1e-6 && alt1 >= alt2) {
          pairs[p] = [a, c];
          pairs[q] = [b, d];
          improved = true;
        } else if (alt2 > cur + 1e-6) {
          pairs[p] = [a, d];
          pairs[q] = [b, c];
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  const groups: Group[] = pairs.map(([a, b]) => ({ members: [a, b], score: s[a * n + b], staged: false }));
  if (stagedPair) groups.unshift({ members: [...stagedPair], score: s[stagedPair[0] * n + stagedPair[1]], staged: true });

  // Odd one out joins the pair where they fit best (never the staged pair).
  for (let i = 0; i < n; i++) {
    if (taken[i]) continue;
    taken[i] = 1;
    let best = -1;
    let bestScore = -Infinity;
    groups.forEach((g, gi) => {
      if (g.staged && groups.length > 1) return;
      const sc = g.members.reduce((acc, m) => acc + s[i * n + m], 0) / g.members.length;
      if (sc > bestScore) {
        bestScore = sc;
        best = gi;
      }
    });
    if (best === -1) groups.push({ members: [i], score: 0, staged: false });
    else groups[best].members.push(i);
  }

  for (const g of groups) g.score = meanPairScore(g.members, n, s);
  return groups;
}

function meanPairScore(members: number[], n: number, s: Float32Array): number {
  if (members.length < 2) return 0;
  let t = 0;
  let c = 0;
  for (let i = 0; i < members.length; i++)
    for (let j = i + 1; j < members.length; j++) {
      t += s[members[i] * n + members[j]];
      c++;
    }
  return t / c;
}

/** Small deterministic PRNG so the same input gives the same clusters. */
export function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function clusterCountFor(n: number): number {
  if (n < 8) return 1;
  return Math.max(2, Math.min(12, Math.round(n / 25)));
}

/** Spherical k-means (k-means++ init) on the "building" embeddings. */
export function cluster(people: Person[], k: number, seed = 42): number[] {
  const n = people.length;
  if (n === 0) return [];
  k = Math.max(1, Math.min(k, n));
  const dim = people[0].b.length;
  const rand = rng(seed);
  const centres: Float32Array[] = [Float32Array.from(people[Math.floor(rand() * n)].b)];
  const dist = new Float64Array(n);
  while (centres.length < k) {
    let total = 0;
    for (let i = 0; i < n; i++) {
      let best = Infinity;
      for (const c of centres) best = Math.min(best, 1 - dot(people[i].b, c));
      dist[i] = Math.max(0, best) ** 2;
      total += dist[i];
    }
    let r = rand() * total;
    let pick = n - 1;
    for (let i = 0; i < n; i++) {
      r -= dist[i];
      if (r <= 0) {
        pick = i;
        break;
      }
    }
    centres.push(Float32Array.from(people[pick].b));
  }

  const assign = new Array<number>(n).fill(0);
  for (let iter = 0; iter < 25; iter++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestSim = -Infinity;
      for (let c = 0; c < k; c++) {
        const sim = dot(people[i].b, centres[c]);
        if (sim > bestSim) {
          bestSim = sim;
          best = c;
        }
      }
      if (assign[i] !== best) {
        assign[i] = best;
        changed = true;
      }
    }
    if (!changed && iter > 0) break;
    // Recompute centres in a single pass over people.
    const acc = Array.from({ length: k }, () => new Float32Array(dim));
    const counts = new Uint32Array(k);
    for (let i = 0; i < n; i++) {
      const a = acc[assign[i]];
      const v = people[i].b;
      counts[assign[i]]++;
      for (let d = 0; d < dim; d++) a[d] += v[d];
    }
    for (let c = 0; c < k; c++) if (counts[c] > 0) centres[c] = normalise(acc[c]);
  }

  // Re-number clusters by size (largest = 0) and drop empty ones.
  const sizes = new Map<number, number>();
  assign.forEach((c) => sizes.set(c, (sizes.get(c) ?? 0) + 1));
  const order = [...sizes.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const remap = new Map(order.map((c, i) => [c, i]));
  return assign.map((c) => remap.get(c)!);
}

export function runMatching(people: Person[], fixed?: [number, number]): MatchResult {
  const s = scoreMatrix(people);
  const groups = pairUp(people.length, s, fixed);
  const k = clusterCountFor(people.length);
  const clusterOf = cluster(people, k);
  return { groups, clusterOf, clusterCount: clusterOf.length ? Math.max(...clusterOf) + 1 : 0 };
}

/** Best existing group for a latecomer (prefers groups smaller than 4). */
export function bestGroupFor(late: Person, groups: { members: Person[]; staged?: boolean }[]): number {
  let best = -1;
  let bestScore = -Infinity;
  groups.forEach((g, gi) => {
    if (g.staged || g.members.length === 0) return;
    const sc =
      g.members.reduce(
        (acc, m) => acc + (dot(late.n, m.b) + dot(m.n, late.b) + BUILD_SIMILARITY_WEIGHT * dot(late.b, m.b)),
        0,
      ) /
        g.members.length -
      (g.members.length >= 4 ? 10 : g.members.length === 3 ? 0.05 : 0);
    if (sc > bestScore) {
      bestScore = sc;
      best = gi;
    }
  });
  return best;
}

// ---------------------------------------------------------------------------
// Text helpers: keyword extraction, a hashing fallback embedding and
// template copy used when no LLM is configured (or it fails).
// ---------------------------------------------------------------------------

const STOP = new Set(
  (
    "a an and are as at be been but by for from has have help how i i'm im in into is it its me my need needs of on or our so " +
    "that the their them this to want wants we what with you your building build built make making working work using use " +
    "app apps tool tools thing things some someone something looking get getting about like just more better also can could " +
    "would will new around who which where when then than there these those very really lot lots any all one two do doing " +
    "first best good great project projects platform product startup stuff people find finding"
  ).split(" "),
);

export function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9+#.-]*/g) ?? [])
    .map((t) => t.replace(/[.-]+$/, ""))
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/** Hashing-trick embedding: used only as a fallback when a model embedding is missing. */
export function hashEmbed(text: string, dim = 384): Float32Array {
  const v = new Float32Array(dim);
  const toks = tokens(text);
  const grams = [...toks, ...toks.slice(1).map((t, i) => toks[i] + "_" + t)];
  for (const g of grams) {
    let h = 2166136261;
    for (let i = 0; i < g.length; i++) h = Math.imul(h ^ g.charCodeAt(i), 16777619);
    v[(h >>> 0) % dim] += h & 1 ? 1 : -1;
  }
  return normalise(v);
}

export function topKeywords(texts: string[], background: string[], count = 2): string[] {
  const df = new Map<string, number>();
  for (const t of background) for (const w of new Set(tokens(t))) df.set(w, (df.get(w) ?? 0) + 1);
  const tf = new Map<string, number>();
  for (const t of texts) for (const w of new Set(tokens(t))) tf.set(w, (tf.get(w) ?? 0) + 1);
  const N = Math.max(1, background.length);
  return [...tf.entries()]
    .filter(([, c]) => c >= Math.min(2, texts.length))
    .map(([w, c]) => [w, c * Math.log(1 + N / (df.get(w) ?? 1))] as const)
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([w]) => w);
}

export function sharedTag(a: Person, b: Person): string {
  const need = new Set(tokens(a.need + " " + b.need));
  const build = tokens(a.building + " " + b.building);
  const hit = build.find((w) => need.has(w)) ?? tokens(a.building).find((w) => tokens(b.building).includes(w));
  return hit ?? tokens(b.building)[0] ?? "builders";
}

export function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? full;
}

export function displayName(full: string): string {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

function clip(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, " ").replace(/[.!]+$/, "");
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 12)) + "…";
}

const ICEBREAKERS = [
  "What's the hardest bug you've hit this month?",
  "If your agent could do one thing perfectly tomorrow, what would it be?",
  "What did you almost build instead?",
  "What's one tool you couldn't work without right now?",
  "What would you ship if you had one more week?",
  "What's the most surprising thing a user did with your project?",
  "Which part of your stack would you rip out first?",
  "What's a problem you'd pay someone to solve today?",
];

export function templateCopy(members: Person[], seed: number) {
  const [a, b] = members;
  if (!b) return { why: "You're our wildcard — say hi to anyone with your code.", icebreaker: ICEBREAKERS[0], tag: "wildcard" };
  const why =
    members.length > 2
      ? `${firstName(a.name)}, ${firstName(b.name)} & ${members.length - 2 === 1 ? firstName(members[2].name) : "co"} are all circling ${sharedTag(a, b)}. ${firstName(a.name)} needs help with ${clip(a.need, 60)}.`
      : `${firstName(a.name)} needs help with ${clip(a.need, 70)} — ${firstName(b.name)} is building ${clip(b.building, 70)}.`;
  return { why, icebreaker: ICEBREAKERS[seed % ICEBREAKERS.length], tag: sharedTag(a, b) };
}

export const PAIR_COLORS = ["#7C5CFF", "#22D3EE", "#F472B6", "#34D399", "#FBBF24", "#FB7185", "#60A5FA", "#A3E635"];
