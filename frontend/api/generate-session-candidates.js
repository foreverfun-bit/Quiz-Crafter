export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  return res.status(200).json({
    candidates: [
      {
        question_text: "Venus is the hottest planet in our solar system.",
        question_type: "true_false",
        has_image: false,
        image_url: "",
        category: "Science",
        correct_answer: "True",
        incorrect_answers: [],
        fun_fact: "Venus is hotter than Mercury because of its dense atmosphere.",
        difficulty: "medium",
      },
      {
        question_text: "The Great Wall of China is visible from the Moon with the naked eye.",
        question_type: "true_false",
        has_image: false,
        image_url: "",
        category: "History",
        correct_answer: "False",
        incorrect_answers: [],
        fun_fact: "That claim is a myth; the wall is not easily visible from space.",
        difficulty: "medium",
      },
      {
        question_text: "Shakespeare coined the word 'assassination' in his plays.",
        question_type: "true_false",
        has_image: false,
        image_url: "",
        category: "Literature",
        correct_answer: "True",
        incorrect_answers: [],
        fun_fact: "Shakespeare helped popularize many words and phrases still used today.",
        difficulty: "medium",
      },
      {
        question_text: "The sport of golf originated in Scotland.",
        question_type: "true_false",
        has_image: false,
        image_url: "",
        category: "Sports",
        correct_answer: "True",
        incorrect_answers: [],
        fun_fact: "Modern golf traces its roots to 15th-century Scotland.",
        difficulty: "medium",
      },
      {
        question_text: "Bananas grow on trees.",
        question_type: "true_false",
        has_image: false,
        image_url: "",
        category: "Food",
        correct_answer: "False",
        incorrect_answers: [],
        fun_fact: "Bananas grow on giant herb plants, not true trees.",
        difficulty: "medium",
      },
    ],
  });
}
