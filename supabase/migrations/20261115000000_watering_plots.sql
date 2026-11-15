-- ============================================================
-- Siram Go! — nursery plots (add / hide, never hard-delete)
--
-- RUN THIS YOURSELF in the live Supabase project.
-- The app does not apply it. Until you run it, every page keeps
-- using the built-in list in plots.js.
--
-- How to run:
--   1. Supabase Dashboard → SQL Editor → New query.
--   2. Paste this entire file.
--   3. Run. Safe to run again: the seed does not turn a hidden
--      plot back on, and policies are replaced only for this table.
--   4. Reload the app, sign in as an admin, open Tetapan, add a plot.
--
-- What this does NOT do:
--   - It does not change watering_logs, watering_plot_seedlings,
--     or payroll snapshots.
--   - It does not grant DELETE. Hiding a plot sets active = false.
-- ============================================================

create table if not exists public.watering_plots (
  plot_name  text primary key,
  nursery    text not null,
  active     boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  constraint watering_plots_nursery_chk check (nursery in ('BNN', 'UNN1', 'UNN2'))
);

comment on table public.watering_plots is
  'Siram Go plots. active=false hides a plot from the worker form, the live dashboard, and new payroll entry. Rows are never deleted, so old watering_logs still resolve.';

alter table public.watering_plots enable row level security;

-- Signed-in users can read (workers need the list on the form, including
-- offline after the first successful read). Writes are watering_admins only.
-- _watering_admin() is security definer so the check still works if a later
-- policy tightens SELECT on watering_admins itself.
create or replace function public._watering_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.watering_admins
     where lower(btrim(email)) = lower(btrim(auth.jwt() ->> 'email'))
  );
$function$;

revoke all on function public._watering_admin() from public, anon;
grant execute on function public._watering_admin() to authenticated;

grant select, insert, update on table public.watering_plots to authenticated;
revoke all on table public.watering_plots from anon;
revoke delete on table public.watering_plots from authenticated, anon, public;

drop policy if exists "watering_plots_select" on public.watering_plots;
drop policy if exists "watering_plots_insert" on public.watering_plots;
drop policy if exists "watering_plots_update" on public.watering_plots;

create policy "watering_plots_select"
  on public.watering_plots
  for select
  to authenticated
  using (true);

create policy "watering_plots_insert"
  on public.watering_plots
  for insert
  to authenticated
  with check ((select public._watering_admin()));

create policy "watering_plots_update"
  on public.watering_plots
  for update
  to authenticated
  using ((select public._watering_admin()))
  with check ((select public._watering_admin()));

-- No DELETE policy on purpose.

-- Seed = today's built-in list. ON CONFLICT DO NOTHING so a second run
-- does not reactivate a plot an admin has already hidden.
insert into public.watering_plots (plot_name, nursery, active, sort_order) values
  ('B1',  'BNN',  true, 1),
  ('B2',  'BNN',  true, 2),
  ('B3',  'BNN',  true, 3),
  ('B4',  'BNN',  true, 4),
  ('B5',  'BNN',  true, 5),
  ('B6',  'BNN',  true, 6),
  ('B7',  'BNN',  true, 7),
  ('B8',  'BNN',  true, 8),
  ('B9',  'BNN',  true, 9),
  ('B10', 'BNN',  true, 10),
  ('B11', 'BNN',  true, 11),
  ('B12', 'BNN',  true, 12),
  ('B13', 'BNN',  true, 13),
  ('B14', 'BNN',  true, 14),
  ('U1',  'UNN1', true, 1),
  ('U2',  'UNN1', true, 2),
  ('U3',  'UNN1', true, 3),
  ('U4',  'UNN1', true, 4),
  ('U5',  'UNN1', true, 5),
  ('U6',  'UNN1', true, 6),
  ('U7',  'UNN1', true, 7),
  ('U8',  'UNN1', true, 8),
  ('U9',  'UNN1', true, 9),
  ('U10', 'UNN1', true, 10),
  ('U11', 'UNN1', true, 11),
  ('U12', 'UNN1', true, 12),
  ('U13', 'UNN1', true, 13),
  ('U14', 'UNN1', true, 14),
  ('U15', 'UNN1', true, 15),
  ('U16', 'UNN1', true, 16),
  ('U17', 'UNN1', true, 17),
  ('U18', 'UNN1', true, 18),
  ('N1',  'UNN2', true, 1),
  ('N2',  'UNN2', true, 2),
  ('N3',  'UNN2', true, 3),
  ('N4',  'UNN2', true, 4),
  ('N5',  'UNN2', true, 5),
  ('N6',  'UNN2', true, 6),
  ('N7',  'UNN2', true, 7),
  ('N8',  'UNN2', true, 8),
  ('N9',  'UNN2', true, 9),
  ('N10', 'UNN2', true, 10),
  ('N11', 'UNN2', true, 11),
  ('N12', 'UNN2', true, 12),
  ('N13', 'UNN2', true, 13),
  ('N14', 'UNN2', true, 14),
  ('N15', 'UNN2', true, 15),
  ('N16', 'UNN2', true, 16),
  ('N17', 'UNN2', true, 17),
  ('N18', 'UNN2', true, 18),
  ('N19', 'UNN2', true, 19),
  ('N20', 'UNN2', true, 20)
on conflict (plot_name) do nothing;
