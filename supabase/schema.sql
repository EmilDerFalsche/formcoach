-- FormCoach – Datenbank-Schema für Supabase
-- Im Supabase-Dashboard unter "SQL Editor" einfügen und "Run" klicken.
-- Mehrfaches Ausführen ist unschädlich.

-- Ein Eintrag pro Satz
create table if not exists public.workouts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  client_id     text not null,                       -- von der App vergeben (verhindert Doppel-Uploads beim Offline-Sync)
  performed_at  timestamptz not null default now(),
  exercise      text not null default 'squat',
  mode          text check (mode in ('live', 'video')),
  view          text,                                -- front | side | diagonal
  rep_count     int  not null check (rep_count >= 0),
  avg_score     int  check (avg_score between 0 and 100),
  top_issue     text,
  reps          jsonb not null default '[]'::jsonb,  -- pro Wiederholung: Score, Fehler, Kennzahlen
  trace         jsonb not null default '[]'::jsonb,  -- Hüfttiefe über die Zeit (für das Diagramm)
  created_at    timestamptz not null default now(),
  unique (user_id, client_id)
);

create index if not exists workouts_user_time_idx on public.workouts (user_id, performed_at desc);

-- Row Level Security: jeder sieht und ändert nur seine eigenen Sätze
alter table public.workouts enable row level security;

drop policy if exists "workouts_select_own" on public.workouts;
create policy "workouts_select_own" on public.workouts
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "workouts_insert_own" on public.workouts;
create policy "workouts_insert_own" on public.workouts
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "workouts_delete_own" on public.workouts;
create policy "workouts_delete_own" on public.workouts
  for delete to authenticated using (auth.uid() = user_id);

-- Konto selbst löschen (inkl. aller Sätze per ON DELETE CASCADE)
create or replace function public.delete_user()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.users where id = auth.uid();
$$;

revoke execute on function public.delete_user() from public, anon;
grant execute on function public.delete_user() to authenticated;
