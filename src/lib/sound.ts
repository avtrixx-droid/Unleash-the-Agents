// Tiny WebAudio sound design for the big screen. Everything is synthesised,
// so there are no audio files to license or load.
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let ambient: { stop: () => void } | null = null;

export function audioReady() {
  return !!ctx;
}

export async function startAudio() {
  if (ctx) return;
  ctx = new AudioContext();
  master = ctx.createGain();
  master.gain.value = 0.7;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp).connect(ctx.destination);
  await ctx.resume();
  startAmbient();
}

function startAmbient() {
  if (!ctx || !master || ambient) return;
  const g = ctx.createGain();
  g.gain.value = 0;
  g.gain.linearRampToValueAtTime(0.06, ctx.currentTime + 4);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 520;
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = 0.07;
  lfoGain.gain.value = 220;
  lfo.connect(lfoGain).connect(lp.frequency);
  const oscs = [55, 82.4, 110.3, 164.8].map((f, i) => {
    const o = ctx!.createOscillator();
    o.type = i % 2 ? "sawtooth" : "triangle";
    o.frequency.value = f;
    o.detune.value = (i - 1.5) * 7;
    o.connect(lp);
    o.start();
    return o;
  });
  lp.connect(g).connect(master);
  lfo.start();
  ambient = {
    stop: () => {
      oscs.forEach((o) => o.stop());
      lfo.stop();
    },
  };
}

const PENTA = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66];

export function blip() {
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "sine";
  o.frequency.value = PENTA[Math.floor(Math.random() * PENTA.length)];
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.05, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + 0.65);
}

export function tick(high = false) {
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "square";
  o.frequency.value = high ? 1320 : 880;
  g.gain.setValueAtTime(0.04, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + 0.1);
}

function noiseBuffer(seconds: number) {
  const buf = ctx!.createBuffer(1, ctx!.sampleRate * seconds, ctx!.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/** Rising whoosh for the matching sequence. */
export function riser(seconds = 8) {
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(seconds);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 6;
  bp.frequency.setValueAtTime(200, t);
  bp.frequency.exponentialRampToValueAtTime(5000, t + seconds);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.25, t + seconds * 0.9);
  g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
  src.connect(bp).connect(g).connect(master);
  src.start(t);
  const o = ctx.createOscillator();
  const og = ctx.createGain();
  o.type = "sawtooth";
  o.frequency.setValueAtTime(55, t);
  o.frequency.exponentialRampToValueAtTime(440, t + seconds);
  og.gain.setValueAtTime(0.0001, t);
  og.gain.exponentialRampToValueAtTime(0.05, t + seconds * 0.9);
  og.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
  o.connect(og).connect(master);
  o.start(t);
  o.stop(t + seconds);
}

/** Deep impact for the reveal. */
export function impact() {
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(140, t);
  o.frequency.exponentialRampToValueAtTime(38, t + 1.2);
  g.gain.setValueAtTime(0.6, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + 1.9);
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(1.5);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(3000, t);
  lp.frequency.exponentialRampToValueAtTime(200, t + 1.4);
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.3, t);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
  src.connect(lp).connect(ng).connect(master);
  src.start(t);
  // Shimmer chord
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
    const s = ctx!.createOscillator();
    const sg = ctx!.createGain();
    s.type = "triangle";
    s.frequency.value = f;
    sg.gain.setValueAtTime(0.0001, t + 0.05 * i);
    sg.gain.linearRampToValueAtTime(0.05, t + 0.05 * i + 0.05);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 3);
    s.connect(sg).connect(master!);
    s.start(t + 0.05 * i);
    s.stop(t + 3.1);
  });
}
