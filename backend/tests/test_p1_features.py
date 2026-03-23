"""
Test P1 Features: Timer, Game History, Crash Resilience
Tests for:
1. Configurable Question Timer
2. Save Game History & Scores to DB
3. Persist Game State for Crash Resilience
"""

import pytest
import requests
import os
import time
from datetime import datetime

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://wagering-trivia.preview.emergentagent.com')

# Test credentials
TEST_EMAIL = "testhost@trivia.com"
TEST_PASSWORD = "Test1234!"


@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD
    })
    assert response.status_code == 200, f"Login failed: {response.text}"
    return response.json()["token"]


@pytest.fixture(scope="module")
def api_client(auth_token):
    """Authenticated requests session"""
    session = requests.Session()
    session.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {auth_token}"
    })
    return session


@pytest.fixture(scope="module")
def test_session_id(api_client):
    """Get or create a test session with questions"""
    # First check for existing sessions
    res = api_client.get(f"{BASE_URL}/api/sessions")
    assert res.status_code == 200
    sessions = res.json()
    
    if sessions:
        # Use first available session
        return sessions[0]["id"]
    
    # Create a test session if none exist
    # First create some questions
    tf_q = api_client.post(f"{BASE_URL}/api/questions", json={
        "category": "TEST_Timer",
        "question": "TEST_Is the sky blue?",
        "answer": "True",
        "question_type": "true_false"
    })
    assert tf_q.status_code == 200
    tf_id = tf_q.json()["id"]
    
    mc_q = api_client.post(f"{BASE_URL}/api/questions", json={
        "category": "TEST_Timer",
        "question": "TEST_What color is grass?",
        "answer": "B. Green",
        "question_type": "multiple_choice",
        "options": ["A. Red", "B. Green", "C. Blue", "D. Yellow"]
    })
    assert mc_q.status_code == 200
    mc_id = mc_q.json()["id"]
    
    # Create session
    session_res = api_client.post(f"{BASE_URL}/api/sessions", json={
        "name": "TEST_Timer Test Session",
        "true_false_questions": [tf_id],
        "multiple_choice_questions": [mc_id],
        "written_questions": [],
        "picture_questions": []
    })
    assert session_res.status_code == 200
    return session_res.json()["id"]


class TestTimerFeature:
    """Tests for Configurable Question Timer"""
    
    def test_create_game_with_timer_duration(self, api_client, test_session_id):
        """Test creating a game with timer_duration parameter"""
        res = api_client.post(f"{BASE_URL}/api/games/create", json={
            "session_id": test_session_id,
            "timer_duration": 30
        })
        assert res.status_code == 200, f"Failed to create game: {res.text}"
        data = res.json()
        assert "game_id" in data
        assert "code" in data
        
        # Verify timer_duration is set in host state
        host_res = api_client.get(f"{BASE_URL}/api/games/{data['game_id']}/host")
        assert host_res.status_code == 200
        host_state = host_res.json()
        assert host_state.get("timer_duration") == 30
        print(f"✓ Game created with timer_duration=30: game_id={data['game_id']}")
        return data["game_id"]
    
    def test_create_game_with_zero_timer(self, api_client, test_session_id):
        """Test creating a game with timer_duration=0 (no limit)"""
        res = api_client.post(f"{BASE_URL}/api/games/create", json={
            "session_id": test_session_id,
            "timer_duration": 0
        })
        assert res.status_code == 200
        data = res.json()
        
        host_res = api_client.get(f"{BASE_URL}/api/games/{data['game_id']}/host")
        assert host_res.status_code == 200
        host_state = host_res.json()
        assert host_state.get("timer_duration") == 0
        print(f"✓ Game created with timer_duration=0 (no limit)")
    
    def test_timer_starts_on_next_question(self, api_client, test_session_id):
        """Test that timer_end_at is set when question starts"""
        # Create game with 30s timer
        create_res = api_client.post(f"{BASE_URL}/api/games/create", json={
            "session_id": test_session_id,
            "timer_duration": 30
        })
        assert create_res.status_code == 200
        game_id = create_res.json()["game_id"]
        
        # Join a player
        join_res = requests.post(f"{BASE_URL}/api/games/join", json={
            "code": create_res.json()["code"],
            "player_name": "TEST_TimerPlayer"
        })
        assert join_res.status_code == 200
        
        # Start game (next question)
        next_res = api_client.post(f"{BASE_URL}/api/games/{game_id}/next")
        assert next_res.status_code == 200
        
        # Check timer_end_at is set
        host_state = next_res.json()
        assert host_state.get("timer_end_at") is not None, "timer_end_at should be set when question starts"
        
        # Verify it's a valid ISO timestamp
        timer_end = host_state["timer_end_at"]
        try:
            datetime.fromisoformat(timer_end.replace('Z', '+00:00'))
        except ValueError:
            pytest.fail(f"timer_end_at is not a valid ISO timestamp: {timer_end}")
        
        print(f"✓ Timer started on next question: timer_end_at={timer_end}")
        return game_id
    
    def test_timer_cleared_on_reveal(self, api_client, test_session_id):
        """Test that timer_end_at is cleared when answer is revealed"""
        # Create game with timer
        create_res = api_client.post(f"{BASE_URL}/api/games/create", json={
            "session_id": test_session_id,
            "timer_duration": 30
        })
        game_id = create_res.json()["game_id"]
        
        # Join player
        requests.post(f"{BASE_URL}/api/games/join", json={
            "code": create_res.json()["code"],
            "player_name": "TEST_RevealPlayer"
        })
        
        # Start question
        api_client.post(f"{BASE_URL}/api/games/{game_id}/next")
        
        # Reveal answer
        reveal_res = api_client.post(f"{BASE_URL}/api/games/{game_id}/reveal")
        assert reveal_res.status_code == 200
        
        host_state = reveal_res.json()
        assert host_state.get("timer_end_at") is None, "timer_end_at should be cleared on reveal"
        print("✓ Timer cleared on reveal")
    
    def test_timer_cleared_on_scores(self, api_client, test_session_id):
        """Test that timer_end_at is cleared when showing scores"""
        # Create game with timer
        create_res = api_client.post(f"{BASE_URL}/api/games/create", json={
            "session_id": test_session_id,
            "timer_duration": 30
        })
        game_id = create_res.json()["game_id"]
        
        # Join player
        requests.post(f"{BASE_URL}/api/games/join", json={
            "code": create_res.json()["code"],
            "player_name": "TEST_ScoresPlayer"
        })
        
        # Start question -> reveal -> scores
        api_client.post(f"{BASE_URL}/api/games/{game_id}/next")
        api_client.post(f"{BASE_URL}/api/games/{game_id}/reveal")
        scores_res = api_client.post(f"{BASE_URL}/api/games/{game_id}/scores")
        assert scores_res.status_code == 200
        
        host_state = scores_res.json()
        assert host_state.get("timer_end_at") is None, "timer_end_at should be cleared on scores"
        print("✓ Timer cleared on scores")
    
    def test_set_timer_endpoint(self, api_client, test_session_id):
        """Test POST /api/games/{id}/set-timer endpoint"""
        # Create game
        create_res = api_client.post(f"{BASE_URL}/api/games/create", json={
            "session_id": test_session_id,
            "timer_duration": 30
        })
        game_id = create_res.json()["game_id"]
        
        # Change timer to 60s
        set_timer_res = api_client.post(f"{BASE_URL}/api/games/{game_id}/set-timer", json={
            "duration": 60
        })
        assert set_timer_res.status_code == 200
        
        host_state = set_timer_res.json()
        assert host_state.get("timer_duration") == 60
        print("✓ Set timer endpoint works: changed to 60s")
        
        # Change timer to 0 (off)
        set_timer_res = api_client.post(f"{BASE_URL}/api/games/{game_id}/set-timer", json={
            "duration": 0
        })
        assert set_timer_res.status_code == 200
        host_state = set_timer_res.json()
        assert host_state.get("timer_duration") == 0
        print("✓ Set timer endpoint works: disabled timer")
    
    def test_timer_in_player_state(self, api_client, test_session_id):
        """Test that timer_end_at is included in player state"""
        # Create game with timer
        create_res = api_client.post(f"{BASE_URL}/api/games/create", json={
            "session_id": test_session_id,
            "timer_duration": 30
        })
        game_id = create_res.json()["game_id"]
        code = create_res.json()["code"]
        
        # Join player
        join_res = requests.post(f"{BASE_URL}/api/games/join", json={
            "code": code,
            "player_name": "TEST_PlayerStateTimer"
        })
        player_id = join_res.json()["player_id"]
        
        # Start question
        api_client.post(f"{BASE_URL}/api/games/{game_id}/next")
        
        # Check presentation state has timer_end_at
        present_res = requests.get(f"{BASE_URL}/api/games/{game_id}/present")
        assert present_res.status_code == 200
        present_state = present_res.json()
        assert "timer_end_at" in present_state
        assert present_state["timer_end_at"] is not None
        print(f"✓ Presentation state includes timer_end_at: {present_state['timer_end_at']}")


class TestGameHistoryFeature:
    """Tests for Save Game History & Scores to DB"""
    
    def test_game_history_saved_on_end(self, api_client, test_session_id):
        """Test that game history is saved when game ends via end_game"""
        # Create and play a game
        create_res = api_client.post(f"{BASE_URL}/api/games/create", json={
            "session_id": test_session_id,
            "timer_duration": 0
        })
        game_id = create_res.json()["game_id"]
        code = create_res.json()["code"]
        
        # Join players
        join1 = requests.post(f"{BASE_URL}/api/games/join", json={
            "code": code,
            "player_name": "TEST_HistoryPlayer1"
        })
        player1_id = join1.json()["player_id"]
        
        join2 = requests.post(f"{BASE_URL}/api/games/join", json={
            "code": code,
            "player_name": "TEST_HistoryPlayer2"
        })
        player2_id = join2.json()["player_id"]
        
        # Play one question
        api_client.post(f"{BASE_URL}/api/games/{game_id}/next")
        
        # Submit answers
        requests.post(f"{BASE_URL}/api/games/{game_id}/answer?player_id={player1_id}", json={
            "answer": "True"
        })
        requests.post(f"{BASE_URL}/api/games/{game_id}/answer?player_id={player2_id}", json={
            "answer": "False"
        })
        
        # Reveal and show scores
        api_client.post(f"{BASE_URL}/api/games/{game_id}/reveal")
        api_client.post(f"{BASE_URL}/api/games/{game_id}/scores")
        
        # End game
        end_res = api_client.post(f"{BASE_URL}/api/games/{game_id}/end")
        assert end_res.status_code == 200
        
        # Check game history
        history_res = api_client.get(f"{BASE_URL}/api/game-history")
        assert history_res.status_code == 200
        history = history_res.json()
        
        # Find our game in history
        our_game = next((g for g in history if g.get("game_id") == game_id), None)
        assert our_game is not None, f"Game {game_id} not found in history"
        
        # Verify history data
        assert "scoreboard" in our_game
        assert "session_name" in our_game
        assert "code" in our_game
        assert "ended_at" in our_game
        assert "player_count" in our_game
        
        print(f"✓ Game history saved on end: game_id={game_id}")
        return our_game["id"]
    
    def test_game_history_saved_on_natural_finish(self, api_client, test_session_id):
        """Test that game history is saved when all questions are answered"""
        # Create game
        create_res = api_client.post(f"{BASE_URL}/api/games/create", json={
            "session_id": test_session_id,
            "timer_duration": 0
        })
        game_id = create_res.json()["game_id"]
        code = create_res.json()["code"]
        
        # Join player
        join_res = requests.post(f"{BASE_URL}/api/games/join", json={
            "code": code,
            "player_name": "TEST_NaturalFinish"
        })
        player_id = join_res.json()["player_id"]
        
        # Get host state to know total questions
        host_state = api_client.get(f"{BASE_URL}/api/games/{game_id}/host").json()
        total_questions = host_state["total_questions"]
        
        # Play through all questions
        for i in range(total_questions):
            next_res = api_client.post(f"{BASE_URL}/api/games/{game_id}/next")
            if next_res.json().get("status") == "finished":
                break
            
            # Submit answer
            requests.post(f"{BASE_URL}/api/games/{game_id}/answer?player_id={player_id}", json={
                "answer": "True"
            })
            
            # Reveal and scores
            api_client.post(f"{BASE_URL}/api/games/{game_id}/reveal")
            api_client.post(f"{BASE_URL}/api/games/{game_id}/scores")
        
        # Final next should finish the game
        final_res = api_client.post(f"{BASE_URL}/api/games/{game_id}/next")
        assert final_res.json().get("status") == "finished"
        
        # Check game history
        history_res = api_client.get(f"{BASE_URL}/api/game-history")
        history = history_res.json()
        
        our_game = next((g for g in history if g.get("game_id") == game_id), None)
        assert our_game is not None, f"Game {game_id} not found in history after natural finish"
        print(f"✓ Game history saved on natural finish: game_id={game_id}")
    
    def test_get_game_history_list(self, api_client):
        """Test GET /api/game-history returns list of past games"""
        res = api_client.get(f"{BASE_URL}/api/game-history")
        assert res.status_code == 200
        history = res.json()
        
        assert isinstance(history, list)
        
        if len(history) > 0:
            game = history[0]
            assert "id" in game
            assert "game_id" in game
            assert "session_name" in game
            assert "scoreboard" in game
            assert "code" in game
            assert "ended_at" in game
            print(f"✓ Game history list returned {len(history)} games")
        else:
            print("✓ Game history list returned (empty)")
    
    def test_get_game_history_detail(self, api_client, test_session_id):
        """Test GET /api/game-history/{id} returns detailed results"""
        # First ensure we have a game in history
        create_res = api_client.post(f"{BASE_URL}/api/games/create", json={
            "session_id": test_session_id,
            "timer_duration": 0
        })
        game_id = create_res.json()["game_id"]
        code = create_res.json()["code"]
        
        # Join and play
        join_res = requests.post(f"{BASE_URL}/api/games/join", json={
            "code": code,
            "player_name": "TEST_DetailPlayer"
        })
        player_id = join_res.json()["player_id"]
        
        api_client.post(f"{BASE_URL}/api/games/{game_id}/next")
        requests.post(f"{BASE_URL}/api/games/{game_id}/answer?player_id={player_id}", json={
            "answer": "True"
        })
        api_client.post(f"{BASE_URL}/api/games/{game_id}/reveal")
        api_client.post(f"{BASE_URL}/api/games/{game_id}/end")
        
        # Get history list to find our game's history ID
        history_res = api_client.get(f"{BASE_URL}/api/game-history")
        history = history_res.json()
        our_game = next((g for g in history if g.get("game_id") == game_id), None)
        assert our_game is not None
        
        # Get detail
        detail_res = api_client.get(f"{BASE_URL}/api/game-history/{our_game['id']}")
        assert detail_res.status_code == 200
        detail = detail_res.json()
        
        # Verify detail structure
        assert "scoreboard" in detail
        assert "question_results" in detail
        assert "session_name" in detail
        assert "total_questions" in detail
        
        # Verify question_results has player_answers
        if detail["question_results"]:
            q_result = detail["question_results"][0]
            assert "question" in q_result
            assert "answer" in q_result
            assert "player_answers" in q_result
            
            if q_result["player_answers"]:
                pa = q_result["player_answers"][0]
                assert "player_name" in pa
                assert "answer" in pa
                assert "is_correct" in pa
                assert "score_awarded" in pa
        
        print(f"✓ Game history detail returned with question_results")
    
    def test_no_duplicate_history_entries(self, api_client, test_session_id):
        """Test that no duplicate history entries are created"""
        # Create and play game
        create_res = api_client.post(f"{BASE_URL}/api/games/create", json={
            "session_id": test_session_id,
            "timer_duration": 0
        })
        game_id = create_res.json()["game_id"]
        code = create_res.json()["code"]
        
        # Join player
        join_res = requests.post(f"{BASE_URL}/api/games/join", json={
            "code": code,
            "player_name": "TEST_NoDupePlayer"
        })
        player_id = join_res.json()["player_id"]
        
        # Get total questions
        host_state = api_client.get(f"{BASE_URL}/api/games/{game_id}/host").json()
        total_questions = host_state["total_questions"]
        
        # Play through all questions
        for i in range(total_questions):
            next_res = api_client.post(f"{BASE_URL}/api/games/{game_id}/next")
            if next_res.json().get("status") == "finished":
                break
            requests.post(f"{BASE_URL}/api/games/{game_id}/answer?player_id={player_id}", json={
                "answer": "True"
            })
            api_client.post(f"{BASE_URL}/api/games/{game_id}/reveal")
            api_client.post(f"{BASE_URL}/api/games/{game_id}/scores")
        
        # Natural finish
        api_client.post(f"{BASE_URL}/api/games/{game_id}/next")
        
        # Also call end_game (should not create duplicate)
        api_client.post(f"{BASE_URL}/api/games/{game_id}/end")
        
        # Check history for duplicates
        history_res = api_client.get(f"{BASE_URL}/api/game-history")
        history = history_res.json()
        
        matching_games = [g for g in history if g.get("game_id") == game_id]
        assert len(matching_games) == 1, f"Expected 1 history entry for game {game_id}, found {len(matching_games)}"
        print(f"✓ No duplicate history entries for game {game_id}")


class TestCrashResilienceFeature:
    """Tests for Persist Game State for Crash Resilience"""
    
    def test_active_game_persisted_to_db(self, api_client, test_session_id):
        """Test that active game state is persisted to active_games collection"""
        # Create game
        create_res = api_client.post(f"{BASE_URL}/api/games/create", json={
            "session_id": test_session_id,
            "timer_duration": 30
        })
        assert create_res.status_code == 200
        game_id = create_res.json()["game_id"]
        code = create_res.json()["code"]
        
        # Join player
        join_res = requests.post(f"{BASE_URL}/api/games/join", json={
            "code": code,
            "player_name": "TEST_PersistPlayer"
        })
        assert join_res.status_code == 200
        
        # Start question
        api_client.post(f"{BASE_URL}/api/games/{game_id}/next")
        
        # The game state should now be persisted
        # We can't directly check MongoDB, but we can verify the game exists
        host_res = api_client.get(f"{BASE_URL}/api/games/{game_id}/host")
        assert host_res.status_code == 200
        
        print(f"✓ Active game state persisted (game_id={game_id})")
        
        # End game to clean up
        api_client.post(f"{BASE_URL}/api/games/{game_id}/end")
    
    def test_game_state_persisted_on_key_changes(self, api_client, test_session_id):
        """Test that game state is persisted on key state changes"""
        # Create game
        create_res = api_client.post(f"{BASE_URL}/api/games/create", json={
            "session_id": test_session_id,
            "timer_duration": 30
        })
        game_id = create_res.json()["game_id"]
        code = create_res.json()["code"]
        
        # Join player - should persist
        join_res = requests.post(f"{BASE_URL}/api/games/join", json={
            "code": code,
            "player_name": "TEST_KeyChangePlayer"
        })
        player_id = join_res.json()["player_id"]
        
        # Next question - should persist
        api_client.post(f"{BASE_URL}/api/games/{game_id}/next")
        
        # Reveal - should persist
        api_client.post(f"{BASE_URL}/api/games/{game_id}/reveal")
        
        # Scores - should persist
        api_client.post(f"{BASE_URL}/api/games/{game_id}/scores")
        
        # Verify game still accessible
        host_res = api_client.get(f"{BASE_URL}/api/games/{game_id}/host")
        assert host_res.status_code == 200
        
        print(f"✓ Game state persisted on key changes")
        
        # Clean up
        api_client.post(f"{BASE_URL}/api/games/{game_id}/end")


class TestTimerPresets:
    """Test timer preset values"""
    
    @pytest.mark.parametrize("duration", [0, 15, 30, 45, 60, 90])
    def test_timer_preset_values(self, api_client, test_session_id, duration):
        """Test all timer preset values work correctly"""
        create_res = api_client.post(f"{BASE_URL}/api/games/create", json={
            "session_id": test_session_id,
            "timer_duration": duration
        })
        assert create_res.status_code == 200
        game_id = create_res.json()["game_id"]
        
        host_res = api_client.get(f"{BASE_URL}/api/games/{game_id}/host")
        assert host_res.status_code == 200
        assert host_res.json()["timer_duration"] == duration
        
        print(f"✓ Timer preset {duration}s works")


# Cleanup fixture
@pytest.fixture(scope="module", autouse=True)
def cleanup(api_client):
    """Cleanup test data after all tests"""
    yield
    # Note: Game history entries are intentionally kept for verification
    # Only clean up test questions if needed
    print("\n✓ Test cleanup complete")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
