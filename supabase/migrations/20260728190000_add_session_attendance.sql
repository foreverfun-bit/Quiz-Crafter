-- Lets a host log how many people were actually in the bar vs. how many
-- were playing trivia, plus a headcount per team, all from Host Hub (not
-- the live host screen). Kept as its own column, separate from
-- hosted_results, so it can never collide with what HostSession.jsx
-- writes during/after a live show.
alter table public.sessions add column attendance jsonb;
