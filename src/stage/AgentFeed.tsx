import { useEffect, useRef, useState } from "react";
import type { NodeRow, StagePair } from "../lib/types";

interface Line {
  id: number;
  agent: string;
  text: string;
  kind: "scan" | "match" | "sys";
}

const VERBS = [
  (n: string) => `reading ${n}'s profile`,
  (n: string) => `embedding "${n}" → 384d`,
  (n: string) => `what does ${n} need?`,
  (n: string) => `scoring ${n} against ${Math.floor(200 + Math.random() * 300)} builders`,
  (n: string) => `${n}: need ⟷ build overlap…`,
];

/** Scrolling "agent log" panel on the right of the matching screen. */
export function AgentFeed({ nodes, pairs, showPairs, startedAt }: { nodes: NodeRow[]; pairs: StagePair[]; showPairs: boolean; startedAt: number }) {
  const [lines, setLines] = useState<Line[]>([]);
  const idRef = useRef(0);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const push = (l: Omit<Line, "id">) => setLines((prev) => [...prev.slice(-15), { ...l, id: idRef.current++ }]);
  const agent = () => `agent-${String(1 + Math.floor(Math.random() * 16)).padStart(2, "0")}`;

  useEffect(() => {
    setLines([]);
    push({ agent: "orchestrator", text: `spawning 16 matching agents`, kind: "sys" });
  }, [startedAt]);

  useEffect(() => {
    if (showPairs) return;
    const t = setInterval(() => {
      const ns = nodesRef.current;
      if (!ns.length) return;
      const n = ns[Math.floor(Math.random() * ns.length)].display_name;
      push({ agent: agent(), text: VERBS[Math.floor(Math.random() * VERBS.length)](n), kind: "scan" });
    }, 140);
    return () => clearInterval(t);
  }, [showPairs]);

  useEffect(() => {
    if (!showPairs || !pairs.length) return;
    const scores = pairs.map((p) => p.score);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const fit = (s: number) => Math.round(72 + ((s - min) / Math.max(1e-6, max - min)) * 27);
    const order = [...pairs].filter((p) => !p.staged).sort(() => Math.random() - 0.5);
    let i = 0;
    push({ agent: "orchestrator", text: `${pairs.length} matches converged`, kind: "sys" });
    const t = setInterval(() => {
      const p = order[i++];
      if (!p) {
        clearInterval(t);
        push({ agent: "orchestrator", text: "all agents done ✓", kind: "sys" });
        return;
      }
      push({ agent: agent(), text: `${p.names.join(" ⟷ ")} · ${fit(p.score)}%`, kind: "match" });
    }, 110);
    return () => clearInterval(t);
  }, [showPairs, pairs]);

  return (
    <aside className="glass absolute bottom-10 right-10 top-28 w-[min(520px,34vw)] overflow-hidden rounded-3xl rise">
      <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
        <span className="font-mono text-xs uppercase tracking-[0.3em] text-mist">agent feed</span>
        <span className="flex gap-1.5">
          <span className="h-2 w-2 rounded-full bg-pink/80" />
          <span className="h-2 w-2 rounded-full bg-gold/80" />
          <span className="h-2 w-2 rounded-full bg-cyan/80" />
        </span>
      </div>
      <div className="flex h-full flex-col justify-end gap-2 px-6 pb-20 font-mono text-[14px] leading-snug">
        {lines.map((l) => (
          <div key={l.id} className="rise truncate whitespace-nowrap" style={{ animationDuration: "0.35s" }}>
            <span className={l.kind === "sys" ? "text-gold" : "text-violet-300"}>{l.agent}</span>
            <span className="text-white/30"> › </span>
            <span className={l.kind === "match" ? "text-white" : l.kind === "sys" ? "text-gold/90" : "text-mist"}>{l.text}</span>
            {l.kind === "match" && <span className="text-cyan"> ✓</span>}
          </div>
        ))}
      </div>
    </aside>
  );
}
