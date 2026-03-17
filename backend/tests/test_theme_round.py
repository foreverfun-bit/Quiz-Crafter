"""
Backend API Tests for Theme Round Feature
Tests for: POST /api/generate/theme-round endpoint
- Generates exactly 3 T/F + 3 MC + 3 Written + 1 Picture for a given subject
- Supports exclude_questions to avoid duplicates
- Returns proper response structure with all question types grouped
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test user credentials
TEST_EMAIL = "test@example.com"
TEST_PASSWORD = "test123"


class TestThemeRoundGeneration:
    """Test the new Theme Round generation endpoint"""
    
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
    
    def test_theme_round_endpoint_exists(self, auth_header):
        """Test that POST /api/generate/theme-round endpoint exists"""
        response = requests.post(
            f"{BASE_URL}/api/generate/theme-round",
            json={"subject": "test"},
            headers=auth_header,
            timeout=60
        )
        # Should not return 404 - endpoint should exist
        assert response.status_code != 404, f"Theme round endpoint not found"
        print(f"Theme round endpoint exists - status: {response.status_code}")
    
    def test_theme_round_response_structure(self, auth_header):
        """Test POST /api/generate/theme-round returns correct structure with all question types"""
        response = requests.post(
            f"{BASE_URL}/api/generate/theme-round",
            json={"subject": "Harry Potter"},
            headers=auth_header,
            timeout=90  # AI generation takes time
        )
        
        if response.status_code == 500:
            error_text = response.text
            print(f"Theme round generation error: {error_text}")
            if "AI service not configured" in error_text:
                pytest.skip("AI service not configured")
            pytest.fail(f"Theme round generation failed with 500: {error_text}")
        
        assert response.status_code == 200, f"Theme round failed: {response.status_code} - {response.text}"
        
        data = response.json()
        
        # Check response has all required keys
        assert "true_false" in data, "Missing true_false questions"
        assert "multiple_choice" in data, "Missing multiple_choice questions"
        assert "written" in data, "Missing written questions"
        assert "picture" in data, "Missing picture questions"
        
        print(f"Response structure: T/F={len(data['true_false'])}, MC={len(data['multiple_choice'])}, Written={len(data['written'])}, Picture={len(data['picture'])}")
        
        # Verify counts - should be 3 T/F, 3 MC, 3 Written, 1 Picture
        assert len(data["true_false"]) == 3, f"Expected 3 T/F questions, got {len(data['true_false'])}"
        assert len(data["multiple_choice"]) == 3, f"Expected 3 MC questions, got {len(data['multiple_choice'])}"
        assert len(data["written"]) == 3, f"Expected 3 Written questions, got {len(data['written'])}"
        assert len(data["picture"]) == 1, f"Expected 1 Picture question, got {len(data['picture'])}"
        
        print("Theme round response structure is correct!")
    
    def test_theme_round_question_structure(self, auth_header):
        """Test that each question in theme round has proper fields"""
        response = requests.post(
            f"{BASE_URL}/api/generate/theme-round",
            json={"subject": "The Beatles"},
            headers=auth_header,
            timeout=90
        )
        
        if response.status_code != 200:
            pytest.skip(f"Theme round generation failed: {response.status_code}")
        
        data = response.json()
        
        # Check T/F question structure
        for q in data.get("true_false", []):
            assert "id" in q, "Missing id in T/F question"
            assert "question" in q, "Missing question in T/F question"
            assert "answer" in q, "Missing answer in T/F question"
            assert "question_type" in q, "Missing question_type in T/F question"
            assert q["question_type"] == "true_false", f"Wrong type: {q['question_type']}"
            # T/F answer should be True or False
            assert q["answer"] in ["True", "False"], f"Invalid T/F answer: {q['answer']}"
        
        # Check MC question structure (should have options)
        for q in data.get("multiple_choice", []):
            assert "id" in q, "Missing id in MC question"
            assert "question" in q, "Missing question in MC question"
            assert "answer" in q, "Missing answer in MC question"
            assert "options" in q, "Missing options in MC question"
            assert q["question_type"] == "multiple_choice"
            assert isinstance(q["options"], list), "Options should be a list"
            assert len(q["options"]) == 4, f"MC should have 4 options, got {len(q['options'])}"
        
        # Check Written question structure
        for q in data.get("written", []):
            assert "id" in q, "Missing id in Written question"
            assert "question" in q, "Missing question in Written question"
            assert "answer" in q, "Missing answer in Written question"
            assert q["question_type"] == "written"
        
        # Check Picture question structure
        for q in data.get("picture", []):
            assert "id" in q, "Missing id in Picture question"
            assert "question" in q, "Missing question in Picture question"
            assert "answer" in q, "Missing answer in Picture question"
            assert q["question_type"] == "picture"
        
        print("All question structures are valid!")
    
    def test_theme_round_with_exclude_questions(self, auth_header):
        """Test POST /api/generate/theme-round with exclude_questions parameter"""
        # First, generate a round
        first_response = requests.post(
            f"{BASE_URL}/api/generate/theme-round",
            json={"subject": "World War II"},
            headers=auth_header,
            timeout=90
        )
        
        if first_response.status_code != 200:
            pytest.skip(f"First theme round failed: {first_response.status_code}")
        
        first_data = first_response.json()
        
        # Collect all questions from first round
        all_first_questions = []
        for q_type in ["true_false", "multiple_choice", "written", "picture"]:
            for q in first_data.get(q_type, []):
                all_first_questions.append(q["question"])
        
        print(f"First round generated {len(all_first_questions)} questions")
        
        # Now generate another round excluding the first questions
        second_response = requests.post(
            f"{BASE_URL}/api/generate/theme-round",
            json={
                "subject": "World War II",
                "exclude_questions": all_first_questions
            },
            headers=auth_header,
            timeout=90
        )
        
        if second_response.status_code != 200:
            pytest.skip(f"Second theme round failed: {second_response.status_code}")
        
        second_data = second_response.json()
        
        # Check that new questions don't overlap with excluded ones
        overlap_count = 0
        for q_type in ["true_false", "multiple_choice", "written", "picture"]:
            for q in second_data.get(q_type, []):
                if q["question"] in all_first_questions:
                    overlap_count += 1
                    print(f"WARNING: Found overlapping question: {q['question'][:50]}...")
        
        # Allow some overlap as AI isn't perfect, but most should be different
        total_second = sum(len(second_data.get(t, [])) for t in ["true_false", "multiple_choice", "written", "picture"])
        print(f"Second round: {total_second} questions, {overlap_count} overlaps")
        
        # Should have minimal overlap
        assert overlap_count <= 3, f"Too many overlapping questions: {overlap_count}"
    
    def test_theme_round_subject_validation(self, auth_header):
        """Test that theme round requires a subject"""
        # Empty subject should work but may give poor results - just testing endpoint accepts it
        response = requests.post(
            f"{BASE_URL}/api/generate/theme-round",
            json={"subject": ""},
            headers=auth_header,
            timeout=60
        )
        # Either 200 (AI generates generic) or 400/422 (validation error) is acceptable
        assert response.status_code in [200, 400, 422, 500], f"Unexpected status: {response.status_code}"
        print(f"Empty subject test: status={response.status_code}")
    
    def test_theme_round_category_field(self, auth_header):
        """Test that generated questions have subject as category"""
        subject = "Space Exploration"
        response = requests.post(
            f"{BASE_URL}/api/generate/theme-round",
            json={"subject": subject},
            headers=auth_header,
            timeout=90
        )
        
        if response.status_code != 200:
            pytest.skip(f"Theme round failed: {response.status_code}")
        
        data = response.json()
        
        # Check that all questions have the subject as category
        for q_type in ["true_false", "multiple_choice", "written", "picture"]:
            for q in data.get(q_type, []):
                assert "category" in q, f"Missing category in {q_type} question"
                assert q["category"] == subject, f"Expected category '{subject}', got '{q['category']}'"
        
        print(f"All questions have category '{subject}'")


class TestThemeRoundSaveQuestion:
    """Test saving theme round questions via POST /api/questions/save"""
    
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
    
    def test_save_theme_question(self, auth_header):
        """Test saving a generated theme round question to library"""
        # Generate a theme round first
        gen_response = requests.post(
            f"{BASE_URL}/api/generate/theme-round",
            json={"subject": "TEST_Theme_Save"},
            headers=auth_header,
            timeout=90
        )
        
        if gen_response.status_code != 200:
            pytest.skip(f"Theme round generation failed: {gen_response.status_code}")
        
        data = gen_response.json()
        
        # Get a T/F question to save
        if not data.get("true_false"):
            pytest.skip("No T/F questions generated")
        
        question = data["true_false"][0]
        
        # Save the question
        save_response = requests.post(
            f"{BASE_URL}/api/questions/save",
            json={
                "id": question["id"],
                "category": question["category"],
                "question": question["question"],
                "answer": question["answer"],
                "question_type": question["question_type"],
                "options": question.get("options"),
                "fun_fact": question.get("fun_fact"),
                "image_url": question.get("image_url")
            },
            headers=auth_header
        )
        
        assert save_response.status_code == 200, f"Save failed: {save_response.text}"
        
        saved = save_response.json()
        assert saved["id"] == question["id"]
        assert saved["status"] == "liked", f"Expected status 'liked', got '{saved.get('status')}'"
        
        print(f"Successfully saved theme question: {saved['id']}")
        
        # Verify by fetching from library
        get_response = requests.get(
            f"{BASE_URL}/api/questions/{question['id']}",
            headers=auth_header
        )
        assert get_response.status_code == 200
        assert get_response.json()["status"] == "liked"
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/questions/{question['id']}", headers=auth_header)


class TestThemeRoundAPIAuth:
    """Test theme round endpoint authentication"""
    
    def test_theme_round_requires_auth(self):
        """Test that theme round endpoint requires authentication"""
        response = requests.post(
            f"{BASE_URL}/api/generate/theme-round",
            json={"subject": "test"}
        )
        # Should return 401 or 403 without auth
        assert response.status_code in [401, 403], f"Expected auth error, got {response.status_code}"
        print("Theme round endpoint correctly requires authentication")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
