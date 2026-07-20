import { supabase } from "./supabase";

const QUESTION_MEDIA_BUCKET = "question-media";

const sanitizeFileName = (name) => (name || "media").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);

// Uploads to Storage and returns a public URL, instead of the old
// FileReader.readAsDataURL() base64 approach -- base64 images embedded in
// question JSON used to ride every live_state realtime broadcast in full,
// which is what caused hosting to glitch as images grew or players joined.
export const uploadQuestionMedia = async (file) => {
  if (!file) throw new Error("No file selected");
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (sessionError || !userId) throw new Error("You must be signed in to upload media");

  const path = `${userId}/${crypto.randomUUID()}-${sanitizeFileName(file.name)}`;
  const { error: uploadError } = await supabase.storage
    .from(QUESTION_MEDIA_BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || undefined });
  if (uploadError) throw uploadError;

  const { data: publicUrlData } = supabase.storage.from(QUESTION_MEDIA_BUCKET).getPublicUrl(path);
  if (!publicUrlData?.publicUrl) throw new Error("Upload succeeded but no public URL was returned");
  return publicUrlData.publicUrl;
};
