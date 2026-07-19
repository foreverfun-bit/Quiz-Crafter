-- live_game_players had no DELETE policy at all, so a host removing a team
-- (HostSession's removeTeam) would silently delete zero rows under RLS --
-- the row would reappear on the next roster fetch/subscription refresh.

create policy live_game_players_delete_host on public.live_game_players
  for delete using (
    exists (select 1 from public.live_games g where g.id = live_game_players.game_id and g.host_user_id = auth.uid())
  );
