-- The bucket's allowed_mime_types only covered png/jpeg/gif/webp, but the
-- app's own client-side check just verifies "is this an image file"
-- (file.type.startsWith("image/")) with no matching restriction. A host
-- uploading a photo straight from an iPhone (HEIC by default) passed the
-- client check and then got rejected by Storage with a bare "HTTP 400
-- error" -- no useful message, and nothing logged server-side to diagnose
-- from. Widens the allowlist to match what hosts actually upload.

update storage.buckets
set allowed_mime_types = array[
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/bmp',
  'image/tiff',
  'image/svg+xml'
]
where id = 'question-media';
