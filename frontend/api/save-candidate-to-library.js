import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

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

    // 🔥 Validate input
    if (!sessionUserId || !question_text || !correct_answer) {
      return res.status(400).json({
        error: "Missing required fields",
      });
    }

    const { data, error } = await supabase
      .from("questions")
      .insert([
        {
          user_id: sessionUserId,
          category,
          question_text,
          question_type,
          has_image,
          image_url,
          correct_answer,
          incorrect_answers:
            Array.isArray(incorrect_answers)
              ? incorrect_answers.join(";")
              : incorrect_answers,
          fun_fact,
          difficulty,
        },
      ])
      .select()
      .single();

    if (error) {
      console.error("Supabase insert error:", error);
      return res.status(500).json({ error: error.message });
    }

    // ✅ ALWAYS return valid JSON
    return res.status(200).json({
      question: data,
    });
  } catch (err) {
    console.error("API error:", err);

    return res.status(500).json({
      error: err.message || "Server error",
    });
  }
}
