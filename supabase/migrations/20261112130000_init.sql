-- Unleash the Agents: schema
-- Attendee data (participants, matches) is never readable with the public key.
-- Phones and the stage read it only through the narrow RPCs below.

create extension if not exists vector with schema extensions;

-- Single-row show state. Public read; written only by the `host` edge function.
create table public.event_state (
  id int primary key default 1 check (id = 1),
  phase text not null default 'lobby'
    check (phase in ('lobby', 'countdown', 'locked', 'matching', 'reveal', 'released')),
  phase_started_at timestamptz not null default now(),
  countdown_ends_at timestamptz,
  match_status text not null default 'none'
    check (match_status in ('none', 'running', 'ready', 'enriching', 'enriched', 'failed')),
  run_id int not null default 0,
  staged_a uuid,
  staged_b uuid,
  staged_why text,
  staged_icebreaker text,
  enrich_done int not null default 0,
  enrich_total int not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.event_state default values;
alter table public.event_state enable row level security;
create policy "event state is public" on public.event_state for select to anon, authenticated using (true);

create table public.participants (
  id uuid primary key default gen_random_uuid(),
  token uuid not null unique default gen_random_uuid(),
  node_no int generated always as identity,
  full_name text not null check (char_length(full_name) between 2 and 80),
  building text not null check (char_length(building) between 3 and 280),
  need text not null check (char_length(need) between 3 and 280),
  building_emb extensions.vector(384),
  need_emb extensions.vector(384),
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.participants enable row level security; -- no policies: service role only

-- What the big screen may know about a person: a short display name.
create table public.nodes (
  id uuid primary key references public.participants (id) on delete cascade,
  node_no int not null,
  display_name text not null,
  cluster_id int,
  created_at timestamptz not null default now()
);
alter table public.nodes enable row level security;
create policy "nodes are public" on public.nodes for select to anon, authenticated using (true);

create table public.clusters (
  run_id int not null,
  id int not null,
  label text not null,
  size int not null,
  primary key (run_id, id)
);
alter table public.clusters enable row level security;
create policy "clusters are public" on public.clusters for select to anon, authenticated using (true);

create table public.matches (
  id bigint generated always as identity primary key,
  run_id int not null,
  pair_code int not null,
  color text not null,
  member_ids uuid[] not null,
  score real not null default 0,
  tag text,
  why text not null,
  icebreaker text not null,
  is_staged boolean not null default false,
  ai_written boolean not null default false
);
create index matches_members_idx on public.matches using gin (member_ids);
create index matches_run_idx on public.matches (run_id);
alter table public.matches enable row level security; -- no policies: service role only

alter publication supabase_realtime add table public.event_state, public.nodes;

-- Server clock, so phones and the stage can correct for their own clock skew.
create function public.server_now() returns timestamptz
language sql stable set search_path = '' as $$ select now() $$;

-- A phone's own match. Only after the host releases matches; only for the
-- holder of the secret token returned at sign-up.
create function public.get_my_match(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  st public.event_state;
  me public.participants;
  m public.matches;
  my_cluster int;
begin
  select * into st from public.event_state where id = 1;
  select * into me from public.participants where token = p_token;
  if not found then return jsonb_build_object('status', 'unknown'); end if;
  if st.phase <> 'released' then
    return jsonb_build_object('status', 'waiting', 'node_no', me.node_no);
  end if;
  select * into m from public.matches where run_id = st.run_id and me.id = any (member_ids) limit 1;
  if not found then return jsonb_build_object('status', 'pending', 'node_no', me.node_no); end if;
  select cluster_id into my_cluster from public.nodes where id = me.id;

  return jsonb_build_object(
    'status', 'matched',
    'node_no', me.node_no,
    'pair_code', m.pair_code,
    'color', m.color,
    'why', m.why,
    'icebreaker', m.icebreaker,
    'tag', m.tag,
    'ai', m.ai_written,
    'enriched', st.match_status = 'enriched',
    'partners', (
      select coalesce(jsonb_agg(jsonb_build_object('full_name', p.full_name, 'building', p.building, 'need', p.need)), '[]'::jsonb)
      from public.participants p where p.id = any (m.member_ids) and p.id <> me.id
    ),
    'group', (
      select jsonb_build_object(
        'label', c.label,
        'size', c.size,
        'members', (
          select coalesce(jsonb_agg(jsonb_build_object('full_name', g.full_name, 'building', g.building)), '[]'::jsonb)
          from (
            select p.full_name, p.building
            from public.nodes n join public.participants p on p.id = n.id
            where n.cluster_id = my_cluster and p.id <> me.id
            order by p.node_no
            limit 40
          ) g
        )
      )
      from public.clusters c where c.run_id = st.run_id and c.id = my_cluster
    )
  );
end $$;

-- Pairs for the big screen's constellation and agent feed (display names only).
create function public.stage_pairs() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'code', m.pair_code,
      'color', m.color,
      'ids', to_jsonb(m.member_ids),
      'names', (select jsonb_agg(n.display_name order by n.node_no) from public.nodes n where n.id = any (m.member_ids)),
      'tag', m.tag,
      'score', m.score,
      'staged', m.is_staged
    ) order by m.pair_code), '[]'::jsonb)
  from public.matches m, public.event_state st
  where st.id = 1 and m.run_id = st.run_id and st.match_status in ('ready', 'enriching', 'enriched');
$$;

-- The staged pair, only once the host has triggered the reveal.
create function public.stage_reveal() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'code', m.pair_code,
    'color', m.color,
    'why', m.why,
    'icebreaker', m.icebreaker,
    'people', (
      select jsonb_agg(jsonb_build_object('full_name', p.full_name, 'building', p.building, 'need', p.need) order by p.node_no)
      from public.participants p where p.id = any (m.member_ids)
    )
  )
  from public.matches m, public.event_state st
  where st.id = 1 and st.phase in ('reveal', 'released') and m.run_id = st.run_id and m.is_staged
  limit 1;
$$;

revoke execute on function public.get_my_match(uuid), public.stage_pairs(), public.stage_reveal() from public;
grant execute on function public.server_now(), public.get_my_match(uuid), public.stage_pairs(), public.stage_reveal()
  to anon, authenticated;
