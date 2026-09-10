-- Event Settings > General tab (frontend/src/components/EventSettings/GeneralTab.jsx)
-- needs a time-of-day companion to the existing session_date, plus a
-- description and rules field -- none of these existed on sessions before.
-- Purely additive, no existing data touched.
alter table public.sessions
  add column if not exists event_time text,
  add column if not exists description text,
  add column if not exists rules text;
