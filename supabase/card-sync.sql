begin;

create table if not exists public.meishi_cards (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  revision uuid not null default gen_random_uuid(),
  record jsonb not null,
  primary key (owner_id, id),
  check (jsonb_typeof(record) = 'object' and not (record ? 'image') and record ? 'id' and record ->> 'id' = id)
);

alter table public.meishi_cards enable row level security;
revoke all on public.meishi_cards from public, anon, authenticated;
grant select, insert on public.meishi_cards to authenticated;
grant update (revision, record) on public.meishi_cards to authenticated;

drop policy if exists meishi_cards_read_own on public.meishi_cards;
create policy meishi_cards_read_own on public.meishi_cards for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists meishi_cards_insert_own on public.meishi_cards;
create policy meishi_cards_insert_own on public.meishi_cards for insert to authenticated
  with check ((select auth.uid()) = owner_id);

drop policy if exists meishi_cards_update_own on public.meishi_cards;
create policy meishi_cards_update_own on public.meishi_cards for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

commit;
