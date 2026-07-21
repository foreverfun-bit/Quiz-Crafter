-- BuildSession's save handler has always tried to write round_descriptions,
-- but this column never existed. Every save attempt including it failed and
-- fell through to a reduced-payload retry that also drops venue_id,
-- session_date, event_date, and venue -- silently, on every single save.
-- That's why virtually every past session has venue_id/session_date as NULL
-- even when a venue and date were selected in the builder. Adding the column
-- so the full payload succeeds on the first try going forward.

alter table public.sessions add column if not exists round_descriptions jsonb;
