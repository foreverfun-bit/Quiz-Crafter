-- The live-hosting code (HostSession.jsx / PresentSession.jsx / PlayerSession.jsx)
-- has always read/written sessions.hosted_results (durable snapshot of live game
-- state, used as a fallback when a realtime broadcast is missed) and
-- sessions.hosted_at (set when a host ends a session). Neither column ever
-- existed on this table, so every read/write has been silently failing --
-- confirmed by a continuous stream of "column sessions.hosted_results does not
-- exist" errors in the Postgres logs. This is purely additive and doesn't
-- touch any existing data.
alter table public.sessions
  add column if not exists hosted_results jsonb,
  add column if not exists hosted_at timestamptz;
