-- Adds audio clip support to the existing question-media bucket (audio
-- questions attach a clip the same way picture questions attach an image --
-- an optional media field on any question, not a new sibling type). Bumps
-- the size limit from 10MB to 25MB since a short trivia clip at a
-- reasonable bitrate can run a few MB larger than a compressed photo.

update storage.buckets
set
  file_size_limit = 26214400, -- 25 MB
  allowed_mime_types = array[
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/gif',
    'image/webp',
    'image/heic',
    'image/heif',
    'image/bmp',
    'image/tiff',
    'image/svg+xml',
    'audio/mpeg',
    'audio/mp4',
    'audio/x-m4a',
    'audio/wav',
    'audio/x-wav',
    'audio/ogg',
    'audio/webm',
    'audio/aac'
  ]
where id = 'question-media';
