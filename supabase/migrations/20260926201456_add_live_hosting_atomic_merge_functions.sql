-- Fixes two related live-hosting reliability bugs reported as "answers and
-- scores don't register, and the presentation screen flickers/desyncs --
-- worse with more teams":
--
-- 1) PlayerSession.jsx never authenticates a player (no supabase.auth
--    session -- players just pick a name and join), so a real player's
--    browser calls Supabase as the anonymous role. sessions' RLS UPDATE
--    policy requires auth.uid() = user_id (the host's own account), which
--    an anonymous player can never satisfy. That means
--    saveDurablePlayerEvent's "durable fallback" write
--    (supabase.from("sessions").update({ hosted_results: ... })) has been
--    silently failing RLS for every real player, every time -- caught by
--    its own try/catch and only console.warn'd. Answer/join/feedback
--    delivery to the host has therefore relied entirely on best-effort
--    Realtime broadcast with no working fallback: any transient drop on
--    any one device's connection at the moment of submission permanently
--    loses that event, with more concurrent devices (more teams) meaning
--    more chances of that happening during a session.
-- 2) Even for a write that *does* pass RLS (the host's own browser),
--    HostSession.jsx's persistLiveState and PlayerSession.jsx's
--    saveDurablePlayerEvent both read the whole hosted_results column,
--    change one part client-side, and write the whole column back. Two
--    of these racing (a player's answer landing between the host's last
--    local sync and its next write) clobber each other -- whichever
--    write lands last silently discards the other's change, including
--    reverting hosted_results.liveState back to a stale copy, which is
--    what actually produces the presentation-screen flicker/revert.
--
-- Both functions below make their write atomic (a single per-row UPDATE,
-- which Postgres serializes against concurrent callers) and scoped to only
-- the one JSON key they own, so many players and the host can never stomp
-- on each other's part of the blob regardless of how stale any one
-- client's local cache is. append_live_event is SECURITY DEFINER so an
-- unauthenticated player can call it without needing row-level UPDATE
-- rights on all of `sessions` -- it only ever touches hosted_results.liveEvents,
-- nothing else on the row.

create or replace function public.append_live_event(p_session_id uuid, p_event jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.sessions
  set hosted_results = coalesce(hosted_results, '{}'::jsonb) || jsonb_build_object(
    'liveEvents', (
      select coalesce(jsonb_agg(elem), '[]'::jsonb)
      from (
        select elem
        from jsonb_array_elements(coalesce(hosted_results -> 'liveEvents', '[]'::jsonb) || jsonb_build_array(p_event)) elem
        offset greatest(
          0,
          jsonb_array_length(coalesce(hosted_results -> 'liveEvents', '[]'::jsonb) || jsonb_build_array(p_event)) - 1000
        )
      ) capped
    ),
    'liveEventsUpdatedAt', to_jsonb(now()::text)
  )
  where id = p_session_id;
end;
$$;

grant execute on function public.append_live_event(uuid, jsonb) to anon, authenticated;

-- Host-only (runs with the caller's own privileges -- RLS still applies
-- exactly as if the host ran this UPDATE directly), but just as atomic:
-- only ever touches liveState/liveStateUpdatedAt, so a host action can
-- never wipe out a player event that landed in hosted_results.liveEvents
-- moments earlier.
create or replace function public.merge_host_live_state(p_session_id uuid, p_live_state jsonb)
returns void
language sql
set search_path = public
as $$
  update public.sessions
  set hosted_results = coalesce(hosted_results, '{}'::jsonb) || jsonb_build_object(
    'liveState', p_live_state,
    'liveStateUpdatedAt', coalesce(p_live_state ->> 'updatedAt', now()::text)
  )
  where id = p_session_id;
$$;

grant execute on function public.merge_host_live_state(uuid, jsonb) to authenticated;
