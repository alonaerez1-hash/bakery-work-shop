-- הריצי פעם אחת ב-Supabase SQL Editor
create table if not exists public.bakery_os_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.bakery_os_data enable row level security;
grant select, insert, update, delete on public.bakery_os_data to authenticated;
create policy "bakery_os_select_own" on public.bakery_os_data for select to authenticated using ((select auth.uid()) = user_id);
create policy "bakery_os_insert_own" on public.bakery_os_data for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "bakery_os_update_own" on public.bakery_os_data for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "bakery_os_delete_own" on public.bakery_os_data for delete to authenticated using ((select auth.uid()) = user_id);
