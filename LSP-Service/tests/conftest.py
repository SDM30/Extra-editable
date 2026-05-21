import os
import time
import pytest

try:
    import jwt
except Exception:
    jwt = None

import requests


@pytest.fixture(scope="session")
def lsp_base_url():
    return os.environ.get("LSP_BASE_URL", "http://127.0.0.1:8085")


@pytest.fixture(scope="session")
def project_id():
    # default project id used in tests
    return os.environ.get("LSP_TEST_PROJECT", "proj-1")


@pytest.fixture(scope="session")
def jwt_for_project(project_id):
    # Prefer externally-provided token
    token = os.environ.get("TEST_JWT")
    if token:
        return token

    # Try to generate a simple HS256 token if PyJWT available
    secret = os.environ.get("JWT_SECRET", "jwt-secreto")
    if jwt is None:
        raise RuntimeError("No TEST_JWT set and PyJWT not installed to generate tokens")

    payload = {"room": project_id, "iss": "tests", "iat": int(time.time())}
    return jwt.encode(payload, secret, algorithm="HS256")
import os
import sys
import time
import uuid
import jwt
import pytest

# Ensure tests/ directory is on sys.path so test modules can import helpers
tests_dir = os.path.dirname(__file__)
if tests_dir not in sys.path:
    sys.path.insert(0, tests_dir)

ROOT_URL = os.environ.get("LSP_BASE_URL", "http://127.0.0.1:8085")


@pytest.fixture(scope="session")
def lsp_base_url():
    return ROOT_URL


@pytest.fixture(scope="session")
def project_id():
    return f"test-project-{uuid.uuid4().hex[:8]}"


@pytest.fixture(scope="session")
def jwt_for_project(project_id):
    # Prefer externally provided token for real runs
    token = os.environ.get("TEST_JWT")
    if token:
        return token

    # Fallback: generate a HS256 token using JWT_SECRET or default
    secret = os.environ.get("JWT_SECRET", "jwt-secreto")
    payload = {"room": project_id, "iat": int(time.time())}
    return jwt.encode(payload, secret, algorithm="HS256")


@pytest.fixture(scope="function")
def auth_headers(jwt_for_project):
    return {"Authorization": f"Bearer {jwt_for_project}", "Content-Type": "application/json"}
