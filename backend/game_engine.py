"""
Live Trivia Game Engine
Manages real-time game sessions with WebSocket connections.
"""

import uuid
import logging
from datetime import datetime, timezone
from typing import Dict, Optional
from fastapi import WebSocket
from rapidfuzz import fuzz

logger = logging.getLogger(__name__)

DEFAULT_POINTS = 10


class GameManager:
    """Manages all active trivia games in memory."""

    def __init__(self):
        self.games: Dict[str, dict] = {}
        self.connections: Dict[str, Dict[str, WebSocket]] = {}

    def _generate_code(self) -> str:
        import random
        while True:
            code = str(random.randint(1000, 9999))
            if not any(g["code"] == code for g in self.games.values()):
                return code

    def create_game(self, host_user_id: str, session_data: dict, questions_map: dict, points_per_question: int = DEFAULT_POINTS, scoring: dict = None, timer_duration: int = 0) -> dict:
        game_id = str(uuid.uuid4())[:8]
        code = self._generate_code()
        scoring = scoring or {}

        ordered_questions = []
        type_order = [
            ("true_false_questions", "true_false", "True / False"),
            ("multiple_choice_questions", "multiple_choice", "Multiple Choice"),
            ("written_questions", "written", "Written Answer"),
            ("picture_questions", "picture", "Picture Round"),
        ]

        for field, q_type, label in type_order:
            q_ids = session_data.get(field, [])
            type_points = scoring.get(q_type, points_per_question)
            for qid in q_ids:
                q = questions_map.get(qid)
                if q:
                    ordered_questions.append({
                        "id": q["id"],
                        "question": q["question"],
                        "answer": q["answer"],
                        "question_type": q_type,
                        "type_label": label,
                        "category": q.get("category", ""),
                        "options": q.get("options"),
                        "fun_fact": q.get("fun_fact"),
                        "image_url": q.get("image_url"),
                        "points": type_points,
                    })

        game = {
            "id": game_id,
            "code": code,
            "host_user_id": host_user_id,
            "session_id": session_data["id"],
            "session_name": session_data.get("name", "Trivia Night"),
            "status": "lobby",
            "questions": ordered_questions,
            "current_index": -1,
            "players": {},
            "answers": {},
            "wagers": {},
            "default_points": points_per_question,
            "timer_duration": timer_duration,  # 0 = no limit
            "timer_end_at": None,  # ISO timestamp when timer expires
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

        self.games[game_id] = game
        self.connections[game_id] = {}
        return game

    def get_game_by_id(self, game_id: str) -> Optional[dict]:
        return self.games.get(game_id)

    def get_game_by_code(self, code: str) -> Optional[dict]:
        for game in self.games.values():
            if game["code"] == code and game["status"] != "finished":
                return game
        return None

    def join_game(self, game_id: str, player_name: str) -> Optional[str]:
        game = self.games.get(game_id)
        if not game or game["status"] == "finished":
            return None

        for pid, p in game["players"].items():
            if p["name"].lower() == player_name.lower():
                p["connected"] = True
                return pid

        player_id = str(uuid.uuid4())[:8]
        game["players"][player_id] = {
            "name": player_name,
            "score": 0,
            "connected": True,
        }
        return player_id

    def set_question_points(self, game_id: str, question_index: int, points: int) -> bool:
        game = self.games.get(game_id)
        if not game or question_index < 0 or question_index >= len(game["questions"]):
            return False
        game["questions"][question_index]["points"] = points
        return True

    def set_timer_duration(self, game_id: str, duration: int) -> bool:
        game = self.games.get(game_id)
        if not game:
            return False
        game["timer_duration"] = max(0, duration)
        return True

    def _start_timer(self, game: dict):
        """Set timer_end_at based on timer_duration. 0 = no timer."""
        dur = game.get("timer_duration", 0)
        if dur > 0:
            from datetime import timedelta
            game["timer_end_at"] = (datetime.now(timezone.utc) + timedelta(seconds=dur)).isoformat()
        else:
            game["timer_end_at"] = None

    def _clear_timer(self, game: dict):
        game["timer_end_at"] = None

    def _get_round_info(self, game: dict, question_type: str) -> dict:
        """Get categories and points for a round type."""
        categories = []
        points = None
        for q in game["questions"]:
            if q["question_type"] == question_type:
                if q["category"] and q["category"] not in categories:
                    categories.append(q["category"])
                if points is None:
                    points = q.get("points", DEFAULT_POINTS)
        type_labels = {
            "true_false": "True / False",
            "multiple_choice": "Multiple Choice",
            "written": "Written Answer",
            "picture": "Picture Round",
        }
        return {
            "round_type": question_type,
            "round_label": type_labels.get(question_type, question_type),
            "categories": categories,
            "points_per_question": points or DEFAULT_POINTS,
            "question_count": len([q for q in game["questions"] if q["question_type"] == question_type]),
        }

    def next_question(self, game_id: str) -> Optional[dict]:
        game = self.games.get(game_id)
        if not game or game["status"] == "finished":
            return None

        game["current_index"] += 1
        idx = game["current_index"]

        if idx >= len(game["questions"]):
            game["status"] = "finished"
            self._clear_timer(game)
            return None

        question = game["questions"][idx]

        # Detect round transition (new question type)
        prev_type = game["questions"][idx - 1]["question_type"] if idx > 0 else None
        new_type = question["question_type"]
        is_new_round = prev_type != new_type

        # Show round intro for non-picture rounds on round transition
        if is_new_round and new_type != "picture":
            game["status"] = "round_intro"
            game["round_info"] = self._get_round_info(game, new_type)
            self._clear_timer(game)
            game["answers"][str(idx)] = {}
            return question

        # Picture questions go to wagering phase first (no timer during wagering)
        if question["question_type"] == "picture":
            game["status"] = "wagering"
            game["wagers"][str(idx)] = {}
            self._clear_timer(game)
        else:
            game["status"] = "question"
            self._start_timer(game)

        game["answers"][str(idx)] = {}
        return question

    def start_round(self, game_id: str) -> bool:
        """Transition from round_intro to the actual question."""
        game = self.games.get(game_id)
        if not game or game["status"] != "round_intro":
            return False
        game["status"] = "question"
        game["round_info"] = None
        self._start_timer(game)
        return True

    def submit_wager(self, game_id: str, player_id: str, amount: int) -> bool:
        game = self.games.get(game_id)
        if not game or game["status"] != "wagering":
            return False

        player = game["players"].get(player_id)
        if not player:
            return False

        idx = str(game["current_index"])
        if idx not in game["wagers"]:
            game["wagers"][idx] = {}

        if player_id in game["wagers"][idx]:
            return False  # Already wagered

        # Cap wager at player's current score (minimum 0)
        capped = max(0, min(amount, player["score"]))
        game["wagers"][idx][player_id] = capped
        return True

    def start_answering(self, game_id: str) -> bool:
        """Transition from wagering to question (answering) phase."""
        game = self.games.get(game_id)
        if not game or game["status"] != "wagering":
            return False
        game["status"] = "question"
        self._start_timer(game)
        return True

    def submit_answer(self, game_id: str, player_id: str, answer: str) -> bool:
        game = self.games.get(game_id)
        if not game or game["status"] != "question":
            return False

        idx = str(game["current_index"])
        if idx not in game["answers"]:
            game["answers"][idx] = {}

        if player_id in game["answers"][idx]:
            return False

        question = game["questions"][game["current_index"]]
        is_correct = self._check_answer(question, answer)

        # Determine score based on question type
        if question["question_type"] == "picture":
            wager = game["wagers"].get(idx, {}).get(player_id, 0)
            score = wager if is_correct else -wager
        else:
            points = question.get("points", DEFAULT_POINTS)
            score = points if is_correct else 0

        game["answers"][idx][player_id] = {
            "answer": answer,
            "is_correct": is_correct,
            "score_awarded": score,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

        game["players"][player_id]["score"] += score
        return True

    def _check_answer(self, question: dict, answer: str) -> bool:
        correct = question["answer"].strip()
        given = answer.strip()
        q_type = question["question_type"]

        if q_type == "true_false":
            return given.lower() == correct.lower()

        elif q_type == "multiple_choice":
            given_clean = given.lower().strip().rstrip(".")
            correct_clean = correct.lower().strip().rstrip(".")
            return (
                given_clean == correct_clean
                or correct_clean in given_clean
                or given_clean in correct_clean
            )

        else:  # written, picture
            ratio = fuzz.ratio(given.lower(), correct.lower())
            return ratio >= 70

    def change_answer(self, game_id: str, player_id: str, question_index: int, new_answer: str) -> bool:
        """Host changes a player's answer and re-scores it."""
        game = self.games.get(game_id)
        if not game:
            return False

        idx_str = str(question_index)
        if idx_str not in game["answers"] or player_id not in game["answers"][idx_str]:
            return False

        old = game["answers"][idx_str][player_id]
        old_score = old["score_awarded"]

        question = game["questions"][question_index]
        is_correct = self._check_answer(question, new_answer)

        if question["question_type"] == "picture":
            wager = game["wagers"].get(idx_str, {}).get(player_id, 0)
            new_score = wager if is_correct else -wager
        else:
            points = question.get("points", DEFAULT_POINTS)
            new_score = points if is_correct else 0

        game["players"][player_id]["score"] -= old_score
        game["players"][player_id]["score"] += new_score

        old["answer"] = new_answer
        old["is_correct"] = is_correct
        old["score_awarded"] = new_score
        return True

    def reveal_answer(self, game_id: str) -> Optional[dict]:
        game = self.games.get(game_id)
        if not game:
            return None

        game["status"] = "answer_reveal"
        self._clear_timer(game)
        idx = game["current_index"]
        question = game["questions"][idx]
        answers = game["answers"].get(str(idx), {})

        return {
            "question": question,
            "answers": answers,
            "correct_answer": question["answer"],
            "fun_fact": question.get("fun_fact"),
        }

    def show_scores(self, game_id: str) -> Optional[dict]:
        game = self.games.get(game_id)
        if not game:
            return None

        game["status"] = "scores"
        real = self._real_players(game)
        scoreboard = sorted(
            [{"id": pid, "name": p["name"], "score": p["score"]} for pid, p in real.items()],
            key=lambda x: x["score"],
            reverse=True,
        )
        return {"scoreboard": scoreboard}

    def override_score(self, game_id: str, player_id: str, question_index: int, is_correct: bool, score: int) -> bool:
        game = self.games.get(game_id)
        if not game:
            return False

        idx_str = str(question_index)
        if idx_str not in game["answers"] or player_id not in game["answers"][idx_str]:
            return False

        old = game["answers"][idx_str][player_id]
        old_score = old["score_awarded"]

        game["players"][player_id]["score"] -= old_score
        game["players"][player_id]["score"] += score

        old["is_correct"] = is_correct
        old["score_awarded"] = score
        return True

    def end_game(self, game_id: str):
        game = self.games.get(game_id)
        if game:
            game["status"] = "finished"

    def _real_players(self, game: dict) -> dict:
        return {pid: p for pid, p in game["players"].items() if p["name"] != "__presentation__"}

    def get_host_state(self, game_id: str) -> Optional[dict]:
        game = self.games.get(game_id)
        if not game:
            return None

        state = {
            "id": game["id"],
            "code": game["code"],
            "status": game["status"],
            "session_name": game["session_name"],
            "total_questions": len(game["questions"]),
            "current_index": game["current_index"],
            "players": self._real_players(game),
            "default_points": game["default_points"],
            "timer_duration": game.get("timer_duration", 0),
            "timer_end_at": game.get("timer_end_at"),
            "round_info": game.get("round_info"),
        }

        idx = game["current_index"]
        if idx >= 0 and idx < len(game["questions"]):
            q = game["questions"][idx]
            state["current_question"] = q
            state["answers"] = game["answers"].get(str(idx), {})
            state["answers_count"] = len(state["answers"])
            state["players_count"] = len(game["players"])
            state["wagers"] = game["wagers"].get(str(idx), {})
            state["wagers_count"] = len(state["wagers"])

        return state

    def get_player_state(self, game_id: str, player_id: str) -> Optional[dict]:
        game = self.games.get(game_id)
        if not game:
            return None

        player = game["players"].get(player_id)
        if not player:
            return None

        state = {
            "status": game["status"],
            "player_name": player["name"],
            "player_score": player["score"],
            "total_questions": len(game["questions"]),
            "current_index": game["current_index"],
            "players_count": len(game["players"]),
            "timer_end_at": game.get("timer_end_at"),
            "round_info": game.get("round_info"),
        }

        idx = game["current_index"]
        if idx >= 0 and idx < len(game["questions"]):
            q = game["questions"][idx]
            state["current_question"] = {
                "question": q["question"],
                "question_type": q["question_type"],
                "type_label": q["type_label"],
                "category": q["category"],
                "options": q.get("options"),
                "image_url": q.get("image_url"),
            }

            # Wagering state
            if game["status"] == "wagering":
                my_wager = game["wagers"].get(str(idx), {}).get(player_id)
                state["has_wagered"] = my_wager is not None
                if my_wager is not None:
                    state["my_wager"] = my_wager
                state["max_wager"] = max(0, player["score"])

            my_answer = game["answers"].get(str(idx), {}).get(player_id)
            state["has_answered"] = my_answer is not None
            if my_answer:
                state["my_answer"] = my_answer["answer"]

            if game["status"] == "answer_reveal":
                state["correct_answer"] = q["answer"]
                state["fun_fact"] = q.get("fun_fact")
                if my_answer:
                    state["was_correct"] = my_answer["is_correct"]
                    state["score_awarded"] = my_answer["score_awarded"]

        if game["status"] in ("scores", "finished"):
            real = self._real_players(game)
            scoreboard = sorted(
                [{"id": pid, "name": p["name"], "score": p["score"]} for pid, p in real.items()],
                key=lambda x: x["score"],
                reverse=True,
            )
            state["scoreboard"] = scoreboard

        return state

    def get_presentation_state(self, game_id: str) -> Optional[dict]:
        game = self.games.get(game_id)
        if not game:
            return None

        state = {
            "status": game["status"],
            "code": game["code"],
            "session_name": game["session_name"],
            "total_questions": len(game["questions"]),
            "current_index": game["current_index"],
            "players_count": len([p for p in game["players"].values() if p["name"] != "__presentation__"]),
            "player_names": [p["name"] for p in game["players"].values() if p["name"] != "__presentation__"],
            "timer_end_at": game.get("timer_end_at"),
            "round_info": game.get("round_info"),
        }

        idx = game["current_index"]
        if idx >= 0 and idx < len(game["questions"]):
            q = game["questions"][idx]
            state["current_question"] = {
                "question": q["question"],
                "question_type": q["question_type"],
                "type_label": q["type_label"],
                "category": q["category"],
                "options": q.get("options"),
                "image_url": q.get("image_url"),
            }
            state["answers_count"] = len(game["answers"].get(str(idx), {}))

            if game["status"] == "wagering":
                state["wagers_count"] = len(game["wagers"].get(str(idx), {}))

            if game["status"] == "answer_reveal":
                state["correct_answer"] = q["answer"]
                state["fun_fact"] = q.get("fun_fact")

        if game["status"] in ("scores", "finished"):
            real = self._real_players(game)
            scoreboard = sorted(
                [{"id": pid, "name": p["name"], "score": p["score"]} for pid, p in real.items()],
                key=lambda x: x["score"],
                reverse=True,
            )
            state["scoreboard"] = scoreboard

        return state

    def get_game_history_data(self, game_id: str) -> Optional[dict]:
        """Extract full game data for saving to DB."""
        game = self.games.get(game_id)
        if not game:
            return None

        real = self._real_players(game)
        scoreboard = sorted(
            [{"id": pid, "name": p["name"], "score": p["score"]} for pid, p in real.items()],
            key=lambda x: x["score"],
            reverse=True,
        )

        question_results = []
        for idx, q in enumerate(game["questions"]):
            ans = game["answers"].get(str(idx), {})
            player_answers = []
            for pid, a in ans.items():
                p = real.get(pid)
                if p:
                    player_answers.append({
                        "player_id": pid,
                        "player_name": p["name"],
                        "answer": a["answer"],
                        "is_correct": a["is_correct"],
                        "score_awarded": a["score_awarded"],
                    })
            question_results.append({
                "index": idx,
                "question": q["question"],
                "answer": q["answer"],
                "question_type": q["question_type"],
                "type_label": q["type_label"],
                "category": q.get("category", ""),
                "points": q.get("points", DEFAULT_POINTS),
                "player_answers": player_answers,
            })

        return {
            "game_id": game["id"],
            "code": game["code"],
            "session_id": game["session_id"],
            "session_name": game["session_name"],
            "host_user_id": game["host_user_id"],
            "scoreboard": scoreboard,
            "total_questions": len(game["questions"]),
            "question_results": question_results,
            "player_count": len(real),
            "created_at": game["created_at"],
            "ended_at": datetime.now(timezone.utc).isoformat(),
        }

    def get_serializable_state(self, game_id: str) -> Optional[dict]:
        """Get full game state for DB persistence (crash resilience)."""
        game = self.games.get(game_id)
        if not game or game["status"] == "finished":
            return None
        # Return a copy without WebSocket objects
        return {k: v for k, v in game.items()}

    def restore_game(self, game_data: dict):
        """Restore a game from DB state."""
        gid = game_data["id"]
        self.games[gid] = game_data
        if gid not in self.connections:
            self.connections[gid] = {}

    async def broadcast(self, game_id: str, message: dict):
        conns = self.connections.get(game_id, {})
        dead = []
        for conn_id, ws in conns.items():
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(conn_id)
        for conn_id in dead:
            conns.pop(conn_id, None)

    def add_connection(self, game_id: str, conn_id: str, ws: WebSocket):
        if game_id not in self.connections:
            self.connections[game_id] = {}
        self.connections[game_id][conn_id] = ws

    def remove_connection(self, game_id: str, conn_id: str):
        if game_id in self.connections:
            self.connections[game_id].pop(conn_id, None)


game_manager = GameManager()
