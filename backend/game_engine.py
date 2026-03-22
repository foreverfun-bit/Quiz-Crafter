"""
Live Trivia Game Engine
Manages real-time game sessions with WebSocket connections.
"""

import uuid
import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional
from fastapi import WebSocket
from rapidfuzz import fuzz

logger = logging.getLogger(__name__)


class GameManager:
    """Manages all active trivia games in memory."""

    def __init__(self):
        self.games: Dict[str, dict] = {}
        self.connections: Dict[str, Dict[str, WebSocket]] = {}  # game_id -> {conn_id: ws}

    def _generate_code(self) -> str:
        import random
        while True:
            code = str(random.randint(1000, 9999))
            if not any(g["code"] == code for g in self.games.values()):
                return code

    def create_game(self, host_user_id: str, session_data: dict, questions_map: dict) -> dict:
        game_id = str(uuid.uuid4())[:8]
        code = self._generate_code()

        # Build ordered question list from session
        ordered_questions = []
        type_order = [
            ("true_false_questions", "true_false", "True / False"),
            ("multiple_choice_questions", "multiple_choice", "Multiple Choice"),
            ("written_questions", "written", "Written Answer"),
            ("picture_questions", "picture", "Picture Round"),
        ]

        for field, q_type, label in type_order:
            q_ids = session_data.get(field, [])
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
                    })

        game = {
            "id": game_id,
            "code": code,
            "host_user_id": host_user_id,
            "session_id": session_data["id"],
            "session_name": session_data.get("name", "Trivia Night"),
            "status": "lobby",  # lobby, playing, question, answer_reveal, scores, finished
            "questions": ordered_questions,
            "current_index": -1,
            "players": {},  # player_id -> {name, score, connected}
            "answers": {},  # question_index -> {player_id -> {answer, is_correct, score_awarded, timestamp}}
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

        # Check for duplicate name
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

    def next_question(self, game_id: str) -> Optional[dict]:
        game = self.games.get(game_id)
        if not game:
            return None

        game["current_index"] += 1
        idx = game["current_index"]

        if idx >= len(game["questions"]):
            game["status"] = "finished"
            return None

        game["status"] = "question"
        game["answers"][str(idx)] = {}
        return game["questions"][idx]

    def submit_answer(self, game_id: str, player_id: str, answer: str) -> bool:
        game = self.games.get(game_id)
        if not game or game["status"] != "question":
            return False

        idx = str(game["current_index"])
        if idx not in game["answers"]:
            game["answers"][idx] = {}

        if player_id in game["answers"][idx]:
            return False  # Already answered

        question = game["questions"][game["current_index"]]
        is_correct, score = self._score_answer(question, answer)

        game["answers"][idx][player_id] = {
            "answer": answer,
            "is_correct": is_correct,
            "score_awarded": score,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

        if is_correct:
            game["players"][player_id]["score"] += score

        return True

    def _score_answer(self, question: dict, answer: str) -> tuple:
        correct = question["answer"].strip()
        given = answer.strip()

        q_type = question["question_type"]

        if q_type == "true_false":
            is_correct = given.lower() == correct.lower()
            return is_correct, 10 if is_correct else 0

        elif q_type == "multiple_choice":
            # Compare the answer text or check if given answer contains the correct answer
            given_clean = given.lower().strip().rstrip(".")
            correct_clean = correct.lower().strip().rstrip(".")
            # Check exact match, or if given contains correct answer (e.g., "B. Queen" contains "queen")
            # Also check if correct answer is in the given answer (for full option text submissions)
            is_correct = (
                given_clean == correct_clean or 
                correct_clean in given_clean or
                given_clean in correct_clean
            )
            return is_correct, 10 if is_correct else 0

        else:  # written, picture
            ratio = fuzz.ratio(given.lower(), correct.lower())
            if ratio >= 85:
                return True, 10
            elif ratio >= 70:
                return True, 5  # Partial credit
            return False, 0

    def reveal_answer(self, game_id: str) -> Optional[dict]:
        game = self.games.get(game_id)
        if not game:
            return None

        game["status"] = "answer_reveal"
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
        scoreboard = sorted(
            [{"id": pid, "name": p["name"], "score": p["score"]} for pid, p in game["players"].items()],
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
            "players": game["players"],
        }

        if game["current_index"] >= 0 and game["current_index"] < len(game["questions"]):
            q = game["questions"][game["current_index"]]
            state["current_question"] = q
            state["answers"] = game["answers"].get(str(game["current_index"]), {})
            state["answers_count"] = len(state["answers"])
            state["players_count"] = len(game["players"])

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
            scoreboard = sorted(
                [{"id": pid, "name": p["name"], "score": p["score"]} for pid, p in game["players"].items()],
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
            "players_count": len(game["players"]),
            "player_names": [p["name"] for p in game["players"].values()],
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

            if game["status"] == "answer_reveal":
                state["correct_answer"] = q["answer"]
                state["fun_fact"] = q.get("fun_fact")

        if game["status"] in ("scores", "finished"):
            scoreboard = sorted(
                [{"id": pid, "name": p["name"], "score": p["score"]} for pid, p in game["players"].items()],
                key=lambda x: x["score"],
                reverse=True,
            )
            state["scoreboard"] = scoreboard

        return state

    # WebSocket broadcast
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


# Singleton
game_manager = GameManager()
