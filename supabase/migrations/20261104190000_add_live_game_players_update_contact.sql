-- The player's email opt-in (Team Name screen's "Would you like updates
-- from the host?") used to travel only as a realtime broadcast payload
-- (player_join), never written to a table -- so it only reached the host
-- if the Host screen happened to be open and connected at that exact
-- moment. Storing it on the roster row itself means it survives
-- regardless of whether anyone was watching live, and makes it available
-- for cross-session team lookups (the Teams tab).
alter table public.live_game_players
  add column if not exists update_contact text,
  add column if not exists update_preference text;
