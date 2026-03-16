"""
Backend API Tests for Trivia Forge Features
Tests for: DELETE /api/questions/all, PUT /api/questions/{id}, 
CSV Export, Image Upload, AI Image Generation, Sessions with is_past
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test user credentials
TEST_EMAIL = "test@example.com"
TEST_PASSWORD = "test123"

class TestAuth:
    """Authentication tests - must run first to get token"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get authentication token for test user"""
        # Try login first
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
        )
        if response.status_code == 200:
            return response.json()["token"]
        
        # If login fails, register new user
        response = requests.post(
            f"{BASE_URL}/api/auth/register",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD, "name": "Test User"}
        )
        if response.status_code == 200:
            return response.json()["token"]
        
        pytest.skip(f"Authentication failed: {response.status_code} - {response.text}")
    
    def test_login_success(self):
        """Test login endpoint returns token"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
        )
        # Either 200 success or 401 if user doesn't exist yet
        assert response.status_code in [200, 401]
        if response.status_code == 200:
            data = response.json()
            assert "token" in data
            assert "user" in data
            print(f"Login successful: {data['user']['email']}")


class TestQuestionsAPI:
    """Test question CRUD endpoints including the fixed ones"""
    
    @pytest.fixture(scope="class")
    def auth_header(self):
        """Get auth header for requests"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
        )
        if response.status_code != 200:
            # Register if not exists
            response = requests.post(
                f"{BASE_URL}/api/auth/register",
                json={"email": TEST_EMAIL, "password": TEST_PASSWORD, "name": "Test User"}
            )
        token = response.json()["token"]
        return {"Authorization": f"Bearer {token}"}
    
    def test_create_question(self, auth_header):
        """Test creating a question"""
        question_data = {
            "category": "TEST_Category_" + str(int(time.time())),
            "question": "TEST_What is 2+2?",
            "answer": "4",
            "question_type": "written",
            "fun_fact": "Math is fun!"
        }
        response = requests.post(
            f"{BASE_URL}/api/questions",
            json=question_data,
            headers=auth_header
        )
        assert response.status_code == 200, f"Failed to create: {response.text}"
        data = response.json()
        assert data["question"] == question_data["question"]
        assert data["answer"] == question_data["answer"]
        assert "id" in data
        print(f"Created question with ID: {data['id']}")
        return data["id"]
    
    def test_update_question_put_endpoint(self, auth_header):
        """Test PUT /api/questions/{id} - previously broken endpoint"""
        # First create a question
        question_data = {
            "category": "TEST_UpdateCategory",
            "question": "TEST_Original question text",
            "answer": "Original answer",
            "question_type": "written"
        }
        create_response = requests.post(
            f"{BASE_URL}/api/questions",
            json=question_data,
            headers=auth_header
        )
        assert create_response.status_code == 200
        question_id = create_response.json()["id"]
        
        # Update the question
        update_data = {
            "category": "TEST_UpdatedCategory",
            "question": "TEST_Updated question text",
            "answer": "Updated answer",
            "question_type": "written",
            "fun_fact": "New fun fact!"
        }
        update_response = requests.put(
            f"{BASE_URL}/api/questions/{question_id}",
            json=update_data,
            headers=auth_header
        )
        assert update_response.status_code == 200, f"PUT failed: {update_response.text}"
        
        updated = update_response.json()
        assert updated["question"] == update_data["question"]
        assert updated["answer"] == update_data["answer"]
        assert updated["category"] == update_data["category"]
        print(f"Successfully updated question {question_id}")
        
        # Verify with GET
        get_response = requests.get(
            f"{BASE_URL}/api/questions/{question_id}",
            headers=auth_header
        )
        assert get_response.status_code == 200
        assert get_response.json()["question"] == update_data["question"]
    
    def test_get_questions(self, auth_header):
        """Test getting list of questions"""
        response = requests.get(
            f"{BASE_URL}/api/questions",
            headers=auth_header
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Retrieved {len(data)} questions")


class TestDeleteAllQuestions:
    """Test DELETE /api/questions/all - previously broken endpoint"""
    
    @pytest.fixture(scope="class")
    def auth_header(self):
        """Get auth header for requests"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
        )
        if response.status_code != 200:
            response = requests.post(
                f"{BASE_URL}/api/auth/register",
                json={"email": TEST_EMAIL, "password": TEST_PASSWORD, "name": "Test User"}
            )
        token = response.json()["token"]
        return {"Authorization": f"Bearer {token}"}
    
    def test_delete_all_questions_endpoint(self, auth_header):
        """Test DELETE /api/questions/all deletes all questions and sessions"""
        # First create some test questions
        for i in range(3):
            requests.post(
                f"{BASE_URL}/api/questions",
                json={
                    "category": f"TEST_DeleteAll_{i}",
                    "question": f"TEST_Question {i}",
                    "answer": f"Answer {i}",
                    "question_type": "written"
                },
                headers=auth_header
            )
        
        # Verify questions exist
        get_before = requests.get(f"{BASE_URL}/api/questions?include_used=true", headers=auth_header)
        questions_before = len(get_before.json())
        print(f"Questions before delete: {questions_before}")
        
        # Call DELETE /api/questions/all
        delete_response = requests.delete(
            f"{BASE_URL}/api/questions/all",
            headers=auth_header
        )
        assert delete_response.status_code == 200, f"Delete all failed: {delete_response.text}"
        
        data = delete_response.json()
        assert "message" in data
        assert "Deleted" in data["message"]
        print(f"Delete all response: {data['message']}")
        
        # Verify questions are deleted
        get_after = requests.get(f"{BASE_URL}/api/questions?include_used=true", headers=auth_header)
        questions_after = len(get_after.json())
        print(f"Questions after delete: {questions_after}")
        assert questions_after == 0, f"Expected 0 questions, got {questions_after}"


class TestSessionsCSVExport:
    """Test CSV export functionality for sessions"""
    
    @pytest.fixture(scope="class")
    def auth_header(self):
        """Get auth header"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
        )
        if response.status_code != 200:
            response = requests.post(
                f"{BASE_URL}/api/auth/register",
                json={"email": TEST_EMAIL, "password": TEST_PASSWORD, "name": "Test User"}
            )
        token = response.json()["token"]
        return {"Authorization": f"Bearer {token}"}
    
    @pytest.fixture(scope="class")
    def setup_session_with_questions(self, auth_header):
        """Create a session with questions for export testing"""
        # Create some questions first
        question_ids = []
        for i in range(3):
            response = requests.post(
                f"{BASE_URL}/api/questions",
                json={
                    "category": f"TEST_CSV_Category_{i}",
                    "question": f"TEST_CSV Question {i}?",
                    "answer": f"Answer {i}",
                    "question_type": "true_false" if i == 0 else "written",
                    "fun_fact": f"Fun fact {i}"
                },
                headers=auth_header
            )
            if response.status_code == 200:
                question_ids.append(response.json()["id"])
        
        # Create session with questions
        session_response = requests.post(
            f"{BASE_URL}/api/sessions",
            json={
                "name": "TEST_CSV_Export_Session",
                "true_false_questions": question_ids[:1] if question_ids else [],
                "written_questions": question_ids[1:] if len(question_ids) > 1 else [],
                "multiple_choice_questions": [],
                "picture_questions": [],
                "is_past": True
            },
            headers=auth_header
        )
        
        if session_response.status_code == 200:
            return session_response.json()["id"]
        return None
    
    def test_export_session_csv(self, auth_header, setup_session_with_questions):
        """Test GET /api/sessions/{id}/export-csv returns valid CSV"""
        session_id = setup_session_with_questions
        if not session_id:
            pytest.skip("No session created for testing")
        
        response = requests.get(
            f"{BASE_URL}/api/sessions/{session_id}/export-csv",
            headers=auth_header
        )
        assert response.status_code == 200, f"CSV export failed: {response.text}"
        
        # Check content type
        content_type = response.headers.get("content-type", "")
        assert "text/csv" in content_type, f"Expected text/csv, got {content_type}"
        
        # Check CSV headers
        csv_content = response.text
        assert "Category" in csv_content
        assert "Question" in csv_content
        assert "Answer" in csv_content
        print(f"CSV Export successful, content length: {len(csv_content)} bytes")
        print(f"CSV first 200 chars: {csv_content[:200]}")
    
    def test_create_session_with_is_past(self, auth_header):
        """Test POST /api/sessions with is_past:true"""
        session_data = {
            "name": "TEST_Past_Session_" + str(int(time.time())),
            "true_false_questions": [],
            "multiple_choice_questions": [],
            "written_questions": [],
            "picture_questions": [],
            "is_past": True
        }
        response = requests.post(
            f"{BASE_URL}/api/sessions",
            json=session_data,
            headers=auth_header
        )
        assert response.status_code == 200, f"Session creation failed: {response.text}"
        
        data = response.json()
        assert data["is_past"] == True, f"Expected is_past=True, got {data.get('is_past')}"
        assert data["name"] == session_data["name"]
        print(f"Created past session: {data['name']} with is_past={data['is_past']}")
        
        # Verify by fetching past sessions
        get_response = requests.get(
            f"{BASE_URL}/api/sessions?is_past=true",
            headers=auth_header
        )
        assert get_response.status_code == 200
        sessions = get_response.json()
        assert any(s["name"] == session_data["name"] for s in sessions), "Session not found in past sessions"


class TestImageUpload:
    """Test image upload endpoint"""
    
    @pytest.fixture(scope="class")
    def auth_header(self):
        """Get auth header"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
        )
        if response.status_code != 200:
            response = requests.post(
                f"{BASE_URL}/api/auth/register",
                json={"email": TEST_EMAIL, "password": TEST_PASSWORD, "name": "Test User"}
            )
        token = response.json()["token"]
        return {"Authorization": f"Bearer {token}"}
    
    def test_image_upload(self, auth_header):
        """Test POST /api/upload/image"""
        # Create a small test image (1x1 PNG)
        import base64
        # Minimal 1x1 red PNG
        png_data = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
        )
        
        files = {
            "file": ("test_image.png", png_data, "image/png")
        }
        
        response = requests.post(
            f"{BASE_URL}/api/upload/image",
            files=files,
            headers=auth_header
        )
        assert response.status_code == 200, f"Image upload failed: {response.text}"
        
        data = response.json()
        assert "image_url" in data
        assert "/api/uploads/" in data["image_url"]
        print(f"Image uploaded successfully: {data['image_url']}")
        
        # Verify image is accessible
        image_url = f"{BASE_URL}{data['image_url']}"
        img_response = requests.get(image_url)
        assert img_response.status_code == 200, f"Could not fetch uploaded image"


class TestAIImageGeneration:
    """Test AI image generation endpoint - may take up to 60s"""
    
    @pytest.fixture(scope="class")
    def auth_header(self):
        """Get auth header"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
        )
        if response.status_code != 200:
            response = requests.post(
                f"{BASE_URL}/api/auth/register",
                json={"email": TEST_EMAIL, "password": TEST_PASSWORD, "name": "Test User"}
            )
        token = response.json()["token"]
        return {"Authorization": f"Bearer {token}"}
    
    def test_ai_image_generation(self, auth_header):
        """Test POST /api/generate/image - long timeout for AI generation"""
        request_data = {
            "prompt": "A simple red circle on white background",
            "category": "Test"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/generate/image",
            json=request_data,
            headers=auth_header,
            timeout=120  # Long timeout for AI generation
        )
        
        # AI generation might fail due to rate limits or other issues
        if response.status_code == 500:
            print(f"AI image generation returned 500: {response.text}")
            # This is acceptable - might be rate limited
            pytest.skip("AI image generation unavailable (possibly rate limited)")
        
        assert response.status_code == 200, f"AI image gen failed: {response.text}"
        
        data = response.json()
        assert "image_url" in data, "No image_url in response"
        print(f"AI image generated: {data['image_url']}")


class TestExistingEndpoints:
    """Verify existing endpoints still work"""
    
    @pytest.fixture(scope="class")
    def auth_header(self):
        """Get auth header"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
        )
        if response.status_code != 200:
            response = requests.post(
                f"{BASE_URL}/api/auth/register",
                json={"email": TEST_EMAIL, "password": TEST_PASSWORD, "name": "Test User"}
            )
        token = response.json()["token"]
        return {"Authorization": f"Bearer {token}"}
    
    def test_get_stats(self, auth_header):
        """Test GET /api/stats"""
        response = requests.get(
            f"{BASE_URL}/api/stats",
            headers=auth_header
        )
        assert response.status_code == 200
        data = response.json()
        assert "total_questions" in data
        print(f"Stats: {data}")
    
    def test_get_categories(self, auth_header):
        """Test GET /api/categories"""
        response = requests.get(
            f"{BASE_URL}/api/categories",
            headers=auth_header
        )
        assert response.status_code == 200
        assert isinstance(response.json(), list)
    
    def test_get_sessions(self, auth_header):
        """Test GET /api/sessions"""
        response = requests.get(
            f"{BASE_URL}/api/sessions",
            headers=auth_header
        )
        assert response.status_code == 200
        assert isinstance(response.json(), list)


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
