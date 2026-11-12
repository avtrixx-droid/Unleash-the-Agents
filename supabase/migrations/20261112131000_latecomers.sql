-- Attach someone who joined after matching to the existing group they fit best
-- (complementary need/build similarity via pgvector; prefers pairs over trios).
-- Service role only: called by the `join` and `host` edge functions.
create function public.attach_latecomer(p_id uuid) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  st public.event_state;
  me public.participants;
  target bigint;
  target_cluster int;
begin
  select * into st from public.event_state where id = 1;
  if st.match_status not in ('ready', 'enriching', 'enriched') then return null; end if;
  select * into me from public.participants where id = p_id;
  if not found then return null; end if;
  if exists (select 1 from public.matches where run_id = st.run_id and p_id = any (member_ids)) then return null; end if;

  select m.id into target
  from public.matches m
  join public.participants p on p.id = any (m.member_ids)
  where m.run_id = st.run_id and not m.is_staged and cardinality(m.member_ids) < 4
  group by m.id
  order by
    (cardinality(m.member_ids) >= 3) asc,
    avg(
      coalesce(-(p.need_emb operator(extensions.<#>) me.building_emb), 0)
      + coalesce(-(p.building_emb operator(extensions.<#>) me.need_emb), 0)
    ) desc
  limit 1;
  if target is null then return null; end if;

  update public.matches
  set member_ids = member_ids || p_id,
      why = why || ' ' || split_part(me.full_name, ' ', 1) || ' joined a little late — make room for them!'
  where id = target;

  select n.cluster_id into target_cluster
  from public.matches m join public.nodes n on n.id = m.member_ids[1]
  where m.id = target;
  update public.nodes set cluster_id = target_cluster where id = p_id;
  return target;
end $$;

revoke execute on function public.attach_latecomer(uuid) from public, anon, authenticated;
grant execute on function public.attach_latecomer(uuid) to service_role;
