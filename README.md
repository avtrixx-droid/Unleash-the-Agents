# Unleash the Agents

A live matchmaking show for a room of up to ~500 builders. People scan a QR
code, answer three questions, and after a 60-second countdown the big screen
plays an "agents are matching" sequence, reveals one staged featured match,
then sends everyone their own match on their phone, ready for the coffee break.

| Route | Who | What |
|---|---|---|
| `/` | attendees' phones | form → synced countdown → matching → match card + "Find me" beacon + crew list |
| `/stage` | projector | QR + live constellation → countdown ring → swirl + agent feed → crews → featured reveal |
| `/host` | you (PIN) | run of show, featured pair picker, rehearsal tools, reset |

Add `?demo` to `/stage` or `/` to run everything in the browser without the
backend (stage keys: `1`–`6` phases, `+` adds 25 people). On `/stage`, `F`
toggles fullscreen and `M` mutes.

## Sound

The stage has a synthesised cinematic score (no audio files): an evolving
pad, bell chimes as people join, a heartbeat for the last 10 seconds, an
arpeggiator with a riser while agents match, an impact when matches lock in,
a "braam" for the reveal and a celebration on release. To use your own audio
for any cue, add `public/sounds/<cue>.mp3` where cue is one of `ambient`
(looped), `join`, `tick`, `heartbeat`, `matching` (looped), `lock`, `reveal`,
`release`.

## How matching works

1. **On submit** (`join` edge function) the answers are embedded with Supabase's
   built-in `gte-small` model: free, no API key, and the text never leaves the
   Supabase project.
2. **On "Run matching"** (`host` edge function) every pair is scored by
   `need(A)·build(B) + need(B)·build(A) + 0.3·build(A)·build(B)`, paired greedily
   with a swap-improvement pass (everyone gets exactly one match; odd count →
   one trio; the staged pair is fixed), and grouped into crews with k-means.
   500 people take ~0.3s.
3. **Optional AI copy** writes each pair's "why you two" line, an icebreaker and
   crew names, in the background. Without a key, template copy is used, and
   the show never waits on an AI call.
4. **Latecomers** are added to the existing pair they fit best (pgvector query).

## Setup

The database schema and both edge functions are already deployed to Supabase
project `biavgtzrylxjeeikdjus`. What's left:

**1. Set the host PIN** (required to use `/host`):

```bash
supabase secrets set HOST_PIN=choose-a-pin --project-ref biavgtzrylxjeeikdjus
```

**2. (Optional) Turn on AI copy.** Pick one:

```bash
# Claude
supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref biavgtzrylxjeeikdjus
```

```bash
# Any OpenAI-compatible endpoint, e.g. Cloudflare Workers AI (no training, no retention)
supabase secrets set LLM_BASE_URL=https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1 LLM_API_KEY=<token> LLM_MODEL=<model-id> LLM_CONCURRENCY=2 --project-ref biavgtzrylxjeeikdjus
```

Free tiers have low rate limits: keep `LLM_CONCURRENCY` at 1–2 and raise
`LLM_BATCH` (pairs per request, default 20, max 40) to need fewer requests.

**3. Deploy the frontend** (Vercel, Netlify, anything static):

```bash
npm install
```

```bash
npm run build
```

Deploy `dist/`. `vercel.json` already rewrites `/stage` and `/host` to the SPA.
Set `VITE_PUBLIC_URL` if the QR code should show a short custom domain.

**Redeploying functions after code changes:**

```bash
supabase functions deploy join host --project-ref biavgtzrylxjeeikdjus
```

## Run of show

1. Before doors: open `/host`, add 500 demo attendees, run the full show
   once on the projector, then **Remove demo attendees**.
2. Ask your two featured people to sign up early; pick them in
   **Featured match**. Their on-stage text is written right then.
3. **Open lobby**: QR on screen. **Start countdown** when the room is ready.
4. **Run matching**: ~9s+ of swirl and agent feed, then crews form.
5. **Reveal featured match**, then **Release to phones**.

## Capacity notes

- Realtime is used by the stage only. Phones poll the show state every ~2s,
  because Supabase realtime allows 200 concurrent connections on Free and
  500 on Pro.
- `MAX_PARTICIPANTS` (edge secret, default 1000) caps sign-ups.

## Data

- `participants` and `matches` have RLS with no public policies. Phones read
  only their own match through `get_my_match(token)`, and only after release.
- The stage shows first name + last initial only.
- Hit **Reset everything** in `/host` after the event to delete all attendee data.

## Development

```bash
npm run dev
```

```bash
npm run test:matcher
```
