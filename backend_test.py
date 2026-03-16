#!/usr/bin/env python3
"""
Trivia Host App Backend API Testing Suite
Tests all authentication, question management, AI generation, and session building features
"""

import requests
import sys
import json
from datetime import datetime
import time
import random

class TriviaAPITester:
    def __init__(self, base_url="https://trivia-forge-2.preview.emergentagent.com"):
        self.base_url = base_url
        self.api_url = f"{base_url}/api"
        self.token = None
        self.user_data = None
        self.tests_run = 0
        self.tests_passed = 0
        self.test_results = []

    def log_result(self, test_name, success, details="", error=""):
        """Log test result"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {test_name}")
            if details:
                print(f"   {details}")
        else:
            print(f"❌ {test_name}")
            if error:
                print(f"   Error: {error}")
        
        self.test_results.append({
            "test": test_name,
            "success": success,
            "details": details,
            "error": error
        })

    def make_request(self, method, endpoint, data=None, files=None, expected_status=None):
        """Make HTTP request with error handling"""
        url = f"{self.api_url}/{endpoint}"
        headers = {'Content-Type': 'application/json'}
        
        if self.token:
            headers['Authorization'] = f'Bearer {self.token}'
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, timeout=30)
            elif method == 'POST':
                if files:
                    # Remove Content-Type header for file uploads
                    headers.pop('Content-Type', None)
                    response = requests.post(url, files=files, headers=headers, timeout=30)
                else:
                    response = requests.post(url, json=data, headers=headers, timeout=30)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers, timeout=30)
            elif method == 'PATCH':
                response = requests.patch(url, json=data, headers=headers, timeout=30)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers, timeout=30)
            else:
                raise ValueError(f"Unsupported method: {method}")

            if expected_status and response.status_code != expected_status:
                return False, f"Expected {expected_status}, got {response.status_code}: {response.text}"
            
            return True, response
        except Exception as e:
            return False, str(e)

    def test_user_registration(self):
        """Test user registration"""
        timestamp = int(time.time())
        email = f"test_user_{timestamp}@example.com"
        password = "TestPass123!"
        name = f"Test User {timestamp}"

        success, response = self.make_request(
            'POST', 
            'auth/register',
            data={"email": email, "password": password, "name": name},
            expected_status=200
        )

        if success:
            data = response.json()
            if 'token' in data and 'user' in data:
                self.token = data['token']
                self.user_data = data['user']
                self.log_result("User Registration", True, f"Created user: {email}")
                return True
            else:
                self.log_result("User Registration", False, error="Missing token or user data")
        else:
            self.log_result("User Registration", False, error=str(response))
        return False

    def test_user_login(self):
        """Test user login with created credentials"""
        if not self.user_data:
            self.log_result("User Login", False, error="No user data available")
            return False

        # Create a new user to test login
        timestamp = int(time.time())
        email = f"login_test_{timestamp}@example.com"
        password = "LoginTest123!"
        name = f"Login Test {timestamp}"

        # Register user first
        success, response = self.make_request(
            'POST', 
            'auth/register',
            data={"email": email, "password": password, "name": name}
        )

        if not success:
            self.log_result("User Login", False, error="Failed to create user for login test")
            return False

        # Now test login
        success, response = self.make_request(
            'POST',
            'auth/login', 
            data={"email": email, "password": password},
            expected_status=200
        )

        if success:
            data = response.json()
            if 'token' in data and 'user' in data:
                self.log_result("User Login", True, f"Logged in user: {email}")
                return True
            else:
                self.log_result("User Login", False, error="Missing token or user data")
        else:
            self.log_result("User Login", False, error=str(response))
        return False

    def test_auth_me(self):
        """Test getting current user info"""
        if not self.token:
            self.log_result("Auth Me", False, error="No auth token available")
            return False

        success, response = self.make_request('GET', 'auth/me', expected_status=200)
        
        if success:
            data = response.json()
            if 'id' in data and 'email' in data:
                self.log_result("Auth Me", True, f"User ID: {data['id']}")
                return True
            else:
                self.log_result("Auth Me", False, error="Missing user fields")
        else:
            self.log_result("Auth Me", False, error=str(response))
        return False

    def test_dashboard_stats(self):
        """Test dashboard stats endpoint"""
        success, response = self.make_request('GET', 'stats', expected_status=200)
        
        if success:
            data = response.json()
            required_fields = ['total_questions', 'liked_count', 'sessions_count', 'by_type']
            if all(field in data for field in required_fields):
                self.log_result("Dashboard Stats", True, f"Total questions: {data['total_questions']}")
                return True
            else:
                self.log_result("Dashboard Stats", False, error=f"Missing fields: {required_fields}")
        else:
            self.log_result("Dashboard Stats", False, error=str(response))
        return False

    def test_manual_question_creation(self):
        """Test creating manual questions"""
        question_data = {
            "category": "Test Category",
            "question": "What is 2 + 2?",
            "answer": "4",
            "question_type": "multiple_choice",
            "options": ["A. 2", "B. 3", "C. 4", "D. 5"],
            "fun_fact": "Basic arithmetic"
        }

        success, response = self.make_request(
            'POST', 
            'questions', 
            data=question_data,
            expected_status=200
        )
        
        if success:
            data = response.json()
            if 'id' in data and data['question'] == question_data['question']:
                self.log_result("Manual Question Creation", True, f"Created question ID: {data['id']}")
                return data['id']
            else:
                self.log_result("Manual Question Creation", False, error="Invalid response data")
        else:
            self.log_result("Manual Question Creation", False, error=str(response))
        return None

    def test_question_library(self):
        """Test question library retrieval"""
        success, response = self.make_request('GET', 'questions', expected_status=200)
        
        if success:
            data = response.json()
            if isinstance(data, list):
                self.log_result("Question Library", True, f"Found {len(data)} questions")
                return data
            else:
                self.log_result("Question Library", False, error="Response is not a list")
        else:
            self.log_result("Question Library", False, error=str(response))
        return []

    def test_question_like_dislike(self, question_id):
        """Test liking and disliking questions"""
        if not question_id:
            self.log_result("Question Like/Dislike", False, error="No question ID provided")
            return False

        # Test like
        success, response = self.make_request(
            'PATCH', 
            f'questions/{question_id}/like',
            expected_status=200
        )
        
        if not success:
            self.log_result("Question Like", False, error=str(response))
            return False

        # Test dislike
        success, response = self.make_request(
            'PATCH', 
            f'questions/{question_id}/dislike',
            expected_status=200
        )
        
        if success:
            self.log_result("Question Like/Dislike", True, "Successfully liked and disliked question")
            return True
        else:
            self.log_result("Question Dislike", False, error=str(response))
            return False

    def test_ai_category_generation(self):
        """Test AI category generation"""
        success, response = self.make_request(
            'POST', 
            'generate/categories',
            expected_status=200
        )
        
        if success:
            data = response.json()
            if 'categories' in data and isinstance(data['categories'], list):
                categories = data['categories']
                self.log_result("AI Category Generation", True, f"Generated {len(categories)} categories")
                return categories[:3] if categories else []  # Return first 3 for testing
            else:
                self.log_result("AI Category Generation", False, error="Invalid response format")
        else:
            self.log_result("AI Category Generation", False, error=str(response))
        return []

    def test_ai_question_generation(self, categories):
        """Test AI question generation"""
        if not categories:
            self.log_result("AI Question Generation", False, error="No categories available")
            return []

        category = categories[0]  # Use first category
        request_data = {
            "category": category,
            "question_type": "multiple_choice",
            "count": 3
        }

        success, response = self.make_request(
            'POST',
            'generate/questions',
            data=request_data,
            expected_status=200
        )
        
        if success:
            data = response.json()
            if isinstance(data, list) and len(data) > 0:
                self.log_result("AI Question Generation", True, f"Generated {len(data)} questions for '{category}'")
                return data
            else:
                self.log_result("AI Question Generation", False, error="No questions generated")
        else:
            self.log_result("AI Question Generation", False, error=str(response))
        return []

    def test_csv_import(self):
        """Test CSV import functionality"""
        # Create a test CSV content
        csv_content = """Category,Question,Answer,Multiple choice options,Fun Fact,Venue,Date Used
Math,What is 5 + 5?,10,,,Test Import,2024-01-01
Science,Water boils at what temperature?,100°C,,,Test Import,2024-01-01
Geography,What is the capital of France?,Paris,"A. London, B. Berlin, C. Paris, D. Madrid",Paris is known as the City of Light,Test Import,2024-01-01"""

        # Create a temporary file-like object
        files = {'file': ('test_import.csv', csv_content, 'text/csv')}
        
        success, response = self.make_request(
            'POST',
            'import/csv',
            files=files,
            expected_status=200
        )
        
        if success:
            data = response.json()
            if 'imported' in data:
                self.log_result("CSV Import", True, f"Imported {data['imported']} questions")
                return True
            else:
                self.log_result("CSV Import", False, error="Missing import count")
        else:
            self.log_result("CSV Import", False, error=str(response))
        return False

    def test_session_creation(self, questions):
        """Test trivia session creation"""
        if not questions or len(questions) < 2:
            self.log_result("Session Creation", False, error="Need at least 2 questions")
            return None

        session_data = {
            "name": f"Test Session {int(time.time())}",
            "true_false_questions": [],
            "multiple_choice_questions": [q['id'] for q in questions[:2]],  # Use first 2 questions
            "written_questions": [],
            "picture_questions": []
        }

        success, response = self.make_request(
            'POST',
            'sessions',
            data=session_data,
            expected_status=200
        )
        
        if success:
            data = response.json()
            if 'id' in data and 'name' in data:
                self.log_result("Session Creation", True, f"Created session: {data['name']}")
                return data['id']
            else:
                self.log_result("Session Creation", False, error="Invalid session data")
        else:
            self.log_result("Session Creation", False, error=str(response))
        return None

    def test_session_detail(self, session_id):
        """Test session detail retrieval"""
        if not session_id:
            self.log_result("Session Detail", False, error="No session ID provided")
            return False

        success, response = self.make_request(
            'GET',
            f'sessions/{session_id}',
            expected_status=200
        )
        
        if success:
            data = response.json()
            if 'id' in data and 'questions' in data:
                questions_count = len(data.get('questions', {}))
                self.log_result("Session Detail", True, f"Session contains {questions_count} questions")
                return True
            else:
                self.log_result("Session Detail", False, error="Missing session fields")
        else:
            self.log_result("Session Detail", False, error=str(response))
        return False

    def run_all_tests(self):
        """Run complete test suite"""
        print("🚀 Starting Trivia Host App Backend API Testing...")
        print(f"📡 Testing against: {self.api_url}")
        print("=" * 60)

        # Test authentication flow
        if not self.test_user_registration():
            print("❌ Cannot proceed without user registration")
            return False
        
        self.test_user_login()
        self.test_auth_me()
        
        # Test dashboard and basic functionality
        self.test_dashboard_stats()
        
        # Test question management
        question_id = self.test_manual_question_creation()
        questions = self.test_question_library()
        
        if question_id:
            self.test_question_like_dislike(question_id)
        
        # Test AI features (might fail if EMERGENT_LLM_KEY is invalid)
        print("\n🤖 Testing AI Features (might timeout if LLM service is slow)...")
        categories = self.test_ai_category_generation()
        ai_questions = self.test_ai_question_generation(categories)
        
        # Test CSV import
        self.test_csv_import()
        
        # Test session building (use manual questions if AI failed)
        test_questions = ai_questions if ai_questions else questions
        session_id = self.test_session_creation(test_questions)
        
        if session_id:
            self.test_session_detail(session_id)

        # Print summary
        print("\n" + "=" * 60)
        print(f"📊 Test Results: {self.tests_passed}/{self.tests_run} passed")
        success_rate = (self.tests_passed / self.tests_run * 100) if self.tests_run > 0 else 0
        print(f"📈 Success Rate: {success_rate:.1f}%")
        
        if self.tests_passed == self.tests_run:
            print("🎉 All tests passed!")
            return True
        else:
            failed_tests = [t for t in self.test_results if not t['success']]
            print(f"\n❌ {len(failed_tests)} tests failed:")
            for test in failed_tests:
                print(f"  • {test['test']}: {test['error']}")
            return False

def main():
    tester = TriviaAPITester()
    success = tester.run_all_tests()
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())