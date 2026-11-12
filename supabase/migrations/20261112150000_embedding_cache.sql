-- Cache of embeddings by exact text. Rehearsal seeding reuses ~60 distinct
-- demo phrases, so after the first few batches seeding costs no model CPU
-- (edge functions are limited to 2s of CPU per request).
create table public.embedding_cache (
  text text primary key,
  emb extensions.vector(384) not null,
  created_at timestamptz not null default now()
);
alter table public.embedding_cache enable row level security; -- service role only
