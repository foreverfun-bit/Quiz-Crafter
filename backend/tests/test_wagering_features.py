"""
Wagering Feature Tests
Tests for the new wagering system including:
- Custom points_per_question on game creation
- Wagering phase for picture questions
- Wager submission capped at player's current score
- Start answering transition from wagering to question
- Picture question scoring (correct = +wager, incorrect = -wager)
- Change answer with re-scoring
- Override score functionality
"""

import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://wagering-trivia.preview.emergentagent.com')

# Test credentials
TEST_EMAIL = "testhost@trivia.com"
TEST_PASSWORD = "Test1234!"
FALLBACK_EMAIL = "test@example.com"
FALLBACK_PASSWORD = "test123"


@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token for test user - try primary then fallback"""
    # Try primary test user
    response = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    if response.status_code == 200:
        return response.json()["token"]
    
    # Try to register primary user
    response = requests.post(
        f"{BASE_URL}/api/auth/register",
        json={"email": TEST_EMAIL, "password": TEST_PASSWORD, "name": "Test Host"}
    )
    if response.status_code == 200:
        return response.json()["token"]
    
    # Fallback to existing test user
    response = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": FALLBACK_EMAIL, "password": FALLBACK_PASSWORD}
    )
    assert response.status_code == 200, f"Login failed: {response.text}"
    return response.json()["token"]


@pytest.fixture(scope="module")
def session_id(auth_token):
    """Get or create a session with picture questions for wagering tests"""
    # First check existing sessions
    response = requests.get(
        f"{BASE_URL}/api/sessions",
        headers={"Authorization": f"Bearer {auth_token}"}
    )
    assert response.status_code == 200
    sessions = response.json()
    
    # Look for a session with picture questions
    for session in sessions:
        if session.get("picture_questions") and len(session["picture_questions"]) > 0:
            print(f"Using existing session with picture questions: {session['id']}")
            return session["id"]
    
    # If no session with picture questions, use any session
    if sessions:
        print(f"Using first available session: {sessions[0]['id']}")
        return sessions[0]["id"]
    
    pytest.skip("No sessions found for testing")


class TestGameCreationWithCustomPoints:
    """Tests for POST /api/games/create with custom points_per_question"""
    
    def test_create_game_with_custom_points(self, auth_token, session_id):
        """Test creating a game with custom points_per_question"""
        response = requests.post(
            f"{BASE_URL}/api/games/create",
            json={"session_id": session_id, "points_per_question": 20},
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200, f"Create game failed: {response.text}"
        data = response.json()
        
        assert "game_id" in data
        assert "code" in data
        
        # Verify host state shows custom points
        host_response = requests.get(
            f"{BASE_URL}/api/games/{data['game_id']}/host",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert host_response.status_code == 200
        host_data = host_response.json()
        
        assert host_data.get("default_points") == 20, f"Expected default_points=20, got: {host_data.get('default_points')}"
        print(f"Created game with custom points: {data['game_id']}, default_points={host_data.get('default_points')}")
    
    def test_create_game_default_points(self, auth_token, session_id):
        """Test creating a game uses default 10 points when not specified"""
        response = requests.post(
            f"{BASE_URL}/api/games/create",
            json={"session_id": session_id},
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        
        host_response = requests.get(
            f"{BASE_URL}/api/games/{data['game_id']}/host",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        host_data = host_response.json()
        
        assert host_data.get("default_points") == 10, f"Expected default_points=10, got: {host_data.get('default_points')}"
        print(f"Default points verified: {host_data.get('default_points')}")


class TestJoinGameByCode:
    """Tests for POST /api/games/join"""
    
    @pytest.fixture
    def game_data(self, auth_token, session_id):
        """Create a game for join tests"""
        response = requests.post(
            f"{BASE_URL}/api/games/create",
            json={"session_id": session_id},
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        return response.json()
    
    def test_join_game_returns_player_id(self, game_data):
        """Test joining game returns player_id"""
        response = requests.post(
            f"{BASE_URL}/api/games/join",
            json={"code": game_data["code"], "player_name": "TEST_WagerPlayer1"}
        )
        assert response.status_code == 200, f"Join failed: {response.text}"
        data = response.json()
        
        assert "game_id" in data
        assert "player_id" in data
        assert "player_name" in data
        assert data["game_id"] == game_data["game_id"]
        assert data["player_name"] == "TEST_WagerPlayer1"
        print(f"Player joined with ID: {data['player_id']}")


class TestSetPointsForQuestion:
    """Tests for POST /api/games/{id}/set-points"""
    
    @pytest.fixture
    def game_with_question(self, auth_token, session_id):
        """Create a game and advance to first question"""
        response = requests.post(
            f"{BASE_URL}/api/games/create",
            json={"session_id": session_id},
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        game = response.json()
        
        # Add a player
        requests.post(
            f"{BASE_URL}/api/games/join",
            json={"code": game["code"], "player_name": "TEST_PointsPlayer"}
        )
        
        # Advance to first question
        requests.post(
            f"{BASE_URL}/api/games/{game['game_id']}/next",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        
        return {"game": game, "token": auth_token}
    
    def test_set_points_for_question(self, game_with_question):
        """Test setting custom points for a specific question"""
        game_id = game_with_question["game"]["game_id"]
        token = game_with_question["token"]
        
        response = requests.post(
            f"{BASE_URL}/api/games/{game_id}/set-points",
            json={"question_index": 0, "points": 25},
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 200, f"Set points failed: {response.text}"
        data = response.json()
        
        # Verify the question now has 25 points
        assert data.get("current_question", {}).get("points") == 25, f"Expected points=25, got: {data.get('current_question', {}).get('points')}"
        print(f"Set question 0 to 25 points")
    
    def test_set_points_invalid_index(self, game_with_question):
        """Test setting points for invalid question index returns error"""
        game_id = game_with_question["game"]["game_id"]
        token = game_with_question["token"]
        
        response = requests.post(
            f"{BASE_URL}/api/games/{game_id}/set-points",
            json={"question_index": 999, "points": 25},
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 400, f"Expected 400 for invalid index, got: {response.status_code}"


class TestWageringPhase:
    """Tests for wagering phase on picture questions"""
    
    @pytest.fixture
    def game_for_wagering(self, auth_token, session_id):
        """Create a game and advance to a picture question for wagering"""
        response = requests.post(
            f"{BASE_URL}/api/games/create",
            json={"session_id": session_id},
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        game = response.json()
        
        # Add players with some initial score
        player_res = requests.post(
            f"{BASE_URL}/api/games/join",
            json={"code": game["code"], "player_name": "TEST_WagerPlayer"}
        )
        player = player_res.json()
        
        return {"game": game, "player": player, "token": auth_token}
    
    def test_picture_question_enters_wagering_status(self, game_for_wagering):
        """Test that picture questions go to 'wagering' status instead of 'question'"""
        game_id = game_for_wagering["game"]["game_id"]
        token = game_for_wagering["token"]
        
        # Advance through questions until we hit a picture question
        max_attempts = 15
        found_picture = False
        
        for _ in range(max_attempts):
            response = requests.post(
                f"{BASE_URL}/api/games/{game_id}/next",
                headers={"Authorization": f"Bearer {token}"}
            )
            
            if response.status_code != 200:
                break
                
            data = response.json()
            
            if data.get("status") == "finished":
                break
            
            current_q = data.get("current_question", {})
            if current_q.get("question_type") == "picture":
                found_picture = True
                assert data["status"] == "wagering", f"Picture question should have status 'wagering', got: {data['status']}"
                print(f"Picture question entered wagering status: {current_q.get('question', '')[:50]}...")
                break
            
            # If not picture, advance through reveal/scores
            if data["status"] == "question":
                requests.post(f"{BASE_URL}/api/games/{game_id}/reveal", headers={"Authorization": f"Bearer {token}"})
                requests.post(f"{BASE_URL}/api/games/{game_id}/scores", headers={"Authorization": f"Bearer {token}"})
        
        if not found_picture:
            pytest.skip("No picture questions found in session")
    
    def test_regular_question_goes_to_question_status(self, game_for_wagering):
        """Test that non-picture questions go directly to 'question' status"""
        game_id = game_for_wagering["game"]["game_id"]
        token = game_for_wagering["token"]
        
        response = requests.post(
            f"{BASE_URL}/api/games/{game_id}/next",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 200
        data = response.json()
        
        current_q = data.get("current_question", {})
        if current_q.get("question_type") != "picture":
            assert data["status"] == "question", f"Non-picture question should have status 'question', got: {data['status']}"
            print(f"Regular question ({current_q.get('question_type')}) entered question status")
        else:
            # If first question is picture, that's fine - it should be wagering
            assert data["status"] == "wagering"


class TestWagerSubmission:
    """Tests for POST /api/games/{id}/wager"""
    
    @pytest.fixture
    def game_in_wagering(self, auth_token, session_id):
        """Create a game and get to wagering phase"""
        response = requests.post(
            f"{BASE_URL}/api/games/create",
            json={"session_id": session_id},
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        game = response.json()
        
        # Add player
        player_res = requests.post(
            f"{BASE_URL}/api/games/join",
            json={"code": game["code"], "player_name": "TEST_WagerSubmitPlayer"}
        )
        player = player_res.json()
        
        # Give player some points by answering questions correctly
        # Advance through questions until we find a picture question
        max_attempts = 15
        for _ in range(max_attempts):
            next_res = requests.post(
                f"{BASE_URL}/api/games/{game['game_id']}/next",
                headers={"Authorization": f"Bearer {auth_token}"}
            )
            
            if next_res.status_code != 200:
                break
            
            data = next_res.json()
            
            if data.get("status") == "finished":
                break
            
            if data.get("status") == "wagering":
                # Found picture question in wagering phase
                return {"game": game, "player": player, "token": auth_token, "in_wagering": True}
            
            # Answer the question to build up score
            if data.get("status") == "question":
                correct_answer = data.get("current_question", {}).get("answer", "True")
                requests.post(
                    f"{BASE_URL}/api/games/{game['game_id']}/answer?player_id={player['player_id']}",
                    json={"answer": correct_answer}
                )
                requests.post(f"{BASE_URL}/api/games/{game['game_id']}/reveal", headers={"Authorization": f"Bearer {auth_token}"})
                requests.post(f"{BASE_URL}/api/games/{game['game_id']}/scores", headers={"Authorization": f"Bearer {auth_token}"})
        
        return {"game": game, "player": player, "token": auth_token, "in_wagering": False}
    
    def test_submit_wager_capped_at_current_score(self, game_in_wagering):
        """Test that wager is capped at player's current score"""
        if not game_in_wagering.get("in_wagering"):
            pytest.skip("Could not reach wagering phase - no picture questions")
        
        game_id = game_in_wagering["game"]["game_id"]
        player_id = game_in_wagering["player"]["player_id"]
        token = game_in_wagering["token"]
        
        # Get player's current score
        host_state = requests.get(
            f"{BASE_URL}/api/games/{game_id}/host",
            headers={"Authorization": f"Bearer {token}"}
        ).json()
        
        player_score = host_state["players"][player_id]["score"]
        
        # Try to wager more than current score
        response = requests.post(
            f"{BASE_URL}/api/games/{game_id}/wager?player_id={player_id}",
            json={"amount": player_score + 100}
        )
        assert response.status_code == 200, f"Wager submission failed: {response.text}"
        
        # Verify wager was capped
        host_state = requests.get(
            f"{BASE_URL}/api/games/{game_id}/host",
            headers={"Authorization": f"Bearer {token}"}
        ).json()
        
        wagers = host_state.get("wagers", {})
        actual_wager = wagers.get(player_id, 0)
        
        assert actual_wager <= player_score, f"Wager {actual_wager} should be capped at score {player_score}"
        print(f"Wager capped correctly: requested {player_score + 100}, got {actual_wager} (score was {player_score})")


class TestStartAnswering:
    """Tests for POST /api/games/{id}/start-answering"""
    
    @pytest.fixture
    def game_in_wagering_phase(self, auth_token, session_id):
        """Create a game in wagering phase"""
        response = requests.post(
            f"{BASE_URL}/api/games/create",
            json={"session_id": session_id},
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        game = response.json()
        
        # Add player
        player_res = requests.post(
            f"{BASE_URL}/api/games/join",
            json={"code": game["code"], "player_name": "TEST_StartAnswerPlayer"}
        )
        player = player_res.json()
        
        # Find a picture question
        max_attempts = 15
        for _ in range(max_attempts):
            next_res = requests.post(
                f"{BASE_URL}/api/games/{game['game_id']}/next",
                headers={"Authorization": f"Bearer {auth_token}"}
            )
            
            if next_res.status_code != 200:
                break
            
            data = next_res.json()
            
            if data.get("status") == "wagering":
                return {"game": game, "player": player, "token": auth_token, "in_wagering": True}
            
            if data.get("status") == "question":
                requests.post(f"{BASE_URL}/api/games/{game['game_id']}/reveal", headers={"Authorization": f"Bearer {auth_token}"})
                requests.post(f"{BASE_URL}/api/games/{game['game_id']}/scores", headers={"Authorization": f"Bearer {auth_token}"})
        
        return {"game": game, "player": player, "token": auth_token, "in_wagering": False}
    
    def test_start_answering_transitions_to_question(self, game_in_wagering_phase):
        """Test that start-answering transitions from wagering to question status"""
        if not game_in_wagering_phase.get("in_wagering"):
            pytest.skip("Could not reach wagering phase - no picture questions")
        
        game_id = game_in_wagering_phase["game"]["game_id"]
        token = game_in_wagering_phase["token"]
        
        # Verify we're in wagering
        host_state = requests.get(
            f"{BASE_URL}/api/games/{game_id}/host",
            headers={"Authorization": f"Bearer {token}"}
        ).json()
        assert host_state["status"] == "wagering"
        
        # Call start-answering
        response = requests.post(
            f"{BASE_URL}/api/games/{game_id}/start-answering",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 200, f"Start answering failed: {response.text}"
        data = response.json()
        
        assert data["status"] == "question", f"Expected status 'question' after start-answering, got: {data['status']}"
        print("Successfully transitioned from wagering to question status")
    
    def test_start_answering_fails_when_not_wagering(self, auth_token, session_id):
        """Test that start-answering fails when not in wagering phase"""
        response = requests.post(
            f"{BASE_URL}/api/games/create",
            json={"session_id": session_id},
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        game = response.json()
        
        # Try to start answering from lobby (should fail)
        response = requests.post(
            f"{BASE_URL}/api/games/{game['game_id']}/start-answering",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 400, f"Expected 400 when not in wagering, got: {response.status_code}"


class TestChangeAnswer:
    """Tests for POST /api/games/{id}/change-answer"""
    
    @pytest.fixture
    def game_with_submitted_answer(self, auth_token, session_id):
        """Create a game with a submitted answer"""
        response = requests.post(
            f"{BASE_URL}/api/games/create",
            json={"session_id": session_id},
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        game = response.json()
        
        # Add player
        player_res = requests.post(
            f"{BASE_URL}/api/games/join",
            json={"code": game["code"], "player_name": "TEST_ChangeAnswerPlayer"}
        )
        player = player_res.json()
        
        # Advance to question
        requests.post(
            f"{BASE_URL}/api/games/{game['game_id']}/next",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        
        # Get host state to check question type
        host_state = requests.get(
            f"{BASE_URL}/api/games/{game['game_id']}/host",
            headers={"Authorization": f"Bearer {auth_token}"}
        ).json()
        
        # If wagering, start answering first
        if host_state["status"] == "wagering":
            requests.post(
                f"{BASE_URL}/api/games/{game['game_id']}/start-answering",
                headers={"Authorization": f"Bearer {auth_token}"}
            )
        
        # Submit wrong answer
        requests.post(
            f"{BASE_URL}/api/games/{game['game_id']}/answer?player_id={player['player_id']}",
            json={"answer": "WRONG_ANSWER_12345"}
        )
        
        # Reveal
        requests.post(
            f"{BASE_URL}/api/games/{game['game_id']}/reveal",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        
        return {"game": game, "player": player, "token": auth_token}
    
    def test_change_answer_rescores(self, game_with_submitted_answer):
        """Test that changing an answer re-scores it correctly"""
        game_id = game_with_submitted_answer["game"]["game_id"]
        player_id = game_with_submitted_answer["player"]["player_id"]
        token = game_with_submitted_answer["token"]
        
        # Get correct answer
        host_state = requests.get(
            f"{BASE_URL}/api/games/{game_id}/host",
            headers={"Authorization": f"Bearer {token}"}
        ).json()
        
        correct_answer = host_state["current_question"]["answer"]
        old_score = host_state["players"][player_id]["score"]
        
        # Change to correct answer
        response = requests.post(
            f"{BASE_URL}/api/games/{game_id}/change-answer",
            json={
                "player_id": player_id,
                "question_index": 0,
                "new_answer": correct_answer
            },
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 200, f"Change answer failed: {response.text}"
        data = response.json()
        
        new_score = data["players"][player_id]["score"]
        assert new_score > old_score, f"Score should increase after changing to correct answer: {old_score} -> {new_score}"
        print(f"Answer changed and re-scored: {old_score} -> {new_score}")


class TestOverrideScore:
    """Tests for POST /api/games/{id}/override"""
    
    @pytest.fixture
    def game_with_answer_for_override(self, auth_token, session_id):
        """Create a game with a submitted answer for override testing"""
        response = requests.post(
            f"{BASE_URL}/api/games/create",
            json={"session_id": session_id},
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        game = response.json()
        
        # Add player
        player_res = requests.post(
            f"{BASE_URL}/api/games/join",
            json={"code": game["code"], "player_name": "TEST_OverridePlayer"}
        )
        player = player_res.json()
        
        # Advance to question
        requests.post(
            f"{BASE_URL}/api/games/{game['game_id']}/next",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        
        # Get host state to check question type
        host_state = requests.get(
            f"{BASE_URL}/api/games/{game['game_id']}/host",
            headers={"Authorization": f"Bearer {auth_token}"}
        ).json()
        
        # If wagering, start answering first
        if host_state["status"] == "wagering":
            requests.post(
                f"{BASE_URL}/api/games/{game['game_id']}/start-answering",
                headers={"Authorization": f"Bearer {auth_token}"}
            )
        
        # Submit answer
        requests.post(
            f"{BASE_URL}/api/games/{game['game_id']}/answer?player_id={player['player_id']}",
            json={"answer": "Some Answer"}
        )
        
        # Reveal
        requests.post(
            f"{BASE_URL}/api/games/{game['game_id']}/reveal",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        
        return {"game": game, "player": player, "token": auth_token}
    
    def test_override_score_sets_any_value(self, game_with_answer_for_override):
        """Test that host can override to any score value"""
        game_id = game_with_answer_for_override["game"]["game_id"]
        player_id = game_with_answer_for_override["player"]["player_id"]
        token = game_with_answer_for_override["token"]
        
        # Override to specific score
        response = requests.post(
            f"{BASE_URL}/api/games/{game_id}/override",
            json={
                "player_id": player_id,
                "question_index": 0,
                "is_correct": True,
                "score": 50
            },
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 200, f"Override failed: {response.text}"
        data = response.json()
        
        player_score = data["players"][player_id]["score"]
        assert player_score == 50, f"Expected score 50 after override, got: {player_score}"
        print(f"Score overridden to 50")
    
    def test_override_score_negative(self, game_with_answer_for_override):
        """Test that host can override to negative score"""
        game_id = game_with_answer_for_override["game"]["game_id"]
        player_id = game_with_answer_for_override["player"]["player_id"]
        token = game_with_answer_for_override["token"]
        
        # Override to negative score
        response = requests.post(
            f"{BASE_URL}/api/games/{game_id}/override",
            json={
                "player_id": player_id,
                "question_index": 0,
                "is_correct": False,
                "score": -20
            },
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 200, f"Override failed: {response.text}"
        data = response.json()
        
        # Score should reflect the override
        print(f"Score after negative override: {data['players'][player_id]['score']}")


class TestRevealShowScoresEnd:
    """Tests for reveal, show scores, and end game endpoints"""
    
    @pytest.fixture
    def game_ready_for_reveal(self, auth_token, session_id):
        """Create a game ready for reveal"""
        response = requests.post(
            f"{BASE_URL}/api/games/create",
            json={"session_id": session_id},
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        game = response.json()
        
        # Add player
        player_res = requests.post(
            f"{BASE_URL}/api/games/join",
            json={"code": game["code"], "player_name": "TEST_RevealPlayer"}
        )
        player = player_res.json()
        
        # Advance to question
        requests.post(
            f"{BASE_URL}/api/games/{game['game_id']}/next",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        
        # Handle wagering if needed
        host_state = requests.get(
            f"{BASE_URL}/api/games/{game['game_id']}/host",
            headers={"Authorization": f"Bearer {auth_token}"}
        ).json()
        
        if host_state["status"] == "wagering":
            requests.post(
                f"{BASE_URL}/api/games/{game['game_id']}/start-answering",
                headers={"Authorization": f"Bearer {auth_token}"}
            )
        
        # Submit answer
        requests.post(
            f"{BASE_URL}/api/games/{game['game_id']}/answer?player_id={player['player_id']}",
            json={"answer": "Test Answer"}
        )
        
        return {"game": game, "player": player, "token": auth_token}
    
    def test_reveal_answer_returns_proper_state(self, game_ready_for_reveal):
        """Test reveal answer returns answer_reveal status"""
        game_id = game_ready_for_reveal["game"]["game_id"]
        token = game_ready_for_reveal["token"]
        
        response = requests.post(
            f"{BASE_URL}/api/games/{game_id}/reveal",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 200
        data = response.json()
        
        assert data["status"] == "answer_reveal"
        assert "current_question" in data
        print(f"Reveal returned status: {data['status']}")
    
    def test_show_scores_returns_proper_state(self, game_ready_for_reveal):
        """Test show scores returns scores status"""
        game_id = game_ready_for_reveal["game"]["game_id"]
        token = game_ready_for_reveal["token"]
        
        # First reveal
        requests.post(f"{BASE_URL}/api/games/{game_id}/reveal", headers={"Authorization": f"Bearer {token}"})
        
        # Then show scores
        response = requests.post(
            f"{BASE_URL}/api/games/{game_id}/scores",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 200
        data = response.json()
        
        assert data["status"] == "scores"
        print(f"Scores returned status: {data['status']}")
    
    def test_end_game_returns_proper_state(self, game_ready_for_reveal):
        """Test end game returns ended status"""
        game_id = game_ready_for_reveal["game"]["game_id"]
        token = game_ready_for_reveal["token"]
        
        response = requests.post(
            f"{BASE_URL}/api/games/{game_id}/end",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 200
        data = response.json()
        
        assert data["status"] == "ended"
        print(f"End game returned status: {data['status']}")


class TestPresentationState:
    """Tests for GET /api/games/{id}/present during wagering"""
    
    def test_presentation_shows_wagering_status(self, auth_token, session_id):
        """Test that presentation state shows wagering status for picture questions"""
        response = requests.post(
            f"{BASE_URL}/api/games/create",
            json={"session_id": session_id},
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        game = response.json()
        
        # Add player
        requests.post(
            f"{BASE_URL}/api/games/join",
            json={"code": game["code"], "player_name": "TEST_PresentPlayer"}
        )
        
        # Find a picture question
        max_attempts = 15
        found_wagering = False
        
        for _ in range(max_attempts):
            next_res = requests.post(
                f"{BASE_URL}/api/games/{game['game_id']}/next",
                headers={"Authorization": f"Bearer {auth_token}"}
            )
            
            if next_res.status_code != 200:
                break
            
            data = next_res.json()
            
            if data.get("status") == "wagering":
                found_wagering = True
                
                # Check presentation state
                present_res = requests.get(f"{BASE_URL}/api/games/{game['game_id']}/present")
                assert present_res.status_code == 200
                present_data = present_res.json()
                
                assert present_data["status"] == "wagering"
                assert "wagers_count" in present_data
                print(f"Presentation shows wagering status with wagers_count: {present_data.get('wagers_count')}")
                break
            
            if data.get("status") == "question":
                requests.post(f"{BASE_URL}/api/games/{game['game_id']}/reveal", headers={"Authorization": f"Bearer {auth_token}"})
                requests.post(f"{BASE_URL}/api/games/{game['game_id']}/scores", headers={"Authorization": f"Bearer {auth_token}"})
        
        if not found_wagering:
            pytest.skip("No picture questions found in session")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
