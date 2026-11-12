import { useCallback, useEffect, useState } from "react";
import { Brand } from "../components/Brand";
import { callFunction } from "../lib/supabase";
import type { EventState, Phase } from "../lib/types";

interface Status {
  state: EventState & { staged_a: string | null; staged_b: string | null; staged_why: string | null; staged_icebreaker: string | null };
  participants: number;
  demo: number;
  staged: { id: string; full_name: string; building: string; need: string }[];
  ai: string;
  ai_enabled: boolean;
}
interface Person {
  id: string;
  node_no: number;
  full_name: string;
  building: string;
  is_demo: boolean;
}

const PIN_KEY = "uta.host.pin";

export default function Host() {
  const [pin, setPin] = useState(() => sessionStorage.getItem(PIN_KEY) ?? "");
  const [authed, setAuthed] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(60);

  const call = useCallback(
    async <T,>(body: Record<string, unknown>): Promise<T> => callFunction<T>("host", body, { "x-host-pin": pin }),
    [pin],
  );

  const refresh = useCallback(async () => {
    try {
      const s = await call<Status>({ action: "status" });
      setStatus(s);
      setAuthed(true);
      setError(null);
      sessionStorage.setItem(PIN_KEY, pin);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (String(e).includes("PIN")) setAuthed(false);
    }
  }, [call, pin]);

  useEffect(() => {
    if (!authed) return;
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [authed, refresh]);

  useEffect(() => {
    if (pin) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (label: string, body: Record<string, unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await call(body);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (!authed) {
    return (
      <div className="aurora grid min-h-dvh place-items-center px-5">
        <form
          className="glass w-full max-w-sm rounded-3xl p-7"
          onSubmit={(e) => {
            e.preventDefault();
            refresh();
          }}
        >
          <Brand small />
          <h1 className="mt-6 font-display text-2xl font-bold">Host remote</h1>
          <p className="mt-1 text-sm text-mist">Enter the host PIN to control the show.</p>
          <input className="field mt-5 font-mono tracking-[0.3em]" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="••••" autoFocus />
          {error && <p className="mt-3 text-sm text-pink">{error}</p>}
          <button className="btn-primary mt-5 w-full rounded-2xl py-3 font-semibold">Unlock</button>
        </form>
      </div>
    );
  }

  const s = status!;
  const st = s.state;
  const steps: { phase: Phase; label: string; action: () => void; hint: string }[] = [
    { phase: "lobby", label: "Open lobby", hint: "QR on screen, people join", action: () => run("lobby", { action: "phase", phase: "lobby" }) },
    { phase: "countdown", label: `Start ${seconds}s countdown`, hint: "Ring on screen and phones", action: () => run("countdown", { action: "phase", phase: "countdown", seconds }) },
    { phase: "matching", label: "Run matching", hint: "Locks entries, agents animate", action: () => run("match", { action: "match" }) },
    { phase: "reveal", label: "Reveal featured match", hint: "Staged pair on the big screen", action: () => run("reveal", { action: "phase", phase: "reveal" }) },
    { phase: "released", label: "Release to phones", hint: "Everyone sees their match", action: () => run("released", { action: "phase", phase: "released" }) },
  ];
  const currentIdx = steps.findIndex((x) => x.phase === st.phase || (st.phase === "locked" && x.phase === "countdown"));

  return (
    <div className="aurora min-h-dvh">
      <div className="mx-auto max-w-5xl px-5 py-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <Brand small />
          <div className="flex gap-2 text-sm">
            <a className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-mist hover:text-white" href="/stage" target="_blank">Open stage ↗</a>
            <a className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-mist hover:text-white" href="/" target="_blank">Open phone view ↗</a>
          </div>
        </header>

        <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Phase" value={st.phase} accent />
          <Stat label="Joined" value={`${s.participants}`} sub={s.demo ? `${s.demo} demo` : undefined} />
          <Stat label="Matching" value={st.match_status} sub={st.enrich_total ? `AI copy ${st.enrich_done}/${st.enrich_total}` : undefined} />
          <Stat label="AI writer" value={s.ai_enabled ? "on" : "off"} sub={s.ai} />
        </section>

        {error && <p className="mt-4 rounded-xl border border-pink/40 bg-pink/10 px-4 py-3 text-sm text-pink">{error}</p>}

        <section className="glass mt-6 rounded-3xl p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">Run of show</h2>
            <label className="flex items-center gap-2 text-sm text-mist">
              Countdown
              <input type="number" min={10} max={300} value={seconds} onChange={(e) => setSeconds(Number(e.target.value) || 60)} className="field w-20 py-1.5 text-center" />s
            </label>
          </div>
          <ol className="mt-4 grid gap-3 sm:grid-cols-5">
            {steps.map((step, i) => {
              const done = i < currentIdx;
              const current = i === currentIdx;
              const next = i === currentIdx + 1;
              return (
                <li key={step.phase}>
                  <button
                    onClick={step.action}
                    disabled={!!busy}
                    className={`h-full w-full rounded-2xl border p-4 text-left transition active:scale-[0.98] disabled:opacity-50 ${
                      next ? "btn-primary border-transparent text-white" : current ? "border-cyan/50 bg-cyan/10" : done ? "border-white/5 bg-white/[0.02] text-white/50" : "border-white/10 bg-white/[0.04]"
                    }`}
                  >
                    <span className="font-mono text-xs opacity-70">0{i + 1}{current ? " · now" : ""}</span>
                    <span className="mt-1 block font-semibold">{busy === step.phase || (busy === "match" && step.phase === "matching") ? "Working…" : step.label}</span>
                    <span className="mt-1 block text-xs opacity-70">{step.hint}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          {st.match_status === "failed" && <p className="mt-3 text-sm text-pink">Matching failed — press “Run matching” again.</p>}
          {s.ai_enabled && ["ready", "enriching"].includes(st.match_status) && (
            <button className="mt-3 text-sm text-cyan underline-offset-4 hover:underline" onClick={() => run("enrich", { action: "enrich" })}>
              Re-run AI copy for remaining matches
            </button>
          )}
        </section>

        <StagedPicker status={s} call={call} onChanged={refresh} />

        <section className="glass mt-6 rounded-3xl p-5">
          <h2 className="font-display text-lg font-semibold">Rehearsal</h2>
          <p className="mt-1 text-sm text-mist">Fill the room with demo attendees (real embeddings, marked as demo) to rehearse the full show.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            {[100, 500].map((n) => (
              <button
                key={n}
                disabled={!!busy}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm hover:bg-white/10 disabled:opacity-50"
                onClick={async () => {
                  setBusy(`seed${n}`);
                  setError(null);
                  try {
                    for (let added = 0; added < n; added += 25) {
                      await call({ action: "seed", count: Math.min(25, n - added) });
                      setBusy(`seed${n}:${added + 25}`);
                    }
                    await refresh();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {busy?.startsWith(`seed${n}`) ? `Adding… ${busy.split(":")[1] ?? 0}/${n}` : `+ ${n} demo attendees`}
              </button>
            ))}
            <button disabled={!!busy} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm hover:bg-white/10 disabled:opacity-50" onClick={() => run("clear", { action: "clear_demo" })}>
              Remove demo attendees
            </button>
            <button
              disabled={!!busy}
              className="ml-auto rounded-xl border border-pink/40 bg-pink/10 px-4 py-2.5 text-sm text-pink hover:bg-pink/20 disabled:opacity-50"
              onClick={() => {
                if (prompt("This deletes ALL attendees and matches. Type RESET to confirm.") === "RESET") run("reset", { action: "reset", confirm: "RESET" });
              }}
            >
              Reset everything
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="glass rounded-2xl p-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-mist">{label}</p>
      <p className={`mt-1 font-display text-2xl font-bold capitalize ${accent ? "text-cyan" : ""}`}>{value}</p>
      {sub && <p className="mt-0.5 truncate text-xs text-mist">{sub}</p>}
    </div>
  );
}

function StagedPicker({ status, call, onChanged }: { status: Status; call: <T>(b: Record<string, unknown>) => Promise<T>; onChanged: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Person[]>([]);
  const [a, setA] = useState<Person | null>(null);
  const [b, setB] = useState<Person | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const r = await call<{ results: Person[] }>({ action: "search", q });
        setResults(r.results);
      } catch {
        /* ignore */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, call]);

  const current = status.staged;
  return (
    <section className="glass mt-6 rounded-3xl p-5">
      <h2 className="font-display text-lg font-semibold">Featured match (staged)</h2>
      <p className="mt-1 text-sm text-mist">
        Pick the two people revealed on stage. They are always paired together; their “why” is written now, before the show.
      </p>
      {current.length === 2 && (
        <div className="mt-4 rounded-2xl border border-gold/30 bg-gold/10 p-4 text-sm">
          <p className="font-semibold text-gold">
            Locked in: {current[0].full_name} ⟷ {current[1].full_name}
          </p>
          {status.state.staged_why && <p className="mt-1 text-white/85">“{status.state.staged_why}”</p>}
        </div>
      )}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <input className="field" placeholder="Search attendees by name…" value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="mt-2 max-h-72 overflow-auto rounded-2xl border border-white/10">
            {results.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 border-b border-white/5 px-4 py-2.5 last:border-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {p.full_name} {p.is_demo && <span className="font-mono text-[10px] text-gold">demo</span>}
                  </p>
                  <p className="truncate text-xs text-mist">{p.building}</p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button className="rounded-lg bg-white/10 px-2.5 py-1 text-xs hover:bg-white/20" onClick={() => setA(p)}>A</button>
                  <button className="rounded-lg bg-white/10 px-2.5 py-1 text-xs hover:bg-white/20" onClick={() => setB(p)}>B</button>
                </div>
              </li>
            ))}
            {!results.length && <li className="px-4 py-3 text-sm text-mist">No attendees yet.</li>}
          </ul>
        </div>
        <div className="flex flex-col gap-3">
          {[a, b].map((p, i) => (
            <div key={i} className="rounded-2xl border border-dashed border-white/15 p-4">
              <p className="font-mono text-xs text-mist">Person {i ? "B" : "A"}</p>
              <p className="mt-1 font-semibold">{p ? p.full_name : "—"}</p>
              {p && <p className="text-xs text-mist">{p.building}</p>}
            </div>
          ))}
          <div className="flex gap-2">
            <button
              disabled={!a || !b || a.id === b.id || saving}
              className="btn-primary flex-1 rounded-xl py-2.5 text-sm font-semibold disabled:opacity-40"
              onClick={async () => {
                setSaving(true);
                setMsg(null);
                try {
                  await call({ action: "stage", a: a!.id, b: b!.id });
                  setMsg("Saved. The on-stage copy is ready.");
                  onChanged();
                } catch (e) {
                  setMsg(e instanceof Error ? e.message : String(e));
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? "Writing their story…" : "Lock in featured pair"}
            </button>
            {current.length > 0 && (
              <button className="rounded-xl border border-white/10 px-3 text-sm text-mist" onClick={async () => { await call({ action: "stage", a: null, b: null }); onChanged(); }}>
                Clear
              </button>
            )}
          </div>
          {msg && <p className="text-sm text-mist">{msg}</p>}
        </div>
      </div>
    </section>
  );
}
