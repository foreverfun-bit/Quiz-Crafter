import { supabase } from "./supabase";

const QUESTION_MEDIA_BUCKET = "question-media";
const MAX_UPLOAD_ATTEMPTS = 3;
const RETRY_DELAY_MS = [500, 1500];

// Must match the question-media bucket's allowed_mime_types exactly, or Storage
// rejects the upload with an HTTP 400 -- which is what happens when a dragged
// image doesn't carry a MIME type the browser reports cleanly (e.g. dragging an
// <img> that's already rendered on the page, rather than picking a file from disk).
const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/heic", "image/heif", "image/bmp", "image/tiff", "image/svg+xml"]);
const EXTENSION_BY_MIME = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "image/bmp": "bmp", "image/tiff": "tiff", "image/svg+xml": "svg" };

const sanitizeFileName = (name) => (name || "media").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const resolveUploadType = (file) => {
  const type = (file.type || "").toLowerCase();
  return ALLOWED_MIME_TYPES.has(type) ? type : "image/jpeg";
};

const verifyUrlIsReachable = async (url) => {
  try {
    const response = await fetch(url, { method: "HEAD", cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
};

const uploadOnce = async (file, userId) => {
  const contentType = resolveUploadType(file);
  const extension = EXTENSION_BY_MIME[contentType] || "jpg";
  const baseName = sanitizeFileName(file.name).replace(/\.[a-zA-Z0-9]+$/, "") || "media";
  const path = `${userId}/${crypto.randomUUID()}-${baseName}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from(QUESTION_MEDIA_BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false, contentType });
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
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (sessionError || !userId) throw new Error("You must be signed in to upload media");

  let lastError = null;
  for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt += 1) {
    try {
      const url = await uploadOnce(file, userId);
      if (await verifyUrlIsReachable(url)) return url;
      lastError = new Error("Upload finished but the image isn't reachable yet -- retrying");
    } catch (error) {
      lastError = error;
    }
    if (attempt < MAX_UPLOAD_ATTEMPTS) await sleep(RETRY_DELAY_MS[attempt - 1] || 1500);
  }
  throw lastError || new Error("Failed to upload image");
};
