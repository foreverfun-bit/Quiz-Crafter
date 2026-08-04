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

// Cloud-synced folders (OneDrive, Google Drive Files On-Demand, etc.) can
// report accurate cached metadata -- a real, non-zero file.size -- for a
// file that's still a cloud-only placeholder never actually downloaded.
// The size check alone doesn't catch that; only actually reading the bytes
// does. Reading also nudges Windows/OneDrive to hydrate the file, and gives
// Storage a fully materialized Blob instead of a lazy File handle that
// could read short mid-upload.
const readFileBytes = async (file) => {
  let buffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    throw new Error("Could not read this image -- if it's from a cloud-synced folder (OneDrive, Google Drive, etc.), make sure it's fully downloaded (not just showing as available) before trying again");
  }
  if (!buffer.byteLength) throw new Error("That image looks empty once read -- if it's from a cloud-synced folder (OneDrive, Google Drive, etc.), make sure it's fully downloaded before trying again");
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

const uploadOnce = async (blob, fileName, userId) => {
  const contentType = resolveUploadType(blob);
  const extension = EXTENSION_BY_MIME[contentType] || "jpg";
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
  const bytes = await readFileBytes(file);
  const blob = new Blob([bytes], { type: file.type || "" });
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (sessionError || !userId) throw new Error("You must be signed in to upload media");

  let lastError = null;
  for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt += 1) {
    try {
      const url = await uploadOnce(blob, file.name, userId);
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
