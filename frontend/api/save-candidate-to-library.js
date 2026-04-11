import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const {
      sessionUserId,
      category,
      question_text,
      question_type,
      has_image,
      image_url,
      correct_answer,
      incorrect_answers,
      fun_fact,
      difficulty,
    } = req.body;

    if (!sessionUserId || !question_text || !question_type || !correct_answer) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const supabase = createClient(
      process.env.REACT_APP_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const payload = {
      user_id: sessionUserId,
      category: category || null,
      question_text,
      question_type,
      has_image: !!has_image,
      image_url: image_url || null,
      theme: null,
      correct_answer,
      incorrect_answers:
        Array.isArray(incorrect_answers) && incorrect_answers.length > 0
          ? incorrect_answers.join(";")
          : null,
      fun_fact: fun_fact || null,
      difficulty: difficulty || "medium",
    };

    const { data, error } = await supabase
      .from("questions")
      .insert(payload)
      .select()
      .single();

    if (error) {
      console.error("Supabase insert error:", error);
      return res.status(500).json({ error: error.message || "Failed to save question" });
    }

    return res.status(200).json({ question: data });
  } catch (error) {
    console.error("save-candidate-to-library error:", error);
    return res.status(500).json({
      error: error?.message || "Failed to save candidate",
    });
  }
}
