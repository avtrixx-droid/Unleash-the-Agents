import { supabase } from "./supabase";

// Offset between this device's clock and the database clock, so countdowns
// line up on the projector and on 500 phones.
let offsetMs = 0;
let synced = false;

export async function syncClock(): Promise<void> {
  try {
    const samples: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t0 = Date.now();
      const { data } = await supabase.rpc("server_now");
      const t1 = Date.now();
      if (data) samples.push(new Date(data as string).getTime() - (t0 + t1) / 2);
    }
    if (samples.length) {
      samples.sort((a, b) => a - b);
      offsetMs = samples[Math.floor(samples.length / 2)];
      synced = true;
    }
  } catch {
    /* keep local clock */
  }
}

export const serverNow = () => Date.now() + offsetMs;
export const clockSynced = () => synced;
