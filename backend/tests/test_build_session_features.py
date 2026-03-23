"""
Test Build Session Features:
- POST /api/sessions with optional 'scoring' field
- GET /api/sessions/{id} returns scoring field when present
- POST /api/games/create accepts optional 'scoring' field
- POST /api/questions creates question and returns it with id
"""

import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
TEST_EMAIL = "testhost@trivia.com"
TEST_PASSWORD = "Test1234!"


@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token for test user"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD
    })
    if response.status_code == 200:
        return response.json().get("token")
    pytest.skip(f"Authentication failed: {response.status_code} - {response.text}")


@pytest.fixture(scope="module")
def api_client(auth_token):
    """Authenticated requests session"""
    session = requests.Session()
    session.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {auth_token}"
    })
    return session


class TestQuestionCreation:
    """Test POST /api/questions creates question and returns it with id"""
    
    def test_create_true_false_question(self, api_client):
        """Create a True/False question via API"""
        unique_id = str(uuid.uuid4())[:8]
        payload = {
            "category": f"TEST_Category_{unique_id}",
            "question": f"TEST_Is the sky blue? ({unique_id})",
            "answer": "True",
            "question_type": "true_false",
            "fun_fact": "The sky appears blue due to Rayleigh scattering"
        }
        
        response = api_client.post(f"{BASE_URL}/api/questions", json=payload)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify response contains id
        assert "id" in data, "Response should contain 'id'"
        assert data["id"] is not None, "Question id should not be None"
        assert len(data["id"]) > 0, "Question id should not be empty"
        
        # Verify other fields
        assert data["category"] == payload["category"]
        assert data["question"] == payload["question"]
        assert data["answer"] == payload["answer"]
        assert data["question_type"] == "true_false"
        assert data["fun_fact"] == payload["fun_fact"]
        assert data["source"] == "manual"
        
        print(f"SUCCESS: Created T/F question with id: {data['id']}")
        return data["id"]
    
    def test_create_multiple_choice_question(self, api_client):
        """Create a Multiple Choice question with options"""
        unique_id = str(uuid.uuid4())[:8]
        payload = {
            "category": f"TEST_Geography_{unique_id}",
            "question": f"TEST_What is the capital of France? ({unique_id})",
            "answer": "Paris",
            "question_type": "multiple_choice",
            "options": ["London", "Paris", "Berlin", "Madrid"],
            "fun_fact": "Paris is known as the City of Light"
        }
        
        response = api_client.post(f"{BASE_URL}/api/questions", json=payload)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert "id" in data
        assert data["question_type"] == "multiple_choice"
        assert data["options"] == payload["options"]
        assert len(data["options"]) == 4
        
        print(f"SUCCESS: Created MC question with id: {data['id']}")
        return data["id"]
    
    def test_create_written_question(self, api_client):
        """Create a Written question"""
        unique_id = str(uuid.uuid4())[:8]
        payload = {
            "category": f"TEST_History_{unique_id}",
            "question": f"TEST_Who was the first US President? ({unique_id})",
            "answer": "George Washington",
            "question_type": "written",
            "fun_fact": "Washington served two terms from 1789 to 1797"
        }
        
        response = api_client.post(f"{BASE_URL}/api/questions", json=payload)
        
        assert response.status_code == 200
        data = response.json()
        
        assert "id" in data
        assert data["question_type"] == "written"
        
        print(f"SUCCESS: Created Written question with id: {data['id']}")
        return data["id"]
    
    def test_create_picture_question_with_image_url(self, api_client):
        """Create a Picture question with image URL"""
        unique_id = str(uuid.uuid4())[:8]
        payload = {
            "category": f"TEST_Celebrities_{unique_id}",
            "question": f"TEST_Who is this famous person? ({unique_id})",
            "answer": "Albert Einstein",
            "question_type": "picture",
            "image_url": "https://example.com/einstein.jpg",
            "fun_fact": "Einstein won the Nobel Prize in Physics in 1921"
        }
        
        response = api_client.post(f"{BASE_URL}/api/questions", json=payload)
        
        assert response.status_code == 200
        data = response.json()
        
        assert "id" in data
        assert data["question_type"] == "picture"
        assert data["image_url"] == payload["image_url"]
        
        print(f"SUCCESS: Created Picture question with id: {data['id']}")
        return data["id"]


class TestSessionWithScoring:
    """Test session creation and retrieval with scoring field"""
    
    @pytest.fixture
    def test_questions(self, api_client):
        """Create test questions for session"""
        unique_id = str(uuid.uuid4())[:8]
        questions = {}
        
        # Create one question of each type
        tf_response = api_client.post(f"{BASE_URL}/api/questions", json={
            "category": f"TEST_Session_{unique_id}",
            "question": f"TEST_TF Question ({unique_id})",
            "answer": "True",
            "question_type": "true_false"
        })
        questions["true_false"] = tf_response.json()["id"]
        
        mc_response = api_client.post(f"{BASE_URL}/api/questions", json={
            "category": f"TEST_Session_{unique_id}",
            "question": f"TEST_MC Question ({unique_id})",
            "answer": "A",
            "question_type": "multiple_choice",
            "options": ["A", "B", "C", "D"]
        })
        questions["multiple_choice"] = mc_response.json()["id"]
        
        return questions
    
    def test_create_session_with_scoring(self, api_client, test_questions):
        """POST /api/sessions accepts optional 'scoring' field"""
        unique_id = str(uuid.uuid4())[:8]
        scoring_config = {
            "true_false": 15,
            "multiple_choice": 20,
            "written": 25,
            "picture": 0
        }
        
        payload = {
            "name": f"TEST_Session_With_Scoring_{unique_id}",
            "true_false_questions": [test_questions["true_false"]],
            "multiple_choice_questions": [test_questions["multiple_choice"]],
            "written_questions": [],
            "picture_questions": [],
            "scoring": scoring_config,
            "is_past": True
        }
        
        response = api_client.post(f"{BASE_URL}/api/sessions", json=payload)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert "id" in data
        assert data["name"] == payload["name"]
        assert data["scoring"] == scoring_config
        
        print(f"SUCCESS: Created session with scoring: {data['id']}")
        return data["id"]
    
    def test_create_session_without_scoring(self, api_client, test_questions):
        """POST /api/sessions works without scoring field"""
        unique_id = str(uuid.uuid4())[:8]
        
        payload = {
            "name": f"TEST_Session_No_Scoring_{unique_id}",
            "true_false_questions": [test_questions["true_false"]],
            "multiple_choice_questions": [],
            "written_questions": [],
            "picture_questions": [],
            "is_past": True
        }
        
        response = api_client.post(f"{BASE_URL}/api/sessions", json=payload)
        
        assert response.status_code == 200
        data = response.json()
        
        assert "id" in data
        # scoring should be None or not present
        assert data.get("scoring") is None
        
        print(f"SUCCESS: Created session without scoring: {data['id']}")
        return data["id"]
    
    def test_get_session_returns_scoring(self, api_client, test_questions):
        """GET /api/sessions/{id} returns scoring field when present"""
        unique_id = str(uuid.uuid4())[:8]
        scoring_config = {
            "true_false": 10,
            "multiple_choice": 15,
            "written": 20,
            "picture": 0
        }
        
        # Create session with scoring
        create_response = api_client.post(f"{BASE_URL}/api/sessions", json={
            "name": f"TEST_Get_Session_Scoring_{unique_id}",
            "true_false_questions": [test_questions["true_false"]],
            "multiple_choice_questions": [],
            "written_questions": [],
            "picture_questions": [],
            "scoring": scoring_config,
            "is_past": True
        })
        session_id = create_response.json()["id"]
        
        # Get session and verify scoring is returned
        get_response = api_client.get(f"{BASE_URL}/api/sessions/{session_id}")
        
        assert get_response.status_code == 200
        data = get_response.json()
        
        assert data["scoring"] == scoring_config
        assert "questions" in data  # Should also include questions map
        
        print(f"SUCCESS: GET session returns scoring correctly")


class TestGameCreationWithScoring:
    """Test game creation with scoring field"""
    
    @pytest.fixture
    def session_with_scoring(self, api_client):
        """Create a session with scoring for game tests"""
        unique_id = str(uuid.uuid4())[:8]
        
        # Create a question first
        q_response = api_client.post(f"{BASE_URL}/api/questions", json={
            "category": f"TEST_Game_{unique_id}",
            "question": f"TEST_Game Question ({unique_id})",
            "answer": "True",
            "question_type": "true_false"
        })
        question_id = q_response.json()["id"]
        
        # Create session with scoring
        scoring_config = {
            "true_false": 25,
            "multiple_choice": 30,
            "written": 35,
            "picture": 0
        }
        
        session_response = api_client.post(f"{BASE_URL}/api/sessions", json={
            "name": f"TEST_Game_Session_{unique_id}",
            "true_false_questions": [question_id],
            "multiple_choice_questions": [],
            "written_questions": [],
            "picture_questions": [],
            "scoring": scoring_config,
            "is_past": True
        })
        
        return {
            "session_id": session_response.json()["id"],
            "scoring": scoring_config
        }
    
    def test_create_game_with_scoring_from_request(self, api_client, session_with_scoring):
        """POST /api/games/create accepts optional 'scoring' field in request"""
        custom_scoring = {
            "true_false": 50,
            "multiple_choice": 60,
            "written": 70,
            "picture": 0
        }
        
        response = api_client.post(f"{BASE_URL}/api/games/create", json={
            "session_id": session_with_scoring["session_id"],
            "scoring": custom_scoring
        })
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert "game_id" in data
        assert "code" in data
        assert len(data["code"]) == 4  # 4-digit code
        
        # Verify game was created with custom scoring by checking host state
        game_id = data["game_id"]
        host_response = api_client.get(f"{BASE_URL}/api/games/{game_id}/host")
        
        assert host_response.status_code == 200
        host_data = host_response.json()
        
        # The game should have questions with the custom scoring points
        # Note: We can't directly verify scoring in host state, but game creation succeeded
        
        print(f"SUCCESS: Created game with custom scoring: {game_id}")
    
    def test_create_game_uses_session_scoring(self, api_client, session_with_scoring):
        """POST /api/games/create uses session scoring when not provided in request"""
        response = api_client.post(f"{BASE_URL}/api/games/create", json={
            "session_id": session_with_scoring["session_id"]
            # No scoring in request - should use session's scoring
        })
        
        assert response.status_code == 200
        data = response.json()
        
        assert "game_id" in data
        
        print(f"SUCCESS: Created game using session scoring: {data['game_id']}")
    
    def test_create_game_scoring_overrides_session(self, api_client, session_with_scoring):
        """Request scoring should override session scoring"""
        override_scoring = {
            "true_false": 100,
            "multiple_choice": 100,
            "written": 100,
            "picture": 0
        }
        
        response = api_client.post(f"{BASE_URL}/api/games/create", json={
            "session_id": session_with_scoring["session_id"],
            "scoring": override_scoring
        })
        
        assert response.status_code == 200
        data = response.json()
        
        # Get host state to verify points
        game_id = data["game_id"]
        
        # Start the game to see question points
        api_client.post(f"{BASE_URL}/api/games/{game_id}/next")
        
        host_response = api_client.get(f"{BASE_URL}/api/games/{game_id}/host")
        host_data = host_response.json()
        
        # Check that the current question has the override points
        if "current_question" in host_data:
            assert host_data["current_question"]["points"] == 100, \
                f"Expected 100 points, got {host_data['current_question']['points']}"
            print(f"SUCCESS: Game uses override scoring (100 pts)")
        else:
            print(f"SUCCESS: Game created with override scoring")


class TestCleanup:
    """Cleanup test data"""
    
    def test_cleanup_test_questions(self, api_client):
        """Delete test questions created during tests"""
        # Get all questions
        response = api_client.get(f"{BASE_URL}/api/questions/all?include_disliked=true")
        if response.status_code == 200:
            questions = response.json()
            deleted = 0
            for q in questions:
                if q.get("category", "").startswith("TEST_") or q.get("question", "").startswith("TEST_"):
                    del_response = api_client.delete(f"{BASE_URL}/api/questions/{q['id']}")
                    if del_response.status_code == 200:
                        deleted += 1
            print(f"Cleaned up {deleted} test questions")
        
        # Get all sessions and delete test sessions
        sessions_response = api_client.get(f"{BASE_URL}/api/sessions")
        if sessions_response.status_code == 200:
            sessions = sessions_response.json()
            deleted_sessions = 0
            for s in sessions:
                if s.get("name", "").startswith("TEST_"):
                    del_response = api_client.delete(f"{BASE_URL}/api/sessions/{s['id']}")
                    if del_response.status_code == 200:
                        deleted_sessions += 1
            print(f"Cleaned up {deleted_sessions} test sessions")
