import { supabase } from "./supabase";

const QUESTION_MEDIA_BUCKET = "question-media";
const MAX_UPLOAD_ATTEMPTS = 3;
const RETRY_DELAY_MS = [500, 1500];
const FALLBACK_MAX_DIMENSION = 1600;
const FALLBACK_JPEG_QUALITY = 0.82;
// Must match the question-media bucket's file_size_limit, or Storage rejects the
// upload with an HTTP 400 that gives the host no indication the file was too big.
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

// Must match the question-media bucket's allowed_mime_types exactly, or Storage
// rejects the upload with an HTTP 400 -- which is what happens when a dragged
// image doesn't carry a MIME type the browser reports cleanly (e.g. dragging an
// <img> that's already rendered on the page, rather than picking a file from disk).
const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/heic", "image/heif", "image/bmp", "image/tiff", "image/svg+xml"]);
const EXTENSION_BY_MIME = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "image/bmp": "bmp", "image/tiff": "tiff", "image/svg+xml": "svg" };

// Same bucket, same size-limit/allowlist-must-match-Storage caveat as the
// image constants above -- see the widen_question_media_for_audio migration.
const MAX_AUDIO_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const ALLOWED_AUDIO_MIME_TYPES = new Set(["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/wav", "audio/x-wav", "audio/ogg", "audio/webm", "audio/aac"]);
const AUDIO_EXTENSION_BY_MIME = { "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/wav": "wav", "audio/x-wav": "wav", "audio/ogg": "ogg", "audio/webm": "webm", "audio/aac": "aac" };

const sanitizeFileName = (name) => (name || "media").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const resolveUploadType = (file, allowedTypes, fallbackType) => {
  const type = (file.type || "").toLowerCase();
  return allowedTypes.has(type) ? type : fallbackType;
};

const verifyUrlIsReachable = async (url) => {
  try {
    const response = await fetch(url, { method: "HEAD", cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
};

// Cloud-synced folders (OneDrive, Google Drive Files On-Demand, etc.) can
// report accurate cached metadata -- a real, non-zero file.size -- for a
// file that's still a cloud-only placeholder never actually downloaded.
// The size check alone doesn't catch that; only actually reading the bytes
// does. Reading also nudges Windows/OneDrive to hydrate the file, and gives
// Storage a fully materialized Blob instead of a lazy File handle that
// could read short mid-upload.
const readFileBytes = async (file, label = "image") => {
  let buffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    throw new Error(`Could not read this ${label} -- if it's from a cloud-synced folder (OneDrive, Google Drive, etc.), make sure it's fully downloaded (not just showing as available) before trying again`);
  }
  if (!buffer.byteLength) throw new Error(`That ${label} looks empty once read -- if it's from a cloud-synced folder (OneDrive, Google Drive, etc.), make sure it's fully downloaded before trying again`);
  return buffer;
};

// Also used directly (not just as the storage-upload fallback) anywhere a
// compressed data URL is enough on its own, e.g. sending a screenshot to a
// vision model instead of persisting it anywhere.
export const imageBlobToDataUrl = async (blob) => new Promise((resolve, reject) => {
  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  image.onload = () => {
    try {
      const scale = Math.min(1, FALLBACK_MAX_DIMENSION / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height, 1));
      const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
      const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      URL.revokeObjectURL(objectUrl);
      resolve(canvas.toDataURL("image/jpeg", FALLBACK_JPEG_QUALITY));
    } catch (error) {
      URL.revokeObjectURL(objectUrl);
      reject(error);
    }
  };
  image.onerror = () => {
    URL.revokeObjectURL(objectUrl);
    reject(new Error("Could not read this image. Try saving it as a PNG or JPG, then upload again."));
  };
  image.src = objectUrl;
});

const uploadOnce = async (blob, fileName, userId, { allowedTypes, extensionByMime, fallbackType }) => {
  const contentType = resolveUploadType(blob, allowedTypes, fallbackType);
  const extension = extensionByMime[contentType] || extensionByMime[fallbackType];
  const baseName = sanitizeFileName(fileName).replace(/\.[a-zA-Z0-9]+$/, "") || "media";
  const path = `${userId}/${crypto.randomUUID()}-${baseName}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from(QUESTION_MEDIA_BUCKET)
    .upload(path, blob, { cacheControl: "3600", upsert: false, contentType });
  if (uploadError) throw uploadError;

  const { data: publicUrlData } = supabase.storage.from(QUESTION_MEDIA_BUCKET).getPublicUrl(path);
  if (!publicUrlData?.publicUrl) throw new Error("Upload succeeded but no public URL was returned");
  return publicUrlData.publicUrl;
};

// Uploads to Storage and returns a public URL, instead of the old
// FileReader.readAsDataURL() base64 approach -- base64 images embedded in
// question JSON used to ride every live_state realtime broadcast in full,
// which is what caused hosting to glitch as images grew or players joined.
//
// Supabase's storage API has had intermittent outage windows where the
// upload call can appear to succeed (or getPublicUrl can build a URL string,
// which is pure client-side path construction with no network check) for an
// object that never actually finished writing -- leaving a broken image
// baked into a saved question that only shows up broken later, during a live
// show. Retry the whole upload a few times and verify the resulting URL is
// actually fetchable before trusting it.
export const uploadQuestionMedia = async (file) => {
  if (!file) throw new Error("No file selected");
  if (file.size === 0) throw new Error("That image looks empty (0 bytes) -- if it's from a cloud-synced folder (OneDrive, Google Drive, etc.), make sure it's fully downloaded first, then try again");
  if (file.size > MAX_FILE_SIZE_BYTES) throw new Error(`That image is too large (${(file.size / (1024 * 1024)).toFixed(1)}MB) -- images must be 10MB or smaller`);
  const bytes = await readFileBytes(file, "image");
  const blob = new Blob([bytes], { type: file.type || "" });
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (sessionError || !userId) throw new Error("You must be signed in to upload media");

  const uploadOptions = { allowedTypes: ALLOWED_MIME_TYPES, extensionByMime: EXTENSION_BY_MIME, fallbackType: "image/jpeg" };
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt += 1) {
    try {
      const url = await uploadOnce(blob, file.name, userId, uploadOptions);
      if (await verifyUrlIsReachable(url)) return url;
      lastError = new Error("Upload finished but the image isn't reachable yet -- retrying");
    } catch (error) {
      lastError = error;
    }
    if (attempt < MAX_UPLOAD_ATTEMPTS) await sleep(RETRY_DELAY_MS[attempt - 1] || 1500);
  }
  console.warn("Question media storage upload failed; using compressed browser fallback:", lastError);
  return imageBlobToDataUrl(blob);
};

// Same retry/verify approach as uploadQuestionMedia, but with no data-URL
// fallback on failure -- that trick only works for images (cheap canvas
// recompression into a small base64 string). Doing the equivalent for audio
// would mean embedding a multi-MB base64 clip in question JSON, which is
// exactly what the question-media bucket was built to get away from (see
// add_question_media_bucket migration). Surfacing the error and letting the
// host retry is better than silently reintroducing that.
export const uploadQuestionAudio = async (file) => {
  if (!file) throw new Error("No file selected");
  if (file.size === 0) throw new Error("That audio clip looks empty (0 bytes) -- if it's from a cloud-synced folder (OneDrive, Google Drive, etc.), make sure it's fully downloaded first, then try again");
  if (file.size > MAX_AUDIO_FILE_SIZE_BYTES) throw new Error(`That clip is too large (${(file.size / (1024 * 1024)).toFixed(1)}MB) -- audio clips must be 25MB or smaller`);
  const bytes = await readFileBytes(file, "audio clip");
  const blob = new Blob([bytes], { type: file.type || "" });
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (sessionError || !userId) throw new Error("You must be signed in to upload media");

  const uploadOptions = { allowedTypes: ALLOWED_AUDIO_MIME_TYPES, extensionByMime: AUDIO_EXTENSION_BY_MIME, fallbackType: "audio/mpeg" };
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt += 1) {
    try {
      const url = await uploadOnce(blob, file.name, userId, uploadOptions);
      if (await verifyUrlIsReachable(url)) return url;
      lastError = new Error("Upload finished but the clip isn't reachable yet -- retrying");
    } catch (error) {
      lastError = error;
    }
    if (attempt < MAX_UPLOAD_ATTEMPTS) await sleep(RETRY_DELAY_MS[attempt - 1] || 1500);
  }
  throw lastError || new Error("Failed to upload audio clip");
};
