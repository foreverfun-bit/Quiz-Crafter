-- Live games: persisted (DB-backed) replacement for the old broadcast-only
-- live hosting flow. Previously HostSession/PlayerSession/PresentSession
-- only synced over an ephemeral Supabase Realtime broadcast channel, so a
-- host reload or a player joining late lost all state. These tables give
-- live games a durable home while keeping realtime updates.
--
-- Question content is split across two tables on purpose:
--   - live_game_questions holds only public-safe fields. It's part of the
--     supabase_realtime publication, so players can subscribe directly to it.
--   - live_game_answer_keys holds the correct answer / fun fact and is
--     NEVER added to the supabase_realtime publication, so the answer can't
--     be read off the wire by a player inspecting realtime traffic before
--     the host reveals it. revealed_answer/revealed_fun_fact on
--     live_game_questions stay null until the host copies them over on reveal.
--
-- game_history intentionally has no FK to live_games (game_id is unique but
-- unconstrained) so a finished game's scoreboard survives even if the live
-- game row is later cleaned up.
--
-- NOTE: this migration documents schema that was already created directly
-- against the live "Quiz Crafter" Supabase project (id: lhiisilyynyntopnfput)
-- in an earlier session. It has NOT been re-run here since the objects
-- already exist. It's committed so the schema is tracked in git and
-- reproducible elsewhere; if you use `supabase db push` against that
-- project, mark this migration as already applied (e.g.
-- `supabase migration repair --status applied 20260719143146`) instead of
-- letting it execute.

create table public.live_games (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  host_user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid,
  session_name text not null default 'Trivia Night',
  status text not null default 'lobby' check (
    status = any (array['lobby', 'round_intro', 'wagering', 'question', 'answer_reveal', 'scores', 'finished'])
  ),
  current_index integer not null default -1,
  round_info jsonb,
  default_points integer not null default 10,
  timer_duration integer not null default 0,
  timer_end_at timestamptz,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint live_games_code_key unique (code)
);
comment on table public.live_games is 'One row per live game. Question content lives in live_game_questions -- see file header for why.';
create index live_games_code_idx on public.live_games using btree (code);
create index live_games_host_idx on public.live_games using btree (host_user_id);

create table public.live_game_questions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.live_games(id) on delete cascade,
  idx integer not null,
  question text not null,
  question_type text not null check (
    question_type = any (array['true_false', 'multiple_choice', 'written', 'picture'])
  ),
  type_label text not null,
  category text not null default '',
  options jsonb,
  image_url text,
  points integer not null default 10,
  revealed_answer text,
  revealed_fun_fact text,
  constraint live_game_questions_game_id_idx_key unique (game_id, idx)
);
comment on table public.live_game_questions is 'Public-safe question content. revealed_answer/revealed_fun_fact stay null until the host reveals.';
create index live_game_questions_game_idx on public.live_game_questions using btree (game_id, idx);

create table public.live_game_answer_keys (
  game_id uuid not null references public.live_games(id) on delete cascade,
  idx integer not null,
  answer text not null,
  fun_fact text,
  primary key (game_id, idx)
);
comment on table public.live_game_answer_keys is 'Host-only secret. Never added to the supabase_realtime publication -- see file header.';

create table public.live_game_players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.live_games(id) on delete cascade,
  name text not null,
  score integer not null default 0,
  is_presentation boolean not null default false,
  connected boolean not null default true,
  joined_at timestamptz not null default now()
);
create index live_game_players_game_idx on public.live_game_players using btree (game_id);
create unique index live_game_players_game_lower_name_idx on public.live_game_players using btree (game_id, lower(name));

create table public.live_game_answers (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.live_games(id) on delete cascade,
  question_index integer not null,
  player_id uuid not null references public.live_game_players(id) on delete cascade,
  answer text not null,
  is_correct boolean not null,
  score_awarded integer not null default 0,
  answered_at timestamptz not null default now(),
  constraint live_game_answers_game_id_question_index_player_id_key unique (game_id, question_index, player_id)
);
create index live_game_answers_game_idx on public.live_game_answers using btree (game_id, question_index);

create table public.live_game_wagers (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.live_games(id) on delete cascade,
  question_index integer not null,
  player_id uuid not null references public.live_game_players(id) on delete cascade,
  amount integer not null default 0,
  answered_at timestamptz not null default now(),
  constraint live_game_wagers_game_id_question_index_player_id_key unique (game_id, question_index, player_id)
);
create index live_game_wagers_game_idx on public.live_game_wagers using btree (game_id, question_index);

create table public.game_history (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null,
  code text,
  session_id uuid,
  session_name text,
  host_user_id uuid not null references auth.users(id) on delete cascade,
  scoreboard jsonb not null default '[]'::jsonb,
  total_questions integer not null default 0,
  question_results jsonb not null default '[]'::jsonb,
  player_count integer not null default 0,
  created_at timestamptz,
  ended_at timestamptz not null default now(),
  constraint game_history_game_id_key unique (game_id)
);
create index game_history_host_idx on public.game_history using btree (host_user_id, ended_at desc);

-- Row Level Security

alter table public.live_games enable row level security;
alter table public.live_game_questions enable row level security;
alter table public.live_game_answer_keys enable row level security;
alter table public.live_game_players enable row level security;
alter table public.live_game_answers enable row level security;
alter table public.live_game_wagers enable row level security;
alter table public.game_history enable row level security;

create policy live_games_select_anyone on public.live_games
  for select using (true);
create policy live_games_insert_host on public.live_games
  for insert with check (auth.uid() = host_user_id);
create policy live_games_update_host on public.live_games
  for update using (auth.uid() = host_user_id) with check (auth.uid() = host_user_id);
create policy live_games_delete_host on public.live_games
  for delete using (auth.uid() = host_user_id);

create policy live_game_questions_select_anyone on public.live_game_questions
  for select using (true);
create policy live_game_questions_insert_host on public.live_game_questions
  for insert with check (
    exists (select 1 from public.live_games g where g.id = live_game_questions.game_id and g.host_user_id = auth.uid())
  );
create policy live_game_questions_update_host on public.live_game_questions
  for update using (
    exists (select 1 from public.live_games g where g.id = live_game_questions.game_id and g.host_user_id = auth.uid())
  ) with check (
    exists (select 1 from public.live_games g where g.id = live_game_questions.game_id and g.host_user_id = auth.uid())
  );

create policy live_game_answer_keys_select_host on public.live_game_answer_keys
  for select using (
    exists (select 1 from public.live_games g where g.id = live_game_answer_keys.game_id and g.host_user_id = auth.uid())
  );
create policy live_game_answer_keys_insert_host on public.live_game_answer_keys
  for insert with check (
    exists (select 1 from public.live_games g where g.id = live_game_answer_keys.game_id and g.host_user_id = auth.uid())
  );

create policy live_game_players_select_anyone on public.live_game_players
  for select using (true);
create policy live_game_players_insert_active_game on public.live_game_players
  for insert with check (
    exists (select 1 from public.live_games g where g.id = live_game_players.game_id and g.status <> 'finished')
  );
create policy live_game_players_update_active_game on public.live_game_players
  for update using (
    exists (select 1 from public.live_games g where g.id = live_game_players.game_id and g.status <> 'finished')
  ) with check (
    exists (select 1 from public.live_games g where g.id = live_game_players.game_id and g.status <> 'finished')
  );

create policy live_game_answers_select_anyone on public.live_game_answers
  for select using (true);
create policy live_game_answers_insert_active_game on public.live_game_answers
  for insert with check (
    exists (select 1 from public.live_games g where g.id = live_game_answers.game_id and g.status <> 'finished')
  );
create policy live_game_answers_update_host on public.live_game_answers
  for update using (
    exists (select 1 from public.live_games g where g.id = live_game_answers.game_id and g.host_user_id = auth.uid())
  ) with check (
    exists (select 1 from public.live_games g where g.id = live_game_answers.game_id and g.host_user_id = auth.uid())
  );

create policy live_game_wagers_select_anyone on public.live_game_wagers
  for select using (true);
create policy live_game_wagers_insert_active_game on public.live_game_wagers
  for insert with check (
    exists (select 1 from public.live_games g where g.id = live_game_wagers.game_id and g.status <> 'finished')
  );

create policy game_history_select_host on public.game_history
  for select using (auth.uid() = host_user_id);
create policy game_history_insert_host on public.game_history
  for insert with check (auth.uid() = host_user_id);

-- Realtime: only public-safe, in-flight tables are published. Answer keys
-- and finished-game history are deliberately excluded.
alter publication supabase_realtime add table public.live_games;
alter publication supabase_realtime add table public.live_game_questions;
alter publication supabase_realtime add table public.live_game_players;
alter publication supabase_realtime add table public.live_game_answers;
alter publication supabase_realtime add table public.live_game_wagers;
