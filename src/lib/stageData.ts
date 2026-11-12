import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import { useEventState } from "./useEventState";
import { serverNow } from "./clock";
import type { ClusterRow, EventState, NodeRow, Phase, Reveal, StagePair } from "./types";
import { fakePeople } from "../../supabase/functions/_shared/fake.ts";
import {
  displayName,
  hashEmbed,
  PAIR_COLORS,
  runMatching,
  templateCopy,
  topKeywords,
  type Person,
} from "../../supabase/functions/_shared/matcher.ts";

export interface StageData {
  state: EventState | null;
  nodes: NodeRow[];
  pairs: StagePair[];
  clusters: ClusterRow[];
  reveal: Reveal | null;
  /** demo only: drive phases from the keyboard */
  demo?: { setPhase: (p: Phase) => void; addPeople: (n: number) => void };
}

// ---------------------------------------------------------------------------
// Live data
// ---------------------------------------------------------------------------

export function useLiveStage(): StageData {
  const state = useEventState("realtime");
  const [nodes, setNodes] = useState<NodeRow[]>([]);
  const [pairs, setPairs] = useState<StagePair[]>([]);
  const [clusters, setClusters] = useState<ClusterRow[]>([]);
  const [reveal, setReveal] = useState<Reveal | null>(null);

  const loadNodes = useCallback(async () => {
    const all: NodeRow[] = [];
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase
        .from("nodes")
        .select("id, node_no, display_name, cluster_id")
        .order("node_no")
        .range(from, from + 999);
      all.push(...((data as NodeRow[]) ?? []));
      if (!data || data.length < 1000) break;
    }
    setNodes(all);
  }, []);

  useEffect(() => {
    loadNodes();
    const channel = supabase
      .channel("nodes")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "nodes" }, (payload) => {
        const n = payload.new as NodeRow;
        setNodes((prev) => (prev.some((p) => p.id === n.id) ? prev : [...prev, n]));
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "nodes" }, () => loadNodes())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadNodes]);

  // Reset: run id changes and match status goes back to none.
  const runId = state?.run_id;
  const status = state?.match_status;
  useEffect(() => {
    if (status === "none") {
      setPairs([]);
      setClusters([]);
      setReveal(null);
      loadNodes();
    }
  }, [runId, status, loadNodes]);

  useEffect(() => {
    if (!status || !["ready", "enriching", "enriched"].includes(status) || runId == null) return;
    (async () => {
      const [{ data: p }, { data: c }] = await Promise.all([
        supabase.rpc("stage_pairs"),
        supabase.from("clusters").select("id, label, size").eq("run_id", runId).order("id"),
      ]);
      setPairs((p as StagePair[]) ?? []);
      setClusters((c as ClusterRow[]) ?? []);
      await loadNodes(); // picks up cluster ids
    })();
  }, [runId, status, loadNodes]);

  const phase = state?.phase;
  useEffect(() => {
    if (phase === "reveal" || phase === "released") {
      supabase.rpc("stage_reveal").then(({ data }) => setReveal((data as Reveal) ?? null));
    } else setReveal(null);
  }, [phase, status]);

  return { state, nodes, pairs, clusters, reveal };
}

// ---------------------------------------------------------------------------
// Demo: everything simulated in the browser, with the real matcher.
// ---------------------------------------------------------------------------

export function useDemoStage(): StageData {
  const people = useRef<(Person & { node_no: number })[]>([]);
  const pool = useRef(fakePeople(520, 11));
  const [nodes, setNodes] = useState<NodeRow[]>([]);
  const [pairs, setPairs] = useState<StagePair[]>([]);
  const [clusters, setClusters] = useState<ClusterRow[]>([]);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [state, setState] = useState<EventState>({
    phase: "lobby",
    phase_started_at: new Date().toISOString(),
    countdown_ends_at: null,
    match_status: "none",
    run_id: 1,
    enrich_done: 0,
    enrich_total: 0,
  });

  const addPeople = useCallback((count: number) => {
    const added: NodeRow[] = [];
    for (let i = 0; i < count && pool.current.length; i++) {
      const f = pool.current.shift()!;
      const node_no = people.current.length + 1;
      const p = { id: `demo-${node_no}`, name: f.full_name, building: f.building, need: f.need, b: hashEmbed(f.building), n: hashEmbed(f.need), node_no };
      people.current.push(p);
      added.push({ id: p.id, node_no, display_name: displayName(p.name), cluster_id: null });
    }
    setNodes((prev) => [...prev, ...added]);
  }, []);

  // A steady trickle of joins while the lobby / countdown is open.
  useEffect(() => {
    if (state.phase !== "lobby" && state.phase !== "countdown") return;
    const t = setInterval(() => {
      if (state.phase === "countdown" && state.countdown_ends_at && serverNow() > new Date(state.countdown_ends_at).getTime()) return;
      addPeople(state.phase === "countdown" ? 1 + Math.floor(Math.random() * 6) : Math.random() < 0.6 ? 1 : 0);
    }, 260);
    return () => clearInterval(t);
  }, [state.phase, state.countdown_ends_at, addPeople]);

  const setPhase = useCallback((phase: Phase) => {
    const now = new Date(serverNow());
    setState((s) => ({
      ...s,
      phase,
      phase_started_at: now.toISOString(),
      countdown_ends_at: phase === "countdown" ? new Date(now.getTime() + 20_000).toISOString() : s.countdown_ends_at,
      match_status: phase === "lobby" ? "none" : phase === "matching" ? "running" : s.match_status,
    }));
    if (phase === "matching") {
      // Pretend the server takes a few seconds.
      setTimeout(() => {
        const ps = people.current;
        const res = runMatching(ps, ps.length > 3 ? [0, 1] : undefined);
        const allBuild = ps.map((p) => p.building);
        const cl: ClusterRow[] = Array.from({ length: res.clusterCount }, (_, c) => {
          const texts = ps.filter((_, i) => res.clusterOf[i] === c).map((p) => p.building);
          const kw = topKeywords(texts, allBuild, 2);
          return { id: c, size: texts.length, label: kw.map((w) => w[0].toUpperCase() + w.slice(1)).join(" · ") || `Crew ${c + 1}` };
        });
        const pr: StagePair[] = res.groups.map((g, gi) => ({
          code: g.staged ? 1 : 100 + gi,
          color: g.staged ? "#FBBF24" : PAIR_COLORS[gi % PAIR_COLORS.length],
          ids: g.members.map((i) => ps[i].id),
          names: g.members.map((i) => displayName(ps[i].name)),
          tag: templateCopy(g.members.map((i) => ps[i]), gi).tag,
          score: g.score,
          staged: g.staged,
        }));
        const staged = res.groups.find((g) => g.staged);
        if (staged) {
          const members = staged.members.map((i) => ps[i]);
          const copy = templateCopy(members, 2);
          setReveal({
            code: 1,
            color: "#FBBF24",
            why: copy.why,
            icebreaker: copy.icebreaker,
            people: members.map((m) => ({ full_name: m.name, building: m.building, need: m.need })),
          });
        }
        setNodes(ps.map((p, i) => ({ id: p.id, node_no: p.node_no, display_name: displayName(p.name), cluster_id: res.clusterOf[i] })));
        setClusters(cl);
        setPairs(pr);
        setState((s) => ({ ...s, match_status: "ready" }));
      }, 3500);
    }
    if (phase === "lobby") {
      setPairs([]);
      setClusters([]);
    }
  }, []);

  useEffect(() => {
    addPeople(40);
  }, [addPeople]);

  return { state, nodes, pairs, clusters, reveal: state.phase === "reveal" || state.phase === "released" ? reveal : null, demo: { setPhase, addPeople } };
}
