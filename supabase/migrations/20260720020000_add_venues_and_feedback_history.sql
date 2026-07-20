-- Foundation for a venue-aware trivia assistant.
--
-- Two gaps this closes:
-- 1. "Venue" has never been a real, linkable entity. sessions.venue is a
--    free-text column, and BuildSession's save flow actually tried to write
--    venue_id/venue_name columns that never existed here -- that insert
--    always failed and silently fell back to a payload with no venue info
--    at all (confirmed: only 2 of 33 existing sessions have venue set).
--    This adds a real venues table and sessions.venue_id FK so "sessions at
--    this venue" is a real, queryable relationship.
-- 2. Live audience feedback (thumbs up/down on questions and categories,
--    player-submitted ideas) was captured during a game but only ever
--    written into a per-session user_metadata blob -- nothing reads it back
--    once the session ends. These tables give it a durable, queryable home
--    so it can inform future generation at the same venue.

create table if not exists public.venues (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists venues_user_id_idx on public.venues(user_id);

alter table public.venues enable row level security;
create policy "Users can view own venues" on public.venues for select using (auth.uid() = user_id);
create policy "Users can insert own venues" on public.venues for insert with check (auth.uid() = user_id);
create policy "Users can update own venues" on public.venues for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete own venues" on public.venues for delete using (auth.uid() = user_id);

alter table public.sessions add column if not exists venue_id text references public.venues(id) on delete set null;
create index if not exists sessions_venue_id_idx on public.sessions(venue_id);

create table if not exists public.session_question_feedback (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  player_id text,
  player_name text,
  sentiment text not null check (sentiment in ('like', 'dislike')),
  question_index int,
  question_id text,
  question_text text,
  category text,
  round_name text,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (session_id, player_id, question_index)
);
create index if not exists session_question_feedback_session_idx on public.session_question_feedback(session_id);

create table if not exists public.session_category_feedback (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  player_id text,
  player_name text,
  sentiment text not null check (sentiment in ('like', 'dislike')),
  category text,
  round_key text,
  round_name text,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (session_id, player_id, round_key, category)
);
create index if not exists session_category_feedback_session_idx on public.session_category_feedback(session_id);

create table if not exists public.session_player_ideas (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  player_id text,
  player_name text,
  category text,
  question text,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists session_player_ideas_session_idx on public.session_player_ideas(session_id);

alter table public.session_question_feedback enable row level security;
alter table public.session_category_feedback enable row level security;
alter table public.session_player_ideas enable row level security;

-- Written by the host's own authenticated browser session as it receives
-- realtime feedback broadcasts from players -- not written by players
-- directly -- so these can stay owner-scoped like every other host table.
create policy "Hosts can insert their own question feedback" on public.session_question_feedback for insert with check (exists (select 1 from public.sessions s where s.id = session_id and s.user_id = auth.uid()));
create policy "Hosts can update their own question feedback" on public.session_question_feedback for update using (exists (select 1 from public.sessions s where s.id = session_id and s.user_id = auth.uid())) with check (exists (select 1 from public.sessions s where s.id = session_id and s.user_id = auth.uid()));
create policy "Hosts can view their own question feedback" on public.session_question_feedback for select using (exists (select 1 from public.sessions s where s.id = session_id and s.user_id = auth.uid()));

create policy "Hosts can insert their own category feedback" on public.session_category_feedback for insert with check (exists (select 1 from public.sessions s where s.id = session_id and s.user_id = auth.uid()));
create policy "Hosts can update their own category feedback" on public.session_category_feedback for update using (exists (select 1 from public.sessions s where s.id = session_id and s.user_id = auth.uid())) with check (exists (select 1 from public.sessions s where s.id = session_id and s.user_id = auth.uid()));
create policy "Hosts can view their own category feedback" on public.session_category_feedback for select using (exists (select 1 from public.sessions s where s.id = session_id and s.user_id = auth.uid()));

create policy "Hosts can insert their own player ideas" on public.session_player_ideas for insert with check (exists (select 1 from public.sessions s where s.id = session_id and s.user_id = auth.uid()));
create policy "Hosts can view their own player ideas" on public.session_player_ideas for select using (exists (select 1 from public.sessions s where s.id = session_id and s.user_id = auth.uid()));
