# Unleash the Agents: live matchmaker

People scan a QR code on the big screen and fill in a short form within a 60-second window. The screen and every phone then play an in-sync matching show. One staged match is revealed on stage, and everyone gets their match on their phone so they can meet in the coffee break.

## Decisions so far

| Topic | Decision |
|---|---|
| Form fields | **Full name**, **What are you building?**, **What do you need help with?** (no SID, to avoid compliance issues) |
| Headcount | Up to **500** |
| Matching output | A guaranteed **1:1 match** for everyone, plus a **group** of people working on similar things ("your tribe"). Odd count leaves one group of 3. |
| Staged reveal | The host picks two people in `/host`. Their pair is forced and revealed on stage. |
| Stack | Vite + React + Tailwind, Supabase (Postgres + pgvector + Realtime + Edge Functions), hosted on Vercel |
| AI | Free, built-in embeddings for the matching; an LLM only for the "why you two" text (optional, with a template fallback) |

## Surfaces

- **`/stage`**: fullscreen on the projector. A canvas or WebGL constellation of up to 500 nodes, the QR code, the countdown, the matching animation and the reveal.
- **`/join`**: the phone form, a synced countdown, the matching animation and the match card.
- **`/host`**: a hidden remote (with a PIN) that drives the phases: Open → Countdown → Match → Reveal → Release to phones → Reset.

## Phases (broadcast over Supabase Realtime so every screen moves together)

1. **Lobby**: the QR code. Each person who submits appears as a glowing node, and a live counter ticks up.
2. **Countdown (60s)**: a ring timer on the stage and on phones, then submissions lock.
3. **Matching**: nodes swirl, test connections and settle into labelled theme clusters. Runs at least 8 seconds, and until the matches are ready.
4. **Stage reveal**: the staged pair flies to centre with names, what they're building and why they should talk.
5. **Release**: each phone shows its match card: name, what they're building, why, and an icebreaker. It also has a "Find me" beacon (full-screen colour + pair number to hold up in the crowd) and the person's group list.

## Matching pipeline (no paid AI required)

1. **On submit**, a Supabase Edge Function creates embeddings for the "building" and "need" texts with Supabase's built-in `gte-small` model (free, no API key) and stores them in pgvector. Attendee data stays inside our Supabase project.
2. **On "Match"**, a server function scores every pair:
   `score(A,B) = sim(A.need, B.building) + sim(B.need, A.building) + 0.3 · sim(A.building, B.building)`
   That's 125k pairs for 500 people, which takes milliseconds. Pairs are picked greedily by highest score, with a local-swap pass to improve the result. The staged pair is fixed first.
3. **Groups**: k-means on the "building" embeddings. Each cluster is labelled by an LLM if one is configured, or by its top keywords otherwise.
4. **"Why you two" + icebreaker**: an LLM in parallel batches of about 25 pairs, if a key is configured. Otherwise a template built from the shared keywords.
5. **Late joiners** are added to their best existing pair, making a group of 3.

The LLM provider is pluggable via environment variables: Claude (recommended, since API data isn't used for training), or a free tier (Gemini / Groq). The show never depends on it: if it errors or times out, the template text is used.

## Premium feel

Dark theme with a gradient glow, frosted-glass cards and a strong display font. A 60fps canvas constellation. Sound design on the stage (ambient hum, a rising whoosh, a lock-in hit). Haptics on Android. Keyboard shortcuts on `/stage` as a backup to `/host`.

## Build order

1. Scaffold, Supabase schema and realtime phase sync (stage + phone + host).
2. Join form and the lobby constellation.
3. Embeddings, the matcher and groups, plus a seeding script with 500 fake attendees for load tests.
4. The matching animation and the stage reveal.
5. Phone match card, "Find me" beacon and group list.
6. Polish: sound, motion and a rehearsal mode.

## Open items

- Supabase project for this event (new, or reuse the `tech-event` one?)
- LLM key: Claude, a free tier, or templates only
- Event branding (logo, colours), if any
