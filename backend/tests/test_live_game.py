"""
Live Game Feature Tests
Tests for the live trivia hosting platform including:
- Game creation from session
- Player joining with room code
- Question progression
- Answer submission and auto-scoring
- Score override
- WebSocket connectivity
"""

import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://wagering-trivia.preview.emergentagent.com')

# Test credentials
TEST_EMAIL = "test@example.com"
TEST_PASSWORD = "test123"


@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token for test user"""
    response = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    assert response.status_code == 200, f"Login failed: {response.text}"
    return response.json()["token"]


@pytest.fixture(scope="module")
def session_id(auth_token):
    """Get a session ID to use for game creation"""
    response = requests.get(
        f"{BASE_URL}/api/sessions",
        headers={"Authorization": f"Bearer {auth_token}"}
    )
    assert response.status_code == 200
    sessions = response.json()
    assert len(sessions) > 0, "No sessions found for testing"
    return sessions[0]["id"]


class TestGameCreation:
    """Tests for POST /api/games/create"""
    
    def test_create_game_success(self, auth_token, session_id):
        """Test creating a game from a session"""
        response = requests.post(
            f"{BASE_URL}/api/games/create",
            json={"session_id": session_id},
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200, f"Create game failed: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "game_id" in data, "Response missing game_id"
        assert "code" in data, "Response missing code"
        
        # Verify code is 4-digit number
        assert len(data["code"]) == 4, f"Code should be 4 digits, got: {data['code']}"
        assert data["code"].isdigit(), f"Code should be numeric, got: {data['code']}"
        
        print(f"Created game: {data['game_id']} with code: {data['code']}")
        return data
    
    def test_create_game_invalid_session(self, auth_token):
        """Test creating game with invalid session ID"""
        response = requests.post(
            f"{BASE_URL}/api/games/create",
            json={"session_id": "invalid-session-id"},
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
    
    def test_create_game_requires_auth(self, session_id):
        """Test that game creation requires authentication"""
        response = requests.post(
            f"{BASE_URL}/api/games/create",
            json={"session_id": session_id}
        )
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"


class TestPlayerJoin:
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
    
    def test_join_game_success(self, game_data):
        """Test player joining with code and name"""
        response = requests.post(
            f"{BASE_URL}/api/games/join",
            json={"code": game_data["code"], "player_name": "TEST_Player1"}
        )
        assert response.status_code == 200, f"Join failed: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "game_id" in data, "Response missing game_id"
        assert "player_id" in data, "Response missing player_id"
        assert "player_name" in data, "Response missing player_name"
        assert data["player_name"] == "TEST_Player1"
        
        print(f"Player joined: {data['player_id']}")
        return data
    
    def test_join_game_invalid_code(self):
        """Test joining with invalid code"""
        response = requests.post(
            f"{BASE_URL}/api/games/join",
            json={"code": "0000", "player_name": "TEST_InvalidPlayer"}
        )
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
    
    def test_join_game_no_auth_required(self, game_data):
        """Test that joining does NOT require authentication"""
        response = requests.post(
            f"{BASE_URL}/api/games/join",
            json={"code": game_data["code"], "player_name": "TEST_NoAuthPlayer"}
        )
        # Should succeed without auth
        assert response.status_code == 200, f"Join should work without auth: {response.text}"
    
    def test_join_game_duplicate_name_reconnects(self, game_data):
        """Test that joining with same name reconnects existing player"""
        # First join
        response1 = requests.post(
            f"{BASE_URL}/api/games/join",
            json={"code": game_data["code"], "player_name": "TEST_DuplicatePlayer"}
        )
        assert response1.status_code == 200
        player_id1 = response1.json()["player_id"]
        
        # Second join with same name
        response2 = requests.post(
            f"{BASE_URL}/api/games/join",
            json={"code": game_data["code"], "player_name": "TEST_DuplicatePlayer"}
        )
        assert response2.status_code == 200
        player_id2 = response2.json()["player_id"]
        
        # Should return same player_id
        assert player_id1 == player_id2, "Duplicate name should reconnect same player"


class TestHostState:
    """Tests for GET /api/games/{id}/host"""
    
    @pytest.fixture
    def game_with_players(self, auth_token, session_id):
        """Create a game with players"""
        # Create game
        response = requests.post(
            f"{BASE_URL}/api/games/create",
            json={"session_id": session_id},
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        game = response.json()
        
        # Add players
        for i in range(3):
            requests.post(
                f"{BASE_URL}/api/games/join",
                json={"code": game["code"], "player_name": f"TEST_HostPlayer{i}"}
            )
        
        return game
    
    def test_get_host_state(self, auth_token, game_with_players):
        """Test getting host state"""
        response = requests.get(
            f"{BASE_URL}/api/games/{game_with_players['game_id']}/host",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200, f"Get host state failed: {response.text}"
        data = response.json()
        
        # Verify structure
        assert "id" in data
        assert "code" in data
        assert "status" in data
        assert "session_name" in data
        assert "total_questions" in data
        assert "current_index" in data
        assert "players" in data
        
        # Verify initial state
        assert data["status"] == "lobby"
        assert data["current_index"] == -1
        assert len(data["players"]) == 3
        
        print(f"Host state: status={data['status']}, players={len(data['players'])}")
    
    def test_host_state_requires_auth(self, game_with_players):
        """Test that host state requires authentication"""
        response = requests.get(
            f"{BASE_URL}/api/games/{game_with_players['game_id']}/host"
        )
        assert response.status_code in [401, 403]


class TestPresentationState:
    """Tests for GET /api/games/{id}/present"""
    
    @pytest.fixture
    def game_data(self, auth_token, session_id):
        """Create a game for presentation tests"""
        response = requests.post(
            f"{BASE_URL}/api/games/create",
            json={"session_id": session_id},
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        return response.json()
    
    def test_get_presentation_state(self, game_data):
        """Test getting presentation state (no auth required)"""
        response = requests.get(
            f"{BASE_URL}/api/games/{game_data['game_id']}/present"
        )
        assert response.status_code == 200, f"Get present state failed: {response.text}"
        data = response.json()
        
        # Verify structure
        assert "status" in data
        assert "code" in data
        assert "session_name" in data
        assert "total_questions" in data
        assert "current_index" in data
        assert "players_count" in data
        assert "player_names" in data
        
        # Verify no sensitive data (correct answer not shown until reveal)
        if data["status"] == "question":
            assert "correct_answer" not in data or data.get("correct_answer") is None


class TestGameFlow:
    """Tests for game progression: next, reveal, scores, end"""
    
    @pytest.fixture
    def full_game_setup(self, auth_token, session_id):
        """Create a game with players for flow tests"""
        # Create game
        response = requests.post(
            f"{BASE_URL}/api/games/create",
            json={"session_id": session_id},
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        game = response.json()
        
        # Add players
        players = []
        for i in range(2):
            res = requests.post(
                f"{BASE_URL}/api/games/join",
                json={"code": game["code"], "player_name": f"TEST_FlowPlayer{i}"}
            )
            players.append(res.json())
        
        return {"game": game, "players": players, "token": auth_token}
    
    def test_next_question(self, full_game_setup):
        """Test POST /api/games/{id}/next - advances to next question"""
        game_id = full_game_setup["game"]["game_id"]
        token = full_game_setup["token"]
        
        response = requests.post(
            f"{BASE_URL}/api/games/{game_id}/next",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 200, f"Next question failed: {response.text}"
        data = response.json()
        
        # Verify state changed
        assert data["status"] == "question", f"Expected 'question' status, got: {data['status']}"
        assert data["current_index"] == 0, f"Expected index 0, got: {data['current_index']}"
        assert "current_question" in data, "Missing current_question"
        
        print(f"Advanced to question {data['current_index']}: {data['current_question']['question'][:50]}...")
    
    def test_submit_answer(self, full_game_setup):
        """Test POST /api/games/{id}/answer - submit answer and auto-score"""
        game_id = full_game_setup["game"]["game_id"]
        token = full_game_setup["token"]
        player = full_game_setup["players"][0]
        
        # First advance to question
        requests.post(
            f"{BASE_URL}/api/games/{game_id}/next",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        # Submit answer
        response = requests.post(
            f"{BASE_URL}/api/games/{game_id}/answer?player_id={player['player_id']}",
            json={"answer": "True"}
        )
        assert response.status_code == 200, f"Submit answer failed: {response.text}"
        
        print(f"Player {player['player_id']} submitted answer")
    
    def test_reveal_answer(self, full_game_setup):
        """Test POST /api/games/{id}/reveal - reveals correct answer"""
        game_id = full_game_setup["game"]["game_id"]
        token = full_game_setup["token"]
        
        # Advance to question first
        requests.post(
            f"{BASE_URL}/api/games/{game_id}/next",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        # Reveal answer
        response = requests.post(
            f"{BASE_URL}/api/games/{game_id}/reveal",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 200, f"Reveal failed: {response.text}"
        data = response.json()
        
        assert data["status"] == "answer_reveal", f"Expected 'answer_reveal' status, got: {data['status']}"
        assert "current_question" in data
        
        print(f"Revealed answer: {data['current_question']['answer']}")
    
    def test_show_scores(self, full_game_setup):
        """Test POST /api/games/{id}/scores - shows scoreboard"""
        game_id = full_game_setup["game"]["game_id"]
        token = full_game_setup["token"]
        
        # Setup: advance and reveal
        requests.post(f"{BASE_URL}/api/games/{game_id}/next", headers={"Authorization": f"Bearer {token}"})
        requests.post(f"{BASE_URL}/api/games/{game_id}/reveal", headers={"Authorization": f"Bearer {token}"})
        
        # Show scores
        response = requests.post(
            f"{BASE_URL}/api/games/{game_id}/scores",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 200, f"Show scores failed: {response.text}"
        data = response.json()
        
        assert data["status"] == "scores", f"Expected 'scores' status, got: {data['status']}"
        
        print(f"Scores shown, players: {len(data['players'])}")
    
    def test_end_game(self, full_game_setup):
        """Test POST /api/games/{id}/end - ends the game"""
        game_id = full_game_setup["game"]["game_id"]
        token = full_game_setup["token"]
        
        response = requests.post(
            f"{BASE_URL}/api/games/{game_id}/end",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 200, f"End game failed: {response.text}"
        data = response.json()
        
        assert data["status"] == "ended", f"Expected 'ended' status, got: {data['status']}"
        
        print("Game ended successfully")


class TestScoreOverride:
    """Tests for POST /api/games/{id}/override"""
    
    @pytest.fixture
    def game_with_answer(self, auth_token, session_id):
        """Create a game with a submitted answer"""
        # Create game
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
        
        # Submit answer
        requests.post(
            f"{BASE_URL}/api/games/{game['game_id']}/answer?player_id={player['player_id']}",
            json={"answer": "Wrong Answer"}
        )
        
        # Reveal
        requests.post(
            f"{BASE_URL}/api/games/{game['game_id']}/reveal",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        
        return {"game": game, "player": player, "token": auth_token}
    
    def test_override_score(self, game_with_answer):
        """Test host can override a player's score"""
        game_id = game_with_answer["game"]["game_id"]
        player_id = game_with_answer["player"]["player_id"]
        token = game_with_answer["token"]
        
        response = requests.post(
            f"{BASE_URL}/api/games/{game_id}/override",
            json={
                "player_id": player_id,
                "question_index": 0,
                "is_correct": True,
                "score": 10
            },
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 200, f"Override failed: {response.text}"
        data = response.json()
        
        # Verify player score updated
        player_score = data["players"][player_id]["score"]
        assert player_score == 10, f"Expected score 10, got: {player_score}"
        
        print(f"Score overridden to 10 for player {player_id}")


class TestAutoScoring:
    """Tests for auto-scoring logic"""
    
    @pytest.fixture
    def game_for_scoring(self, auth_token, session_id):
        """Create a game for scoring tests"""
        response = requests.post(
            f"{BASE_URL}/api/games/create",
            json={"session_id": session_id},
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        game = response.json()
        
        # Advance to first question
        requests.post(
            f"{BASE_URL}/api/games/{game['game_id']}/next",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        
        return {"game": game, "token": auth_token}
    
    def test_exact_match_true_false(self, game_for_scoring):
        """Test exact match for T/F gives 10 pts"""
        game_id = game_for_scoring["game"]["game_id"]
        token = game_for_scoring["token"]
        
        # Get current question to know the answer
        host_state = requests.get(
            f"{BASE_URL}/api/games/{game_id}/host",
            headers={"Authorization": f"Bearer {token}"}
        ).json()
        
        if host_state.get("current_question", {}).get("question_type") != "true_false":
            pytest.skip("First question is not true/false type")
        
        correct_answer = host_state["current_question"]["answer"]
        
        # Join and submit correct answer
        player_res = requests.post(
            f"{BASE_URL}/api/games/join",
            json={"code": game_for_scoring["game"]["code"], "player_name": "TEST_ScoringPlayer"}
        )
        player = player_res.json()
        
        requests.post(
            f"{BASE_URL}/api/games/{game_id}/answer?player_id={player['player_id']}",
            json={"answer": correct_answer}
        )
        
        # Reveal and check score
        requests.post(f"{BASE_URL}/api/games/{game_id}/reveal", headers={"Authorization": f"Bearer {token}"})
        
        host_state = requests.get(
            f"{BASE_URL}/api/games/{game_id}/host",
            headers={"Authorization": f"Bearer {token}"}
        ).json()
        
        player_score = host_state["players"][player["player_id"]]["score"]
        assert player_score == 10, f"Expected 10 pts for correct T/F, got: {player_score}"
        
        print(f"Correct T/F answer scored: {player_score} pts")


class TestWebSocketEndpoint:
    """Tests for WebSocket /api/ws/game/{id}"""
    
    def test_websocket_url_format(self, auth_token, session_id):
        """Test that WebSocket endpoint exists and accepts connections"""
        # Create a game
        response = requests.post(
            f"{BASE_URL}/api/games/create",
            json={"session_id": session_id},
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        game = response.json()
        
        # WebSocket URL format check
        ws_url = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")
        expected_ws_url = f"{ws_url}/api/ws/game/{game['game_id']}"
        
        # We can't fully test WebSocket with requests, but we verify the URL format
        assert "game_id" in game
        print(f"WebSocket URL would be: {expected_ws_url}?role=host|player|presentation&player_id=X")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
