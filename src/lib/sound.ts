// Cinematic sound design for the big screen, synthesised with WebAudio
// (no audio files to license). Signal chain:
//   voices → bus ─┬─────────────────────→ glue compressor → limiter → speakers
//                 ├→ reverb (generated hall IR) ┘
//                 └→ stereo ping-pong delay ───┘
//
// Want your own tracks instead? Drop files into public/sounds/ named after a
// cue (ambient.mp3, join.mp3, tick.mp3, heartbeat.mp3, matching.mp3, lock.mp3,
// reveal.mp3, release.mp3) and they replace the synth for that cue.

export type Scene = "lobby" | "countdown" | "locked" | "matching" | "reveal" | "released";

let ctx: AudioContext | null = null;
let master: GainNode;
let bus: GainNode;
let verbSend: GainNode;
let delaySend: GainNode;
let muted = false;
const files = new Map<string, AudioBuffer>();

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const now = () => ctx!.currentTime;

// A-minor cinematic progression (MIDI notes): Am9 → Fmaj7 → C(add9) → G/B
const CHORDS = [
  [45, 52, 55, 59, 60, 64],
  [41, 48, 52, 57, 59, 64],
  [48, 55, 62, 64, 67],
  [47, 50, 55, 62, 64],
];
const BRIGHT = [48, 55, 60, 64, 67, 72]; // C major for the finale
const PENTA = [57, 60, 62, 64, 67, 69, 72, 74, 76, 79, 81, 84];

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export async function startAudio() {
  if (ctx) return;
  ctx = new AudioContext({ latencyHint: "playback" });

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.2;
  master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(limiter).connect(ctx.destination);

  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -16;
  glue.ratio.value = 3;
  glue.attack.value = 0.02;
  glue.release.value = 0.35;
  glue.connect(master);

  bus = ctx.createGain();
  bus.connect(glue);

  // Hall reverb from a generated impulse response
  const verb = ctx.createConvolver();
  verb.buffer = impulse(4.2, 2.8);
  const verbOut = ctx.createGain();
  verbOut.gain.value = 0.85;
  verbSend = ctx.createGain();
  verbSend.connect(verb).connect(verbOut).connect(glue);

  // Stereo ping-pong delay (dotted eighth at ~124bpm)
  const merger = ctx.createChannelMerger(2);
  const dl = ctx.createDelay(2);
  const dr = ctx.createDelay(2);
  dl.delayTime.value = 0.363;
  dr.delayTime.value = 0.363;
  const fb = ctx.createGain();
  fb.gain.value = 0.38;
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 3200;
  delaySend = ctx.createGain();
  delaySend.connect(tone).connect(dl);
  dl.connect(dr);
  dr.connect(fb).connect(dl);
  dl.connect(merger, 0, 0);
  dr.connect(merger, 0, 1);
  const delayOut = ctx.createGain();
  delayOut.gain.value = 0.5;
  merger.connect(delayOut).connect(glue);
  delayOut.connect(verbSend);

  await ctx.resume();
  loadFiles();
  setScene("lobby");
}

function impulse(seconds: number, decay: number): AudioBuffer {
  const rate = ctx!.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx!.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // early reflections + smooth diffuse tail
      const early = i < rate * 0.08 && Math.random() < 0.004 ? 1.5 : 0;
      d[i] = ((Math.random() * 2 - 1) + early) * Math.pow(1 - t, decay);
    }
  }
  return buf;
}

async function loadFiles() {
  const cues = ["ambient", "join", "tick", "heartbeat", "matching", "lock", "reveal", "release"];
  await Promise.all(
    cues.map(async (c) => {
      try {
        const res = await fetch(`/sounds/${c}.mp3`);
        if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("audio")) return;
        files.set(c, await ctx!.decodeAudioData(await res.arrayBuffer()));
      } catch {
        /* no override: use the synth */
      }
    }),
  );
  if (files.has("ambient")) startAmbientFile();
}

function playFile(cue: string, gain = 1, loop = false) {
  const buf = files.get(cue);
  if (!ctx || !buf) return null;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = loop;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(g).connect(bus);
  src.start();
  return { src, g };
}

export function toggleMute(): boolean {
  muted = !muted;
  if (ctx) master.gain.setTargetAtTime(muted ? 0 : 0.9, now(), 0.05);
  return muted;
}

// Route a voice to the mix with reverb / delay sends.
function out(node: AudioNode, { dry = 1, verb = 0.3, delay = 0, pan = 0 } = {}) {
  const p = ctx!.createStereoPanner();
  p.pan.value = pan;
  node.connect(p);
  const d = ctx!.createGain();
  d.gain.value = dry;
  p.connect(d).connect(bus);
  if (verb) {
    const v = ctx!.createGain();
    v.gain.value = verb;
    p.connect(v).connect(verbSend);
  }
  if (delay) {
    const e = ctx!.createGain();
    e.gain.value = delay;
    p.connect(e).connect(delaySend);
  }
  return p;
}

function noise(seconds: number): AudioBuffer {
  const b = ctx!.createBuffer(1, Math.floor(ctx!.sampleRate * seconds), ctx!.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

// ---------------------------------------------------------------------------
// Ambient pad (evolving chord bed)
// ---------------------------------------------------------------------------

interface Pad {
  stop: (at: number) => void;
}
let pad: Pad | null = null;
let padTimer: ReturnType<typeof setInterval> | null = null;
let chordIndex = 0;
const padState = { level: 0.05, cutoff: 900, bright: false };
let ambientFile: { src: AudioBufferSourceNode; g: GainNode } | null = null;

function startAmbientFile() {
  stopPad();
  ambientFile = playFile("ambient", 0.6, true);
}

function padChord(notes: number[]): Pad {
  const t = now();
  const g = ctx!.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(padState.level, t + 3.5);
  const lp = ctx!.createBiquadFilter();
  lp.type = "lowpass";
  lp.Q.value = 0.7;
  lp.frequency.value = padState.cutoff;
  const lfo = ctx!.createOscillator();
  const lfoAmt = ctx!.createGain();
  lfo.frequency.value = 0.09;
  lfoAmt.gain.value = padState.cutoff * 0.35;
  lfo.connect(lfoAmt).connect(lp.frequency);
  lfo.start(t);
  lp.connect(g);
  out(g, { dry: 0.7, verb: 0.9 });

  const oscs: OscillatorNode[] = [lfo];
  notes.forEach((m, i) => {
    const f = mtof(m);
    for (const [type, detune, vol] of [
      ["sawtooth", -9, 0.33],
      ["sawtooth", 9, 0.33],
      ["triangle", 0, 0.5],
    ] as const) {
      const o = ctx!.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = detune + (Math.random() - 0.5) * 4;
      const og = ctx!.createGain();
      og.gain.value = vol / notes.length;
      const p = ctx!.createStereoPanner();
      p.pan.value = ((i / Math.max(1, notes.length - 1)) * 2 - 1) * 0.6 * (detune < 0 ? -1 : 1);
      o.connect(og).connect(p).connect(lp);
      o.start(t);
      oscs.push(o);
    }
  });
  // warm sub under the root
  const sub = ctx!.createOscillator();
  sub.frequency.value = mtof(notes[0] - 12);
  const sg = ctx!.createGain();
  sg.gain.value = 0.35;
  sub.connect(sg).connect(g);
  sub.start(t);
  oscs.push(sub);

  return {
    stop: (at: number) => {
      g.gain.cancelScheduledValues(at);
      g.gain.setValueAtTime(g.gain.value, at);
      g.gain.linearRampToValueAtTime(0.0001, at + 4);
      oscs.forEach((o) => o.stop(at + 4.2));
    },
  };
}

function nextChord() {
  const notes = padState.bright ? BRIGHT : CHORDS[chordIndex++ % CHORDS.length];
  const old = pad;
  pad = padChord(notes);
  old?.stop(now());
}

function startPad() {
  if (ambientFile || pad) return;
  nextChord();
  padTimer = setInterval(nextChord, 9000);
}

function stopPad(fade = 1.5) {
  if (padTimer) clearInterval(padTimer);
  padTimer = null;
  pad?.stop(now() + Math.max(0, fade - 4));
  pad = null;
}

function setPad(level: number, cutoff: number, bright = false) {
  const changed = bright !== padState.bright;
  padState.level = level;
  padState.cutoff = cutoff;
  padState.bright = bright;
  if (ambientFile) return;
  if (!pad) startPad();
  else if (changed) nextChord();
}

// ---------------------------------------------------------------------------
// One-shots
// ---------------------------------------------------------------------------

/** FM bell: glassy, expensive-sounding chime. */
function bell(freq: number, t: number, gain = 0.06, dur = 2.4, pan = 0, ratio = 3.5) {
  const car = ctx!.createOscillator();
  const mod = ctx!.createOscillator();
  const idx = ctx!.createGain();
  car.frequency.value = freq;
  mod.frequency.value = freq * ratio;
  idx.gain.setValueAtTime(freq * 2.2, t);
  idx.gain.exponentialRampToValueAtTime(freq * 0.05, t + dur * 0.5);
  mod.connect(idx).connect(car.frequency);
  const env = ctx!.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(gain, t + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  car.connect(env);
  out(env, { dry: 0.8, verb: 0.55, delay: 0.3, pan });
  car.start(t);
  mod.start(t);
  car.stop(t + dur + 0.1);
  mod.stop(t + dur + 0.1);
}

function kick(t: number, gain = 0.6, from = 140, to = 42) {
  const o = ctx!.createOscillator();
  const g = ctx!.createGain();
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + 0.14);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
  o.connect(g);
  out(g, { dry: 1, verb: 0.12 });
  o.start(t);
  o.stop(t + 0.6);
}

function click(t: number, gain = 0.05, freq = 6000) {
  const src = ctx!.createBufferSource();
  src.buffer = noise(0.03);
  const hp = ctx!.createBiquadFilter();
  hp.type = "bandpass";
  hp.frequency.value = freq;
  hp.Q.value = 3;
  const g = ctx!.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
  src.connect(hp).connect(g);
  out(g, { dry: 1, verb: 0.2, pan: (Math.random() - 0.5) * 0.4 });
  src.start(t);
}

function whoosh(t: number, dur: number, gain = 0.25, up = true) {
  const src = ctx!.createBufferSource();
  src.buffer = noise(dur + 0.1);
  const bp = ctx!.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(up ? 300 : 6000, t);
  bp.frequency.exponentialRampToValueAtTime(up ? 7000 : 200, t + dur);
  const g = ctx!.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + dur * (up ? 0.85 : 0.15));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(g);
  out(g, { dry: 0.8, verb: 0.6 });
  src.start(t);
}

let lastJoin = 0;
/** Someone joined: a sparkle from the current chord. Bursts become a shimmer. */
export function joinChime() {
  if (!ctx) return;
  const t = now();
  if (t - lastJoin < 0.06) return;
  lastJoin = t;
  if (files.has("join")) return void playFile("join", 0.7);
  const m = PENTA[Math.floor(Math.random() * PENTA.length)];
  bell(mtof(m), t, 0.045, 2.6, (Math.random() - 0.5) * 1.4);
}

/** Called every second of the countdown with the seconds left. */
export function countdownTick(secondsLeft: number) {
  if (!ctx || secondsLeft < 0) return;
  const t = now();
  if (secondsLeft > 10) {
    if (files.has("tick")) return void playFile("tick", 0.5);
    click(t, 0.035, 5200);
    return;
  }
  if (secondsLeft === 0) return;
  if (files.has("heartbeat")) return void playFile("heartbeat", 0.9);
  // heartbeat: lub-dub, faster and louder towards zero
  const k = 1 - secondsLeft / 10;
  kick(t, 0.45 + k * 0.35);
  kick(t + 0.18 - k * 0.05, 0.3 + k * 0.3, 120, 40);
  click(t, 0.05 + k * 0.05, 7000);
  if (secondsLeft <= 3) bell(mtof(81 + (3 - secondsLeft) * 2), t, 0.05, 1.2, 0, 2);
}

// ---------------------------------------------------------------------------
// Matching sequence: arpeggiator + Shepard riser, then a lock-in hit
// ---------------------------------------------------------------------------

let arpTimer: ReturnType<typeof setInterval> | null = null;
let riserNodes: { stop: (at: number) => void } | null = null;
let matchFile: { src: AudioBufferSourceNode; g: GainNode } | null = null;

function startMatching(buildSeconds: number) {
  stopMatching(0);
  if (files.has("matching")) {
    matchFile = playFile("matching", 0.9, true);
    return;
  }
  const start = now() + 0.05;
  const step = 60 / 124 / 4; // 16ths at 124bpm
  const notes = [45, 52, 57, 60, 64, 57, 60, 67, 69, 64, 72, 67];
  let next = start;
  let i = 0;
  const filterCurve = (t: number) => 350 * Math.pow(12, Math.min(1, (t - start) / buildSeconds));

  arpTimer = setInterval(() => {
    while (next < now() + 0.12) {
      const progress = Math.min(1, (next - start) / buildSeconds);
      const m = notes[i % notes.length] + (i % 24 >= 12 ? 12 : 0);
      // pluck
      const o = ctx!.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = mtof(m);
      const o2 = ctx!.createOscillator();
      o2.type = "square";
      o2.frequency.value = mtof(m) * 1.003;
      const lp = ctx!.createBiquadFilter();
      lp.type = "lowpass";
      lp.Q.value = 6;
      lp.frequency.setValueAtTime(filterCurve(next) * 2.2, next);
      lp.frequency.exponentialRampToValueAtTime(Math.max(200, filterCurve(next) * 0.6), next + 0.16);
      const g = ctx!.createGain();
      const vol = 0.035 + progress * 0.05;
      g.gain.setValueAtTime(0.0001, next);
      g.gain.linearRampToValueAtTime(vol, next + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, next + 0.2);
      o.connect(lp);
      o2.connect(lp);
      lp.connect(g);
      out(g, { dry: 0.9, verb: 0.25, delay: 0.22, pan: i % 2 ? 0.35 : -0.35 });
      o.start(next);
      o2.start(next);
      o.stop(next + 0.25);
      o2.stop(next + 0.25);
      // four-on-the-floor pulse that builds in
      if (i % 4 === 0) kick(next, 0.15 + progress * 0.35, 110, 40);
      if (i % 4 === 2 && progress > 0.5) click(next, 0.02 + progress * 0.03, 9000);
      next += step;
      i++;
    }
  }, 25);

  // Shepard-style riser: octave-spaced sines gliding up forever + air
  const t = start;
  const sines: OscillatorNode[] = [];
  const riserGain = ctx!.createGain();
  riserGain.gain.setValueAtTime(0.0001, t);
  riserGain.gain.exponentialRampToValueAtTime(0.09, t + buildSeconds);
  for (let k = 0; k < 6; k++) {
    const o = ctx!.createOscillator();
    o.type = "sine";
    const base = 55 * Math.pow(2, k);
    o.frequency.setValueAtTime(base, t);
    o.frequency.exponentialRampToValueAtTime(base * 2, t + buildSeconds);
    const g = ctx!.createGain();
    g.gain.value = Math.sin(((k + 0.5) / 6) * Math.PI) * 0.4;
    o.connect(g).connect(riserGain);
    o.start(t);
    sines.push(o);
  }
  const air = ctx!.createBufferSource();
  air.buffer = noise(buildSeconds + 30);
  const bp = ctx!.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 2;
  bp.frequency.setValueAtTime(400, t);
  bp.frequency.exponentialRampToValueAtTime(6000, t + buildSeconds);
  const airG = ctx!.createGain();
  airG.gain.setValueAtTime(0.0001, t);
  airG.gain.exponentialRampToValueAtTime(0.16, t + buildSeconds);
  air.connect(bp).connect(airG);
  out(airG, { dry: 0.7, verb: 0.5 });
  air.start(t);
  out(riserGain, { dry: 0.8, verb: 0.6 });
  riserNodes = {
    stop: (at) => {
      riserGain.gain.cancelScheduledValues(at);
      airG.gain.cancelScheduledValues(at);
      riserGain.gain.setTargetAtTime(0.0001, at, 0.03);
      airG.gain.setTargetAtTime(0.0001, at, 0.03);
      sines.forEach((o) => o.stop(at + 0.5));
      air.stop(at + 0.5);
    },
  };
}

function stopMatching(fade = 0.05) {
  if (arpTimer) clearInterval(arpTimer);
  arpTimer = null;
  riserNodes?.stop(now() + fade);
  riserNodes = null;
  if (matchFile) {
    matchFile.g.gain.setTargetAtTime(0, now(), 0.1);
    matchFile.src.stop(now() + 0.6);
    matchFile = null;
  }
}

/** Matches are in: everything cuts, a huge hit, then a bright bloom. */
export function lockIn() {
  if (!ctx) return;
  stopMatching(0.02);
  const t = now() + 0.03;
  if (files.has("lock")) return void playFile("lock", 1);
  impactHit(t, 1);
  // bloom: fast upward bell arpeggio over the chord
  [57, 64, 69, 72, 76, 81, 84, 88].forEach((m, k) => bell(mtof(m), t + 0.12 + k * 0.06, 0.05, 3, (k / 7) * 1.6 - 0.8));
  setTimeout(() => setPad(0.06, 2600), 300);
}

function impactHit(t: number, size = 1) {
  // sub drop
  const o = ctx!.createOscillator();
  const g = ctx!.createGain();
  o.frequency.setValueAtTime(110, t);
  o.frequency.exponentialRampToValueAtTime(28, t + 1.6);
  g.gain.setValueAtTime(0.9 * size, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
  o.connect(g);
  out(g, { dry: 1, verb: 0.2 });
  o.start(t);
  o.stop(t + 2.5);
  // body: filtered noise burst
  const n = ctx!.createBufferSource();
  n.buffer = noise(2.5);
  const lp = ctx!.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(5000, t);
  lp.frequency.exponentialRampToValueAtTime(120, t + 1.8);
  const ng = ctx!.createGain();
  ng.gain.setValueAtTime(0.45 * size, t);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
  n.connect(lp).connect(ng);
  out(ng, { dry: 0.8, verb: 0.9 });
  n.start(t);
}

/** Cinematic "braam": distorted detuned brass-like low chord. */
function braam(t: number) {
  const shaper = ctx!.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 3);
  }
  shaper.curve = curve;
  const lp = ctx!.createBiquadFilter();
  lp.type = "lowpass";
  lp.Q.value = 4;
  lp.frequency.setValueAtTime(150, t);
  lp.frequency.exponentialRampToValueAtTime(2400, t + 0.35);
  lp.frequency.exponentialRampToValueAtTime(380, t + 3.5);
  const g = ctx!.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.32, t + 0.08);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 6);
  const pre = ctx!.createGain();
  pre.gain.value = 0.5;
  pre.connect(shaper).connect(lp).connect(g);
  out(g, { dry: 0.9, verb: 0.9 });
  for (const m of [33, 45, 52, 57]) {
    for (const d of [-12, 0, 12]) {
      const o = ctx!.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = mtof(m);
      o.detune.value = d;
      o.connect(pre);
      o.start(t);
      o.stop(t + 6.2);
    }
  }
}

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

let scene: Scene | null = null;

export function setScene(next: Scene, opts: { matchSeconds?: number } = {}) {
  if (!ctx || next === scene) return;
  const prev = scene;
  scene = next;
  const t = now();

  switch (next) {
    case "lobby":
      stopMatching();
      setPad(0.05, 900);
      break;
    case "countdown":
      setPad(0.06, 1500);
      whoosh(t, 1.4, 0.12);
      break;
    case "locked":
      setPad(0.04, 700);
      if (prev === "countdown") {
        impactHit(t, 0.6);
        whoosh(t, 1.2, 0.15, false);
      }
      break;
    case "matching":
      setPad(0.025, 600);
      startMatching(opts.matchSeconds ?? 9);
      break;
    case "reveal": {
      stopMatching();
      // drop to near-silence, then hit
      setPad(0.0001, 400);
      if (files.has("reveal")) {
        setTimeout(() => playFile("reveal", 1), 550);
      } else {
        whoosh(t, 0.55, 0.3);
        braam(t + 0.55);
        impactHit(t + 0.55, 0.9);
        [69, 76, 81, 88, 93].forEach((m, k) => bell(mtof(m), t + 1.1 + k * 0.11, 0.035, 4, (k / 4) * 1.2 - 0.6, 2));
      }
      setTimeout(() => setPad(0.05, 1800), 2500);
      break;
    }
    case "released": {
      stopMatching();
      if (files.has("release")) playFile("release", 1);
      else {
        whoosh(t, 0.8, 0.15);
        [60, 64, 67, 72, 76, 79, 84, 88, 91].forEach((m, k) => bell(mtof(m), t + 0.3 + k * 0.09, 0.045, 3.5, Math.sin(k) * 0.8, 2.5));
        kick(t + 0.3, 0.5, 90, 35);
      }
      setPad(0.06, 2800, true);
      break;
    }
  }
}
