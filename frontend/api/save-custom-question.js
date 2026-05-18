const { createClient } = require("@supabase/supabase-js");

const QUESTION_TYPES = new Set(["true_false", "multiple_choice", "written"]);

function clean(value) {
  return String(value || "").trim();
}

function uniqueTrimmed(values, correctAnswer = "") {
  const correctKey = clean(correctAnswer).toLowerCase();
  const seen = new Set();

  return (Array.isArray(values) ? values : [])
    .map(clean)
    .filter((value) => {
      const key = value.toLowerCase();
      if (!value || key === correctKey || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function buildIncorrectAnswers(body) {
  const type = clean(body.question_type);
  const correctAnswer = clean(body.correct_answer);

  if (type === "true_false") {
    return correctAnswer.toLowerCase() === "false" ? "True" : "False";
  }

  if (type === "multiple_choice") {
    const wrongAnswers = uniqueTrimmed(body.incorrect_answers, correctAnswer);
    if (wrongAnswers.length < 2) {
      throw new Error("Add at least two wrong answers for multiple choice");
    }
    return wrongAnswers.join("; ");
  }

  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL || "";
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

    if (!supabaseUrl) throw new Error("Missing Supabase URL");
    if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

    const body = req.body || {};
    const userId = clean(body.user_id);
    const questionText = clean(body.question_text);
    const category = clean(body.category);
    const correctAnswer = clean(body.correct_answer);
    const questionType = clean(body.question_type) || "written";

    if (!userId) throw new Error("You must be signed in");
    if (!questionText || !category || !correctAnswer) {
      throw new Error("Question, category, and answer are required");
    }
    if (!QUESTION_TYPES.has(questionType)) {
      throw new Error("Choose a valid question type");
    }

    const payload = {
      user_id: userId,
      category,
      question_text: questionText,
      question_type: questionType,
      correct_answer: questionType === "true_false" ? (correctAnswer.toLowerCase() === "false" ? "False" : "True") : correctAnswer,
      incorrect_answers: buildIncorrectAnswers({ ...body, question_type: questionType, correct_answer: correctAnswer }),
      fun_fact: clean(body.fun_fact) || null,
    };

    Object.keys(payload).forEach((key) => {
      if (payload[key] === undefined || payload[key] === "") delete payload[key];
    });

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await supabase.from("questions").insert(payload);

    if (error) throw error;

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("save-custom-question error:", error);
    return res.status(500).json({ error: error.message || "Failed to save question" });
  }
};
