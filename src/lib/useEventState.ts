import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { syncClock } from "./clock";
import type { EventState } from "./types";

const COLUMNS = "phase, phase_started_at, countdown_ends_at, match_status, run_id, enrich_done, enrich_total";

/**
 * The show state. `realtime` is for the single big screen; phones poll
 * (Supabase's realtime connection quota is 200 on Free / 500 on Pro, and we
 * expect ~500 phones).
 */
export function useEventState(mode: "realtime" | "poll", pollMs = 2000): EventState | null {
  const [state, setState] = useState<EventState | null>(null);

  useEffect(() => {
    let alive = true;
    syncClock();
    const fetchState = async () => {
      const { data } = await supabase.from("event_state").select(COLUMNS).eq("id", 1).single();
      if (alive && data) setState(data as EventState);
    };
    fetchState();

    if (mode === "realtime") {
      const channel = supabase
        .channel("event_state")
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "event_state" }, (payload) => {
          if (alive) setState(payload.new as EventState);
        })
        .subscribe();
      // Safety net in case a realtime message is missed.
      const t = setInterval(fetchState, 10_000);
      return () => {
        alive = false;
        clearInterval(t);
        supabase.removeChannel(channel);
      };
    }

    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      await fetchState();
      // Poll slower when the tab is hidden; jitter spreads 500 phones out.
      const delay = document.hidden ? pollMs * 3 : pollMs + Math.random() * 400;
      timer = setTimeout(loop, delay);
    };
    timer = setTimeout(loop, pollMs);
    const onVis = () => !document.hidden && fetchState();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [mode, pollMs]);

  return state;
}

/** Countdown is over once the server clock passes countdown_ends_at. */
export function effectivePhase(state: EventState | null, now: number) {
  if (!state) return null;
  if (state.phase === "countdown" && state.countdown_ends_at && now >= new Date(state.countdown_ends_at).getTime()) return "locked";
  return state.phase;
}
