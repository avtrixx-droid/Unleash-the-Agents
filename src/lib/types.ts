export type Phase = "lobby" | "countdown" | "locked" | "matching" | "reveal" | "released";
export type MatchStatus = "none" | "running" | "ready" | "enriching" | "enriched" | "failed";

export interface EventState {
  phase: Phase;
  phase_started_at: string;
  countdown_ends_at: string | null;
  match_status: MatchStatus;
  run_id: number;
  enrich_done: number;
  enrich_total: number;
  staged_a?: string | null;
  staged_b?: string | null;
}

export interface NodeRow {
  id: string;
  node_no: number;
  display_name: string;
  cluster_id: number | null;
}

export interface ClusterRow {
  id: number;
  label: string;
  size: number;
}

export interface StagePair {
  code: number;
  color: string;
  ids: string[];
  names: string[];
  tag: string | null;
  score: number;
  staged: boolean;
}

export interface RevealPerson {
  full_name: string;
  building: string;
  need: string;
}

export interface Reveal {
  code: number;
  color: string;
  why: string;
  icebreaker: string;
  people: RevealPerson[];
}

export interface MyMatch {
  status: "unknown" | "waiting" | "pending" | "matched";
  node_no?: number;
  pair_code?: number;
  color?: string;
  why?: string;
  icebreaker?: string;
  tag?: string;
  ai?: boolean;
  enriched?: boolean;
  partners?: RevealPerson[];
  group?: { label: string; size: number; members: { full_name: string; building: string }[] } | null;
}
