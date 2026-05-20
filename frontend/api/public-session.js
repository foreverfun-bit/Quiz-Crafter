import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;

const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!supabase) return res.status(500).json({ error: "Supabase is not configured" });

  const { id } = req.query || {};
  if (!id) return res.status(400).json({ error: "Missing session id" });

  try {
    const { data, error } = await supabase
      .from("sessions")
      .select("id,name,session_name,true_false_questions,multiple_choice_questions,written_questions,picture_questions")
      .eq("id", id)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Session not found" });

    return res.status(200).json({ session: data });
  } catch (error) {
    console.error("Public session load error:", error);
    return res.status(500).json({ error: error.message || "Failed to load session" });
  }
}
