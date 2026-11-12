import { useEffect, useRef, useState } from "react";
import { Brand } from "../components/Brand";
import { Ring } from "../components/Ring";
import { DEMO } from "../config";
import { callFunction, supabase } from "../lib/supabase";
import { serverNow } from "../lib/clock";
import { effectivePhase, useEventState } from "../lib/useEventState";
import type { EventState, MyMatch, Phase } from "../lib/types";

const STORE = "uta.v1";
interface Saved {
  token: string;
  node_no: number;
  name: string;
}
function loadSaved(): Saved | null {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}
function save(s: Saved | null) {
  try {
    if (s) localStorage.setItem(STORE, JSON.stringify(s));
    else localStorage.removeItem(STORE);
  } catch {
    /* private mode: stays in memory only */
  }
}

const NEED_CHIPS = ["Evals", "Latency", "First users", "Fundraising", "A cofounder", "GPU credits", "Hiring", "Going to production"];

export default function Join() {
  const live = useEventState("poll");
  const demo = useDemoPhone();
  const state = DEMO ? demo.state : live;
  const [saved, setSaved] = useState<Saved | null>(() => (DEMO ? null : loadSaved()));
  const now = useTicker();
  const phase = effectivePhase(state, now) as Phase | null;

  return (
    <div className="aurora min-h-full">
      <div className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-[max(24px,env(safe-area-inset-bottom))] pt-[max(20px,env(safe-area-inset-top))]">
        <header className="flex items-center justify-between">
          <Brand small />
          {saved && (
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono text-xs text-mist">node #{saved.node_no}</span>
          )}
        </header>
        <main className="flex flex-1 flex-col pt-8">
          {!saved ? (
            <JoinForm
              phase={phase}
              state={state}
              now={now}
              onJoined={(s) => {
                save(s);
                setSaved(s);
                if (DEMO) demo.start();
              }}
            />
          ) : (
            <Waiting saved={saved} phase={phase} state={state} now={now} demoMatch={DEMO ? demo.match : undefined} />
          )}
        </main>
        {saved && !DEMO && (
          <button
            className="mt-6 self-center text-xs text-mist/60 underline-offset-4 hover:underline"
            onClick={() => {
              if (confirm("Sign out on this phone? You'll need to fill the form again.")) {
                save(null);
                setSaved(null);
              }
            }}
          >
            Not {saved.name.split(" ")[0]}?
          </button>
        )}
      </div>
    </div>
  );
}

function useTicker(ms = 250) {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

// ---------------------------------------------------------------------------

function JoinForm({ phase, state, now, onJoined }: { phase: Phase | null; state: EventState | null; now: number; onJoined: (s: Saved) => void }) {
  const [name, setName] = useState("");
  const [building, setBuilding] = useState("");
  const [need, setNeed] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const late = phase === "locked" || phase === "matching" || phase === "reveal" || phase === "released";
  const secondsLeft = state?.countdown_ends_at ? Math.max(0, Math.ceil((new Date(state.countdown_ends_at).getTime() - now) / 1000)) : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (DEMO) {
        await new Promise((r) => setTimeout(r, 700));
        onJoined({ token: "demo", node_no: 142, name });
      } else {
        const res = await callFunction<{ token: string; node_no: number }>("join", { full_name: name, building, need, website });
        navigator.vibrate?.(20);
        onJoined({ token: res.token, node_no: res.node_no, name });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-1 flex-col">
      {phase === "countdown" && secondsLeft != null && (
        <div className="mb-5 flex items-center gap-3 rounded-2xl border border-cyan/30 bg-cyan/10 px-4 py-3 rise">
          <span className="font-display text-2xl font-bold tabular-nums text-cyan">{secondsLeft}s</span>
          <span className="text-sm text-white/80">left to join the matching round</span>
        </div>
      )}
      {late && (
        <div className="mb-5 rounded-2xl border border-gold/30 bg-gold/10 px-4 py-3 text-sm text-white/85 rise">
          The round has started — join anyway and we'll add you to a match right away.
        </div>
      )}
      <h1 className="font-display text-[34px] font-bold leading-[1.05] tracking-tight rise">
        <span className="text-gradient">Find the person</span>
        <br />
        you should meet.
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-mist rise" style={{ animationDelay: "0.05s" }}>
        Three quick answers. Our agents do the rest.
      </p>

      <div className="mt-7 space-y-5">
        <label className="block rise" style={{ animationDelay: "0.1s" }}>
          <span className="mb-2 block text-sm font-medium text-white/85">Your full name</span>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Priya Sharma" required minLength={2} maxLength={80} enterKeyHint="next" />
        </label>
        <label className="block rise" style={{ animationDelay: "0.15s" }}>
          <span className="mb-2 flex items-baseline justify-between text-sm font-medium text-white/85">
            What are you building?
            <span className="font-mono text-xs text-mist/70">{building.length}/280</span>
          </span>
          <textarea className="field min-h-[92px] resize-none" value={building} onChange={(e) => setBuilding(e.target.value)} placeholder="A voice agent that books clinic appointments" required minLength={3} maxLength={280} />
        </label>
        <label className="block rise" style={{ animationDelay: "0.2s" }}>
          <span className="mb-2 flex items-baseline justify-between text-sm font-medium text-white/85">
            What do you need help with?
            <span className="font-mono text-xs text-mist/70">{need.length}/280</span>
          </span>
          <textarea className="field min-h-[92px] resize-none" value={need} onChange={(e) => setNeed(e.target.value)} placeholder="Cutting voice latency, finding design partners…" required minLength={3} maxLength={280} />
          <div className="mt-2.5 flex flex-wrap gap-2">
            {NEED_CHIPS.map((c) => (
              <button
                type="button"
                key={c}
                onClick={() => setNeed((v) => (v.toLowerCase().includes(c.toLowerCase()) ? v : v ? `${v.replace(/[,\s]+$/, "")}, ${c.toLowerCase()}` : c))}
                className="rounded-full border border-white/12 bg-white/[0.04] px-3 py-1.5 text-[13px] text-white/80 active:scale-95"
              >
                + {c}
              </button>
            ))}
          </div>
        </label>
        {/* honeypot */}
        <input tabIndex={-1} autoComplete="off" className="absolute -left-[9999px] h-0 w-0 opacity-0" value={website} onChange={(e) => setWebsite(e.target.value)} aria-hidden />
      </div>

      {error && <p className="mt-4 rounded-xl border border-pink/40 bg-pink/10 px-4 py-3 text-sm text-pink rise">{error}</p>}

      <div className="mt-auto pt-8">
        <button disabled={busy} className="btn-primary w-full rounded-2xl py-4 font-display text-lg font-semibold text-white transition active:scale-[0.98] disabled:opacity-60">
          {busy ? "Entering the network…" : "Enter the network →"}
        </button>
        <p className="mt-3 text-center text-xs leading-relaxed text-mist/70">
          Your name and answers are shared with your match and your group. The big screen only shows your first name and initial.
        </p>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------

function Waiting({ saved, phase, state, now, demoMatch }: { saved: Saved; phase: Phase | null; state: EventState | null; now: number; demoMatch?: MyMatch }) {
  const [match, setMatch] = useState<MyMatch | null>(demoMatch ?? null);
  const status = state?.match_status;

  useEffect(() => {
    if (demoMatch) {
      setMatch(phase === "released" ? demoMatch : null);
      return;
    }
    if (phase !== "released") return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      const { data } = await supabase.rpc("get_my_match", { p_token: saved.token });
      if (!alive) return;
      const m = data as MyMatch | null;
      if (m) setMatch(m);
      // Keep refreshing until the AI copy has landed (or we're still pending).
      if (!m || m.status !== "matched" || !m.enriched) timer = setTimeout(load, 3500 + Math.random() * 1500);
    };
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [phase, status, saved.token, demoMatch]);

  if (phase === "released" && match?.status === "matched") return <MatchCard match={match} me={saved} />;

  const secondsLeft = state?.countdown_ends_at ? Math.max(0, Math.ceil((new Date(state.countdown_ends_at).getTime() - now) / 1000)) : 0;
  const total = state?.countdown_ends_at ? (new Date(state.countdown_ends_at).getTime() - new Date(state.phase_started_at).getTime()) / 1000 : 60;

  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      {phase === "countdown" ? (
        <Ring progress={secondsLeft / Math.max(1, total)} size={260} stroke={5}>
          <div className="font-display text-7xl font-bold tabular-nums">{secondsLeft}</div>
          <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.3em] text-mist">until matching</div>
        </Ring>
      ) : phase === "matching" ? (
        <SlotMachine />
      ) : (
        <Orbit intense={phase === "reveal"} />
      )}
      <div className="mt-10 rise" key={phase ?? "x"}>
        <h2 className="font-display text-3xl font-bold tracking-tight">
          {phase === "lobby" && <>You're in, {saved.name.split(" ")[0]}.</>}
          {phase === "countdown" && <>Locked in.</>}
          {phase === "locked" && <>Network sealed.</>}
          {phase === "matching" && <span className="text-gradient">Agents are matching…</span>}
          {phase === "reveal" && <>Eyes on the big screen</>}
          {phase === "released" && <>Finding your match…</>}
          {!phase && <>Connecting…</>}
        </h2>
        <p className="mx-auto mt-3 max-w-xs text-[15px] leading-relaxed text-mist">
          {phase === "lobby" && "You're node #" + saved.node_no + " in the network. Watch the screen — the countdown starts soon."}
          {phase === "countdown" && "Keep this page open. Your match will appear right here."}
          {phase === "locked" && "Everyone's in. The agents are about to start."}
          {phase === "matching" && "Comparing what you need with what everyone else is building."}
          {phase === "reveal" && "We're revealing tonight's featured match. Yours is next."}
          {phase === "released" && "Hang tight — this only takes a moment."}
        </p>
      </div>
    </div>
  );
}

function Orbit({ intense = false }: { intense?: boolean }) {
  return (
    <div className="relative h-56 w-56">
      <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(124,92,255,0.35),transparent_65%)] pulse-soft" />
      {[0, 1, 2].map((ring) => (
        <div
          key={ring}
          className="absolute rounded-full border border-white/10"
          style={{
            inset: ring * 26,
            animation: `spin ${(intense ? 2.5 : 9) + ring * 3}s linear infinite ${ring % 2 ? "reverse" : ""}`,
          }}
        >
          <span
            className="absolute -top-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full"
            style={{ background: ["#a78bfa", "#22d3ee", "#f472b6"][ring], boxShadow: `0 0 18px 4px ${["#7c5cff", "#22d3ee", "#f472b6"][ring]}` }}
          />
        </div>
      ))}
      <div className="absolute inset-[92px] rounded-full bg-white shadow-[0_0_40px_10px_rgba(167,139,250,0.7)]" />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}

function SlotMachine() {
  const [codes, setCodes] = useState(["000", "000", "000"]);
  useEffect(() => {
    const t = setInterval(() => setCodes((c) => c.map(() => String(100 + Math.floor(Math.random() * 400)))), 70);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="glass glow-border rounded-3xl px-5 py-6">
      <div className="flex gap-2 font-mono text-4xl font-medium tabular-nums">
        {codes.map((c, i) => (
          <div key={i} className={`rounded-xl bg-white/[0.06] px-2.5 py-2 ${i === 1 ? "text-white" : "text-white/35"}`}>
            {c}
          </div>
        ))}
      </div>
      <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.3em] text-cyan pulse-soft">shuffling the network</p>
    </div>
  );
}

// ---------------------------------------------------------------------------

function MatchCard({ match, me }: { match: MyMatch; me: Saved }) {
  const [beacon, setBeacon] = useState(false);
  const [showGroup, setShowGroup] = useState(false);
  const partners = match.partners ?? [];
  const color = match.color ?? "#7c5cff";
  const code = String(match.pair_code ?? 0).padStart(3, "0");
  const celebrated = useRef(false);

  useEffect(() => {
    if (celebrated.current) return;
    celebrated.current = true;
    navigator.vibrate?.([40, 60, 40, 60, 120]);
  }, []);

  return (
    <div className="flex flex-1 flex-col">
      <Confetti color={color} />
      <p className="font-mono text-xs uppercase tracking-[0.35em] text-cyan rise">Your match</p>
      <div className="glass mt-4 overflow-hidden rounded-3xl rise" style={{ animationDelay: "0.1s" }}>
        <div className="h-1.5" style={{ background: `linear-gradient(90deg, ${color}, #22d3ee)` }} />
        <div className="p-6">
          {partners.map((p, i) => (
            <div key={i} className={i ? "mt-6 border-t border-white/10 pt-6" : ""}>
              <h2 className="font-display text-[32px] font-bold leading-tight tracking-tight">{p.full_name}</h2>
              <dl className="mt-3 space-y-2.5 text-[15px] leading-snug">
                <div>
                  <dt className="text-xs uppercase tracking-[0.2em] text-mist">Building</dt>
                  <dd className="mt-0.5 text-white/90">{p.building}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.2em] text-mist">Needs help with</dt>
                  <dd className="mt-0.5 text-white/75">{p.need}</dd>
                </div>
              </dl>
            </div>
          ))}
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-cyan">Why you{partners.length > 1 ? " all" : " two"}</p>
            <p className="mt-2 text-[15px] leading-relaxed text-white/90">{match.why}</p>
            {!match.ai && !match.enriched && <p className="mt-2 font-mono text-[11px] text-mist/70 pulse-soft">agents are polishing this…</p>}
          </div>
          {match.icebreaker && (
            <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-pink">Open with</p>
              <p className="mt-2 text-[15px] leading-relaxed text-white/90">“{match.icebreaker}”</p>
            </div>
          )}
        </div>
      </div>

      <button
        onClick={() => setBeacon(true)}
        className="mt-5 flex w-full items-center justify-between rounded-2xl px-5 py-4 text-left font-display text-lg font-semibold text-ink transition active:scale-[0.98] rise"
        style={{ background: color, animationDelay: "0.2s", boxShadow: `0 12px 40px -10px ${color}` }}
      >
        <span>Find me in the crowd</span>
        <span className="font-mono text-base">#{code}</span>
      </button>
      <p className="mt-2 text-center text-xs text-mist/70">Opens a full-screen beacon. Your match has the same colour and number.</p>

      {match.group && (
        <div className="glass mt-6 rounded-3xl p-5 rise" style={{ animationDelay: "0.3s" }}>
          <button className="flex w-full items-center justify-between text-left" onClick={() => setShowGroup((v) => !v)}>
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-mist">Your crew</p>
              <p className="mt-1 font-display text-xl font-semibold">{match.group.label}</p>
              <p className="text-sm text-mist">{match.group.size} people building similar things</p>
            </div>
            <span className={`text-2xl text-mist transition ${showGroup ? "rotate-45" : ""}`}>+</span>
          </button>
          {showGroup && (
            <ul className="mt-4 space-y-3 border-t border-white/10 pt-4">
              {match.group.members.map((m, i) => (
                <li key={i} className="text-sm">
                  <span className="font-medium text-white">{m.full_name}</span>
                  <span className="text-mist"> — {m.building}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {beacon && (
        <button onClick={() => setBeacon(false)} className="beacon fixed inset-0 z-50 flex flex-col items-center justify-center text-ink" style={{ background: color }}>
          <p className="font-mono text-sm uppercase tracking-[0.4em] opacity-70">Unleash the Agents</p>
          <p className="mt-4 font-display text-[34vw] font-bold leading-none tabular-nums">{code}</p>
          <p className="mt-4 font-display text-3xl font-bold">{me.name.split(" ")[0]}</p>
          <p className="mt-1 text-lg opacity-80">looking for {partners.map((p) => p.full_name.split(" ")[0]).join(" & ")}</p>
          <p className="absolute bottom-10 text-sm opacity-60">Hold your phone up · tap to close</p>
        </button>
      )}
    </div>
  );
}

function Confetti({ color }: { color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    const dpr = Math.min(2, devicePixelRatio || 1);
    c.width = innerWidth * dpr;
    c.height = innerHeight * dpr;
    ctx.scale(dpr, dpr);
    const colors = [color, "#22d3ee", "#f472b6", "#fbbf24", "#ffffff"];
    const parts = Array.from({ length: 140 }, () => ({
      x: innerWidth / 2,
      y: innerHeight * 0.3,
      vx: (Math.random() - 0.5) * 14,
      vy: -Math.random() * 14 - 4,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      s: 4 + Math.random() * 6,
      c: colors[Math.floor(Math.random() * colors.length)],
    }));
    let raf = 0;
    const start = performance.now();
    const loop = (t: number) => {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (const p of parts) {
        p.vy += 0.35;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.r += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.c;
        ctx.globalAlpha = Math.max(0, 1 - (t - start) / 3000);
        ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        ctx.restore();
      }
      if (t - start < 3000) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [color]);
  return <canvas ref={ref} className="pointer-events-none fixed inset-0 z-40 h-full w-full" />;
}

// ---------------------------------------------------------------------------
// ?demo on the phone: walks through every phase on a timer after you submit.

function useDemoPhone() {
  const [phase, setPhase] = useState<Phase>("lobby");
  const [startedAt, setStartedAt] = useState(Date.now());
  const [ends, setEnds] = useState<string | null>(null);
  const start = () => {
    const seq: [Phase, number][] = [
      ["lobby", 2500],
      ["countdown", 8000],
      ["matching", 6000],
      ["reveal", 3500],
      ["released", 0],
    ];
    let acc = 0;
    for (const [p, dur] of seq) {
      setTimeout(() => {
        setPhase(p);
        setStartedAt(serverNow());
        if (p === "countdown") setEnds(new Date(serverNow() + dur).toISOString());
      }, acc);
      acc += dur;
    }
  };
  const state: EventState = {
    phase,
    phase_started_at: new Date(startedAt).toISOString(),
    countdown_ends_at: ends,
    match_status: phase === "released" ? "enriched" : "none",
    run_id: 1,
    enrich_done: 0,
    enrich_total: 0,
  };
  const match: MyMatch = {
    status: "matched",
    pair_code: 217,
    color: "#22D3EE",
    why: "Priya is wrestling with RAG evals for legal contracts; Arjun just built an eval harness that scores retrieval. Compare notes on how he grades answers.",
    icebreaker: "How do you decide a retrieved chunk was actually the right one?",
    ai: true,
    enriched: true,
    partners: [{ full_name: "Arjun Iyer", building: "An eval harness for RAG pipelines", need: "Getting real users to try our eval tool" }],
    group: {
      label: "RAG Crew",
      size: 38,
      members: [
        { full_name: "Meera Nair", building: "Semantic search for internal docs" },
        { full_name: "Omar Haddad", building: "A knowledge assistant for sales teams" },
        { full_name: "Sara Kim", building: "A RAG chatbot over legal contracts" },
      ],
    },
  };
  return { state, start, match };
}
