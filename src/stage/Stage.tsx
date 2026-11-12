import { useEffect, useMemo, useRef, useState } from "react";
import { Constellation, type Mode } from "./constellation";
import { AgentFeed } from "./AgentFeed";
import { Ring } from "../components/Ring";
import { QR } from "../components/QR";
import { Brand } from "../components/Brand";
import { DEMO, PUBLIC_URL } from "../config";
import { serverNow } from "../lib/clock";
import { effectivePhase } from "../lib/useEventState";
import { useDemoStage, useLiveStage, type StageData } from "../lib/stageData";
import { blip, impact, riser, startAudio, tick } from "../lib/sound";
import type { Phase } from "../lib/types";

const MIN_MATCH_SHOW_MS = 9000; // the matching animation always runs at least this long

export default function Stage() {
  // DEMO is fixed for the page lifetime, so the hook order never changes.
  const data = DEMO ? useDemoStage() : useLiveStage();
  return <StageView data={data} />;
}

function useNow(interval = 200) {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), interval);
    return () => clearInterval(t);
  }, [interval]);
  return now;
}

function useTyped(text: string | undefined, active: boolean, cps = 38) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    if (!text || !active) return;
    const t = setInterval(() => setN((v) => (v >= text.length ? v : v + 1)), 1000 / cps);
    return () => clearInterval(t);
  }, [text, active, cps]);
  return text ? text.slice(0, n) : "";
}

function StageView({ data }: { data: StageData }) {
  const { state, nodes, pairs, clusters, reveal, demo } = data;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const qrRef = useRef<HTMLDivElement>(null);
  const engine = useRef<Constellation | null>(null);
  const [started, setStarted] = useState(false);
  const now = useNow();
  const phase = effectivePhase(state, now) as Phase | null;
  const phaseStart = state ? new Date(state.phase_started_at).getTime() : 0;
  const pairsReady = pairs.length > 0;
  const showResults = phase === "matching" ? pairsReady && now - phaseStart > MIN_MATCH_SHOW_MS : phase === "reveal" || phase === "released";

  // Engine lifecycle
  useEffect(() => {
    const c = new Constellation(canvasRef.current!);
    engine.current = c;
    const onResize = () => c.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      c.destroy();
    };
  }, []);

  // Spawn point = the QR code
  useEffect(() => {
    const place = () => {
      const r = qrRef.current?.getBoundingClientRect();
      if (r) engine.current?.setSpawn((r.left + r.width / 2) / window.innerWidth, (r.top + r.height / 2) / window.innerHeight);
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [phase]);

  // Nodes
  const seen = useRef(new Set<string>());
  const lastBlip = useRef(0);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    const first = seen.current.size === 0;
    let fresh = 0;
    for (const n of nodes) if (!seen.current.has(n.id)) {
      seen.current.add(n.id);
      fresh++;
    }
    e.setNodes(nodes, !first);
    if (!first && fresh && performance.now() - lastBlip.current > 90) {
      lastBlip.current = performance.now();
      blip();
    }
    if (nodes.length === 0) seen.current.clear();
  }, [nodes]);

  // Clusters + links once results are shown
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    if (showResults && pairsReady) {
      const assign = new Map<string, number>();
      for (const n of nodes) if (n.cluster_id != null) assign.set(n.id, n.cluster_id);
      e.setClusters(assign, new Map(clusters.map((c) => [c.id, c.label])));
      e.setLinks(pairs, phase === "matching" ? Math.min(40, 6500 / Math.max(1, pairs.length)) : 0);
    } else if (!pairsReady) e.clearLinks();
  }, [showResults, pairsReady, pairs, clusters, nodes, phase]);

  // Mode
  const stagedIds = useMemo(() => pairs.find((p) => p.staged)?.ids ?? [], [pairs]);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    let mode: Mode = "drift";
    if (phase === "matching") mode = showResults ? "settle" : "swirl";
    if (phase === "reveal") mode = stagedIds.length ? "focus" : "settle";
    if (phase === "released") mode = pairsReady ? "settle" : "drift";
    e.setFocus(stagedIds);
    // Keep the swirl / crews clear of the agent feed (right) and the phone banner (bottom).
    if (phase === "matching") e.setLayout({ cx: 0.36, cy: 0.56, rx: 0.24, ry: 0.3 });
    else if (phase === "released") e.setLayout({ cx: 0.5, cy: 0.43, rx: 0.37, ry: 0.28 });
    else e.setLayout({ cx: 0.5, cy: 0.52, rx: 0.36, ry: 0.32 });
    e.setMode(mode);
  }, [phase, showResults, stagedIds, pairsReady]);

  // Sound cues
  const prevPhase = useRef<Phase | null>(null);
  useEffect(() => {
    if (phase === prevPhase.current) return;
    if (phase === "matching") riser(MIN_MATCH_SHOW_MS / 1000);
    if (phase === "reveal") setTimeout(impact, 350);
    prevPhase.current = phase;
  }, [phase]);
  const secondsLeft = state?.countdown_ends_at ? Math.max(0, Math.ceil((new Date(state.countdown_ends_at).getTime() - now) / 1000)) : 0;
  const lastTick = useRef(-1);
  useEffect(() => {
    if (phase === "countdown" && secondsLeft <= 10 && secondsLeft > 0 && secondsLeft !== lastTick.current) {
      lastTick.current = secondsLeft;
      tick(secondsLeft <= 3);
    }
  }, [phase, secondsLeft]);

  // Keyboard: F fullscreen; demo keys 1-6 drive phases, + adds people
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "f") document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
      if (!demo) return;
      const phases: Phase[] = ["lobby", "countdown", "locked", "matching", "reveal", "released"];
      const i = Number(ev.key) - 1;
      if (i >= 0 && i < phases.length) demo.setPhase(phases[i]);
      if (ev.key === "+" || ev.key === "=") demo.addPeople(25);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [demo]);

  const count = nodes.length;
  const countdownTotal = state?.countdown_ends_at ? (new Date(state.countdown_ends_at).getTime() - phaseStart) / 1000 : 60;
  const showQR = phase === "lobby" || phase === "countdown" || phase === null;

  return (
    <div className="fixed inset-0 overflow-hidden bg-ink select-none">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_60%_at_50%_50%,transparent_40%,rgba(5,6,10,0.75)_100%)]" />

      {/* Top bar */}
      <header className="absolute inset-x-0 top-0 flex items-center justify-between px-10 pt-8">
        <Brand />
        <div className="flex items-center gap-4">
          {DEMO && <span className="rounded-full border border-gold/40 px-3 py-1 font-mono text-xs text-gold">DEMO · keys 1–6, +</span>}
          <div className="glass flex items-center gap-3 rounded-full px-5 py-2.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-cyan" />
            </span>
            <span className="font-mono text-sm tabular-nums text-white">{count}</span>
            <span className="text-sm text-mist">builders in the network</span>
          </div>
        </div>
      </header>

      {/* Lobby / countdown: QR panel */}
      <section
        className={`absolute left-10 top-1/2 w-[min(520px,38vw)] -translate-y-1/2 transition-all duration-700 ${showQR ? "opacity-100" : "pointer-events-none -translate-x-10 opacity-0"}`}
      >
        <p className="mb-4 font-mono text-sm uppercase tracking-[0.3em] text-cyan">Live matchmaking</p>
        <h1 className="font-display text-[clamp(44px,5.2vw,88px)] font-bold leading-[0.95] tracking-tight">
          <span className="text-gradient">Find your</span>
          <br />
          people.
        </h1>
        <p className="mt-5 max-w-md text-lg leading-relaxed text-mist">
          Scan, tell us what you're building and what you need. Our agents will pair you with the person you should meet over coffee.
        </p>
        <div className="glass glow-border mt-8 inline-flex items-center gap-6 rounded-3xl p-5">
          <div ref={qrRef}>
            <QR url={PUBLIC_URL} size={210} />
          </div>
          <div className="pr-3">
            <p className="font-display text-2xl font-semibold">Scan to join</p>
            <p className="mt-1 font-mono text-sm text-mist">{PUBLIC_URL.replace(/^https?:\/\//, "")}</p>
            <ol className="mt-4 space-y-1.5 text-sm text-mist">
              <li><span className="text-cyan">01</span> Your name</li>
              <li><span className="text-cyan">02</span> What you're building</li>
              <li><span className="text-cyan">03</span> What you need help with</li>
            </ol>
          </div>
        </div>
      </section>

      {/* Countdown ring */}
      {(phase === "countdown" || phase === "locked") && (
        <section className="absolute right-[8vw] top-1/2 -translate-y-1/2 rise">
          <Ring progress={phase === "locked" ? 0 : secondsLeft / Math.max(1, countdownTotal)} size={Math.min(440, window.innerHeight * 0.5)} stroke={7}>
            {phase === "countdown" ? (
              <>
                <div className="font-display text-[120px] font-bold leading-none tabular-nums">{secondsLeft}</div>
                <div className="mt-2 font-mono text-sm uppercase tracking-[0.3em] text-mist">{secondsLeft <= 10 ? "last call" : "seconds to join"}</div>
              </>
            ) : (
              <>
                <div className="font-display text-5xl font-bold">Sealed</div>
                <div className="mt-3 font-mono text-sm uppercase tracking-[0.3em] text-mist">{count} builders · agents standing by</div>
              </>
            )}
          </Ring>
        </section>
      )}

      {/* Matching */}
      {phase === "matching" && (
        <>
          <section className="absolute left-10 top-28 max-w-xl rise">
            <p className="font-mono text-sm uppercase tracking-[0.3em] text-cyan pulse-soft">{showResults ? "matches locked in" : "agents at work"}</p>
            <h2 className="mt-3 font-display text-6xl font-bold leading-tight tracking-tight">
              {showResults ? (
                <>
                  <span className="text-gradient">{pairs.length} matches</span>
                  <br />
                  <span className="text-4xl text-mist">across {clusters.length} crews</span>
                </>
              ) : (
                <>
                  Matching <span className="text-gradient">{count}</span>
                  <br />
                  builders…
                </>
              )}
            </h2>
          </section>
          <AgentFeed nodes={nodes} pairs={pairs} showPairs={showResults} startedAt={phaseStart} />
        </>
      )}

      {/* Reveal */}
      {phase === "reveal" && <RevealView reveal={reveal} />}

      {/* Released */}
      {phase === "released" && (
        <section className="absolute inset-x-0 bottom-10 flex justify-center rise">
          <div className="glass glow-border flex items-center gap-8 rounded-3xl px-10 py-6">
            <div>
              <p className="font-display text-4xl font-bold">Check your phone</p>
              <p className="mt-1 text-lg text-mist">Your match is waiting. Find them at the coffee break.</p>
            </div>
            <div className="h-16 w-px bg-white/10" />
            <div className="flex items-center gap-4">
              <QR url={PUBLIC_URL} size={96} />
              <p className="text-sm text-mist">
                Late?
                <br />
                Scan to join
              </p>
            </div>
          </div>
        </section>
      )}

      {!started && (
        <button
          onClick={async () => {
            setStarted(true);
            await startAudio();
            document.documentElement.requestFullscreen?.().catch(() => {});
          }}
          className="absolute inset-0 grid cursor-pointer place-items-center bg-ink/70 backdrop-blur-sm"
        >
          <div className="glass glow-border rounded-3xl px-12 py-10 text-center">
            <p className="font-display text-3xl font-semibold">Start the show</p>
            <p className="mt-2 text-mist">Click to enable sound and go fullscreen · press F to toggle</p>
          </div>
        </button>
      )}
    </div>
  );
}

function RevealView({ reveal }: { reveal: StageData["reveal"] }) {
  const why = useTyped(reveal?.why, !!reveal);
  if (!reveal) {
    return (
      <section className="absolute inset-0 grid place-items-center">
        <p className="font-display text-5xl font-bold pulse-soft">The spotlight match…</p>
      </section>
    );
  }
  const [a, b] = reveal.people;
  return (
    <section className="absolute inset-0">
      <p className="absolute inset-x-0 top-[9vh] text-center font-mono text-sm uppercase tracking-[0.4em] text-gold rise">
        Featured match · #{String(reveal.code).padStart(3, "0")}
      </p>
      <div className="absolute inset-x-0 top-[31vh] flex justify-center gap-[10vw] px-10">
        {[a, b].filter(Boolean).map((p, i) => (
          <div key={p.full_name + i} className="w-[min(560px,38vw)] text-center rise" style={{ animationDelay: `${0.5 + i * 0.25}s` }}>
            <h3 className="font-display text-[clamp(40px,4.4vw,76px)] font-bold leading-none tracking-tight">{p.full_name}</h3>
            <p className="mt-4 text-sm uppercase tracking-[0.25em] text-mist">building</p>
            <p className="mt-1 text-xl leading-snug text-white/90">{p.building}</p>
            <p className="mt-3 text-sm uppercase tracking-[0.25em] text-mist">needs</p>
            <p className="mt-1 text-lg leading-snug text-white/70">{p.need}</p>
          </div>
        ))}
      </div>
      <div className="absolute inset-x-0 bottom-[10vh] flex justify-center px-10">
        <div className="glass glow-border max-w-4xl rounded-3xl px-10 py-7 text-center rise" style={{ animationDelay: "1.1s" }}>
          <p className="font-mono text-xs uppercase tracking-[0.35em] text-cyan">Why you two</p>
          <p className="caret mt-3 min-h-[2.6em] font-display text-[clamp(22px,2vw,34px)] font-medium leading-snug">{why}</p>
        </div>
      </div>
    </section>
  );
}
