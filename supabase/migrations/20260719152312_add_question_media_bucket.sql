-- Question/branding media used to be embedded as base64 data URIs directly
-- inside question JSON, which then rode every live_state realtime broadcast
-- (and the sessions.hosted_results fallback). That's what caused "glitching"
-- during live hosting: a multi-hundred-KB-to-multi-MB image got re-sent to
-- every connected player on every leaderboard/roster update, not just when
-- the question changed. Storing media in Storage and referencing it by URL
-- keeps the broadcast payload small regardless of image size or player count.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'question-media',
  'question-media',
  true,
  10485760, -- 10 MB
  array['image/png', 'image/jpeg', 'image/gif', 'image/webp']
)
on conflict (id) do nothing;

-- Public bucket: anyone can read (question media needs to load for players
-- with no auth session). Writes are restricted to the authenticated host,
-- scoped to a folder named after their own user id.

create policy question_media_select_anyone on storage.objects
  for select using (bucket_id = 'question-media');

create policy question_media_insert_own_folder on storage.objects
  for insert with check (
    bucket_id = 'question-media'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy question_media_update_own on storage.objects
  for update using (bucket_id = 'question-media' and owner = auth.uid())
  with check (bucket_id = 'question-media' and owner = auth.uid());

create policy question_media_delete_own on storage.objects
  for delete using (bucket_id = 'question-media' and owner = auth.uid());
