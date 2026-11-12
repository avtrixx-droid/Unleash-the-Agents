// POST { full_name, building, need, website? } -> { token, node_no }
// Public endpoint (the phone form). Validates input, creates embeddings with the
// built-in gte-small model and stores the attendee. If matching already ran,
// the latecomer is added to the group where they fit best.
import { admin, clean, cors, embed, json } from "../_shared/server.ts";
import { displayName } from "../_shared/matcher.ts";

const MAX_PARTICIPANTS = Number(Deno.env.get("MAX_PARTICIPANTS") ?? 1000);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }
  // Honeypot: real people never see or fill this field.
  if (clean(body.website, 200)) return json({ token: crypto.randomUUID(), node_no: 0 });

  const full_name = clean(body.full_name, 80);
  const building = clean(body.building, 280);
  const need = clean(body.need, 280);
  if (full_name.length < 2) return json({ error: "Please enter your full name." }, 400);
  if (building.length < 3) return json({ error: "Tell us what you're building." }, 400);
  if (need.length < 3) return json({ error: "Tell us what you need help with." }, 400);

  const db = admin();
  const { count } = await db.from("participants").select("id", { count: "exact", head: true });
  if ((count ?? 0) >= MAX_PARTICIPANTS) return json({ error: "The network is full — find a host!" }, 429);

  const [b, n] = await Promise.all([embed(building), embed(need)]);
  const { data: p, error } = await db
    .from("participants")
    .insert({ full_name, building, need, building_emb: JSON.stringify(b.v), need_emb: JSON.stringify(n.v) })
    .select("id, token, node_no")
    .single();
  if (error || !p) {
    console.error(error);
    return json({ error: "Could not save — please try again." }, 500);
  }
  const { error: nodeErr } = await db
    .from("nodes")
    .insert({ id: p.id, node_no: p.node_no, display_name: displayName(full_name) });
  if (nodeErr) console.error(nodeErr);

  const { data: state } = await db.from("event_state").select("match_status").eq("id", 1).single();
  let late = false;
  if (state && ["ready", "enriching", "enriched"].includes(state.match_status)) {
    const { error: lateErr } = await db.rpc("attach_latecomer", { p_id: p.id });
    if (lateErr) console.error(lateErr);
    late = true;
  }

  return json({ token: p.token, node_no: p.node_no, late });
});
