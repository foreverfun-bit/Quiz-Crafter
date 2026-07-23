-- Lets a host rehearse a session ("Test Run") without touching the live
-- game real players will join for the actual event. ensureLiveGame in
-- frontend/api/live-game.js now looks up/creates live_games rows scoped by
-- (session_id, is_test): a test run always gets its own row/join code, and
-- going live for real deletes any leftover unfinished test row for that
-- session first, cascading away its practice teams/scores/answers so they
-- never carry into the real event.
alter table public.live_games add column is_test boolean not null default false;
create index live_games_session_mode_idx on public.live_games using btree (session_id, is_test, created_at desc);
