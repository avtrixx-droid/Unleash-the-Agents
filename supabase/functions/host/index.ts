// Host remote. Every request needs the `x-host-pin` header to equal the
// HOST_PIN edge-function secret. Body: { action, ...args }.
import { admin, type Admin, clean, cors, embed, json, parseVector } from "../_shared/server.ts";
import {
  displayName,
  firstName,
  hashEmbed,
  PAIR_COLORS,
  runMatching,
  templateCopy,
  topKeywords,
  type Person,
} from "../_shared/matcher.ts";
import { fakePeople } from "../_shared/fake.ts";
import { batchSize, concurrency, llmLabel, llmProvider, nameClusters, writePairCopy } from "../_shared/llm.ts";

function pinOk(given: string | null): boolean {
  const pin = Deno.env.get("HOST_PIN") ?? "";
  if (!pin || !given || given.length !== pin.length) return false;
  let diff = 0;
  for (let i = 0; i < pin.length; i++) diff |= pin.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!Deno.env.get("HOST_PIN")) return json({ error: "Set the HOST_PIN edge-function secret first." }, 503);
  if (!pinOk(req.headers.get("x-host-pin"))) return json({ error: "Wrong PIN" }, 401);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const db = admin();
  try {
    switch (body.action) {
      case "status":
        return json(await status(db));
      case "search":
        return json(await search(db, clean(body.q, 60)));
      case "phase":
        return json(await setPhase(db, String(body.phase), Number(body.seconds ?? 60)));
      case "stage":
        return json(await setStaged(db, body.a ? String(body.a) : null, body.b ? String(body.b) : null));
      case "match":
        return json(await runMatch(db));
      case "enrich":
        EdgeRuntime.waitUntil(enrich(db));
        return json({ ok: true });
      case "seed":
        return json(await seed(db, Math.min(25, Math.max(1, Number(body.count ?? 25)))));
      case "clear_demo":
        await db.from("participants").delete().eq("is_demo", true);
        return json({ ok: true });
      case "reset":
        if (body.confirm !== "RESET") return json({ error: "confirm with RESET" }, 400);
        return json(await reset(db));
      default:
        return json({ error: "unknown action" }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

async function getState(db: Admin) {
  const { data, error } = await db.from("event_state").select("*").eq("id", 1).single();
  if (error) throw error;
  return data;
}

async function patchState(db: Admin, patch: Record<string, unknown>) {
  const { error } = await db.from("event_state").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", 1);
  if (error) throw error;
}

async function status(db: Admin) {
  const [state, all, demo] = await Promise.all([
    getState(db),
    db.from("participants").select("id", { count: "exact", head: true }),
    db.from("participants").select("id", { count: "exact", head: true }).eq("is_demo", true),
  ]);
  const stagedIds = [state.staged_a, state.staged_b].filter(Boolean);
  const staged = stagedIds.length
    ? (await db.from("participants").select("id, full_name, building, need").in("id", stagedIds)).data ?? []
    : [];
  return { state, participants: all.count ?? 0, demo: demo.count ?? 0, staged, ai: llmLabel(), ai_enabled: !!llmProvider() };
}

async function search(db: Admin, q: string) {
  let query = db.from("participants").select("id, node_no, full_name, building, is_demo").order("is_demo").order("node_no", { ascending: false }).limit(20);
  if (q) query = query.ilike("full_name", `%${q.replace(/[%_]/g, "")}%`);
  const { data, error } = await query;
  if (error) throw error;
  return { results: data };
}

async function setPhase(db: Admin, phase: string, seconds: number) {
  const allowed = ["lobby", "countdown", "locked", "reveal", "released"];
  if (!allowed.includes(phase)) throw new Error(`phase must be one of ${allowed.join(", ")}`);
  const now = new Date();
  const patch: Record<string, unknown> = { phase, phase_started_at: now.toISOString() };
  if (phase === "countdown") patch.countdown_ends_at = new Date(now.getTime() + Math.max(5, Math.min(600, seconds)) * 1000).toISOString();
  if (phase === "lobby") patch.countdown_ends_at = null;
  await patchState(db, patch);
  return { ok: true, phase };
}

async function setStaged(db: Admin, a: string | null, b: string | null) {
  await patchState(db, { staged_a: a, staged_b: b, staged_why: null, staged_icebreaker: null });
  if (!a || !b || a === b) return { ok: true, copy: null };
  const { data } = await db.from("participants").select("id, full_name, building, need").in("id", [a, b]);
  if (!data || data.length !== 2) throw new Error("staged people not found");
  const ordered = [data.find((p) => p.id === a)!, data.find((p) => p.id === b)!];
  // Write the on-stage copy now, before the show, so the reveal never waits.
  let copy = templateCopy(ordered.map(toTemplatePerson), 1);
  try {
    const ai = await writePairCopy([
      { key: "staged", people: ordered.map((p) => ({ first: firstName(p.full_name), building: p.building, need: p.need })) },
    ]);
    const c = ai.get("staged");
    if (c) copy = c;
  } catch (e) {
    console.warn("staged copy failed", e);
  }
  await patchState(db, { staged_why: copy.why, staged_icebreaker: copy.icebreaker });
  return { ok: true, copy };
}

function toTemplatePerson(p: { id: string; full_name: string; building: string; need: string }): Person {
  return { id: p.id, name: p.full_name, building: p.building, need: p.need, b: hashEmbed(p.building), n: hashEmbed(p.need) };
}

type Row = { id: string; full_name: string; building: string; need: string; building_emb: unknown; need_emb: unknown; node_no: number };

async function loadPeople(db: Admin): Promise<(Person & { node_no: number })[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await db
      .from("participants")
      .select("id, full_name, building, need, building_emb, need_emb, node_no")
      .order("node_no")
      .range(from, from + 499);
    if (error) throw error;
    rows.push(...(data as Row[]));
    if (!data || data.length < 500) break;
  }
  return rows.map((r) => ({
    id: r.id,
    name: r.full_name,
    building: r.building,
    need: r.need,
    node_no: r.node_no,
    b: parseVector(r.building_emb) ?? hashEmbed(r.building),
    n: parseVector(r.need_emb) ?? hashEmbed(r.need),
  }));
}

async function runMatch(db: Admin) {
  const state = await getState(db);
  if (state.match_status === "running") throw new Error("matching is already running");
  const runId = state.run_id + 1;
  await patchState(db, {
    phase: "matching",
    phase_started_at: new Date().toISOString(),
    match_status: "running",
    run_id: runId,
    enrich_done: 0,
    enrich_total: 0,
  });

  try {
    const people = await loadPeople(db);
    const t0 = performance.now();
    const ia = people.findIndex((p) => p.id === state.staged_a);
    const ib = people.findIndex((p) => p.id === state.staged_b);
    const res = runMatching(people, ia >= 0 && ib >= 0 ? [ia, ib] : undefined);
    console.log(`matched ${people.length} people in ${(performance.now() - t0).toFixed(0)}ms`);

    // Clusters: keyword labels now, AI names later.
    const allBuild = people.map((p) => p.building);
    const clusterRows = Array.from({ length: res.clusterCount }, (_, c) => {
      const texts = people.filter((_, i) => res.clusterOf[i] === c).map((p) => p.building);
      const kw = topKeywords(texts, allBuild, 2);
      return {
        run_id: runId,
        id: c,
        size: texts.length,
        label: kw.length ? kw.map((w) => w[0].toUpperCase() + w.slice(1)).join(" · ") : `Crew ${c + 1}`,
      };
    });
    if (clusterRows.length) {
      const { error } = await db.from("clusters").insert(clusterRows);
      if (error) throw error;
    }
    const nodeRows = people.map((p, i) => ({ id: p.id, node_no: p.node_no, display_name: displayName(p.name), cluster_id: res.clusterOf[i] ?? null }));
    for (let i = 0; i < nodeRows.length; i += 500) {
      const { error } = await db.from("nodes").upsert(nodeRows.slice(i, i + 500));
      if (error) throw error;
    }

    // Pair codes: shuffled 3-digit numbers so neighbours aren't 101/102.
    const codes = res.groups.map((_, i) => 100 + i);
    for (let i = codes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [codes[i], codes[j]] = [codes[j], codes[i]];
    }
    const matchRows = res.groups.map((g, gi) => {
      const members = g.members.map((i) => people[i]);
      const t = templateCopy(members, gi);
      const staged = g.staged && state.staged_why;
      return {
        run_id: runId,
        pair_code: g.staged ? 1 : codes[gi],
        color: g.staged ? "#FBBF24" : PAIR_COLORS[gi % PAIR_COLORS.length],
        member_ids: members.map((m) => m.id),
        score: Number(g.score.toFixed(4)),
        tag: t.tag,
        why: staged ? state.staged_why : t.why,
        icebreaker: staged ? state.staged_icebreaker ?? t.icebreaker : t.icebreaker,
        is_staged: g.staged,
        ai_written: !!staged && llmProvider() !== null,
      };
    });
    for (let i = 0; i < matchRows.length; i += 500) {
      const { error } = await db.from("matches").insert(matchRows.slice(i, i + 500));
      if (error) throw error;
    }

    await patchState(db, { match_status: "ready", enrich_total: llmProvider() ? matchRows.length : 0 });

    // Anyone who joined while we were computing.
    const known = new Set(people.map((p) => p.id));
    const { data: latest } = await db.from("participants").select("id").order("node_no", { ascending: false }).limit(50);
    for (const p of latest ?? []) if (!known.has(p.id)) await db.rpc("attach_latecomer", { p_id: p.id });

    if (llmProvider()) EdgeRuntime.waitUntil(enrich(db));
    return { ok: true, run_id: runId, people: people.length, groups: matchRows.length, clusters: clusterRows.length };
  } catch (e) {
    await patchState(db, { match_status: "failed" });
    throw e;
  }
}

async function enrich(db: Admin) {
  if (!llmProvider()) return;
  const state = await getState(db);
  const runId = state.run_id;
  await patchState(db, { match_status: "enriching" });

  const { data: matches } = await db
    .from("matches")
    .select("id, member_ids, is_staged, ai_written")
    .eq("run_id", runId)
    .order("is_staged", { ascending: false });
  const todo = (matches ?? []).filter((m) => !m.ai_written);
  await patchState(db, { enrich_total: (matches ?? []).length });
  const ids = [...new Set(todo.flatMap((m) => m.member_ids as string[]))];
  const byId = new Map<string, { full_name: string; building: string; need: string }>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from("participants").select("id, full_name, building, need").in("id", ids.slice(i, i + 200));
    for (const p of data ?? []) byId.set(p.id, p);
  }

  let done = (matches ?? []).length - todo.length;
  const batches: (typeof todo)[] = [];
  for (let i = 0; i < todo.length; i += batchSize()) batches.push(todo.slice(i, i + batchSize()));

  const worker = async () => {
    for (let batch = batches.shift(); batch; batch = batches.shift()) {
      try {
        const copy = await writePairCopy(
          batch.map((m) => ({
            key: String(m.id),
            people: (m.member_ids as string[])
              .map((id) => byId.get(id))
              .filter(Boolean)
              .map((p) => ({ first: firstName(p!.full_name), building: p!.building, need: p!.need })),
          })),
        );
        await Promise.all(
          batch.map((m) => {
            const c = copy.get(String(m.id));
            return c ? db.from("matches").update({ ...c, ai_written: true }).eq("id", m.id) : null;
          }),
        );
        done += batch.length;
        await patchState(db, { enrich_done: done });
      } catch (e) {
        console.warn("pair copy batch failed (template copy stays)", e);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency() }, worker));

  try {
    const { data: clusters } = await db.from("clusters").select("id").eq("run_id", runId);
    const { data: nodes } = await db.from("nodes").select("id, cluster_id");
    const samples = new Map<number, string[]>();
    for (const n of nodes ?? []) {
      const p = byId.get(n.id);
      if (p && n.cluster_id != null) {
        const list = samples.get(n.cluster_id) ?? [];
        if (list.length < 12) list.push(p.building);
        samples.set(n.cluster_id, list);
      }
    }
    const names = await nameClusters((clusters ?? []).map((c) => ({ key: String(c.id), samples: samples.get(c.id) ?? [] })));
    await Promise.all([...names].map(([id, label]) => db.from("clusters").update({ label }).eq("run_id", runId).eq("id", Number(id))));
  } catch (e) {
    console.warn("cluster naming failed (keyword labels stay)", e);
  }

  const latest = await getState(db);
  if (latest.run_id === runId) await patchState(db, { match_status: "enriched" });
}

// Edge functions get 2s of CPU per request and each gte-small embedding costs
// a few hundred ms, so seeding embeds at most a few new texts per call and
// caches them. Demo people reuse ~60 phrases, so the cache fills quickly and
// later batches cost almost nothing. The host page simply calls again.
const NEW_EMBEDDINGS_PER_CALL = 3;

async function seed(db: Admin, count: number) {
  const fakes = fakePeople(count, Math.floor(Math.random() * 1e9));
  const texts = [...new Set(fakes.flatMap((f) => [f.building, f.need]))];
  const { data: cached, error: cacheErr } = await db.from("embedding_cache").select("text, emb").in("text", texts);
  if (cacheErr) throw cacheErr;
  const vec = new Map<string, string>((cached ?? []).map((r) => [r.text as string, String(r.emb)]));

  const fresh: { text: string; emb: string }[] = [];
  for (const t of texts.filter((t) => !vec.has(t)).slice(0, NEW_EMBEDDINGS_PER_CALL)) {
    const e = await embed(t);
    if (!e.model) continue;
    const s = JSON.stringify(e.v);
    vec.set(t, s);
    fresh.push({ text: t, emb: s });
  }
  if (fresh.length) await db.from("embedding_cache").upsert(fresh);

  const ready = fakes.filter((f) => vec.has(f.building) && vec.has(f.need));
  const warming = texts.some((t) => !vec.has(t));
  if (!ready.length) return { ok: true, added: 0, warming };

  const rows = ready.map((f) => ({ ...f, building_emb: vec.get(f.building), need_emb: vec.get(f.need), is_demo: true }));
  const { data, error } = await db.from("participants").insert(rows).select("id, node_no, full_name");
  if (error) throw error;
  const { error: nodeErr } = await db
    .from("nodes")
    .insert(data!.map((p) => ({ id: p.id, node_no: p.node_no, display_name: displayName(p.full_name) })));
  if (nodeErr) throw nodeErr;
  return { ok: true, added: data!.length, warming };
}

async function reset(db: Admin) {
  const state = await getState(db);
  await db.from("matches").delete().gte("id", 0);
  await db.from("clusters").delete().gte("id", 0);
  await db.from("participants").delete().not("id", "is", null);
  await patchState(db, {
    phase: "lobby",
    phase_started_at: new Date().toISOString(),
    countdown_ends_at: null,
    match_status: "none",
    run_id: state.run_id + 1,
    staged_a: null,
    staged_b: null,
    staged_why: null,
    staged_icebreaker: null,
    enrich_done: 0,
    enrich_total: 0,
  });
  return { ok: true };
}
