import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.REACT_APP_SUPABASE_ANON_KEY
);

export default function Library() {
  const [questions, setQuestions] = useState([]);

  useEffect(() => {
    fetchQuestions();
  }, []);

  async function fetchQuestions() {
    const { data, error } = await supabase
      .from("questions")
      .select("*")
      .order("id", { ascending: false });

    if (!error) {
      setQuestions(data);
    } else {
      console.error(error);
    }
  }

  return (
    <div style={{ padding: "20px" }}>
      <h2>Question Library</h2>

      {questions.map((q) => (
        <div
          key={q.id}
          style={{
            border: "1px solid #333",
            padding: "10px",
            marginBottom: "10px",
            borderRadius: "8px",
          }}
        >
          <strong>{q.question_text}</strong>
          <div>Category: {q.category}</div>
          <div>Answer: {q.correct_answer}</div>
          {q.incorrect_answers && (
            <div>Options: {q.incorrect_answers}</div>
          )}
        </div>
      ))}
    </div>
  );
}
