"""
Fixtures compartidas para pruebas de integración del Servicio de Lenguaje (LSP).

Contrato (se consume desde `run_lsp_tests.py` o manualmente):
- LSP_BASE_URL: base URL del LSP Load Balancer (default: http://127.0.0.1:8085)
- LSP_TEST_PROJECT: project_id usado por los tests (si no, se genera uno)
- TEST_JWT: token JWT HS256 cuyo claim `room` coincide con el project_id
- JWT_SECRET: secreto HS256 usado para generar TEST_JWT si no se provee
"""

from __future__ import annotations

import os
import sys
import time
import uuid

import pytest


def _get_env(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(name)
    if value is not None and value.strip() == "":
        return default
    return value if value is not None else default


# Asegura que `LSP-Service/tests` esté en sys.path para importar `utils.*`
_TESTS_DIR = os.path.dirname(__file__)
if _TESTS_DIR not in sys.path:
    sys.path.insert(0, _TESTS_DIR)


@pytest.fixture(scope="session")
def lsp_base_url() -> str:
    """Base URL del LSP Load Balancer."""
    return (_get_env("LSP_BASE_URL", "http://127.0.0.1:8085") or "").rstrip("/")


@pytest.fixture(scope="session")
def project_id() -> str:
    """Project ID de prueba; debe coincidir con el claim `room` del JWT."""
    return _get_env("LSP_TEST_PROJECT") or f"test-project-{uuid.uuid4().hex[:10]}"


@pytest.fixture(scope="session")
def jwt_for_project(project_id: str) -> str:
    """
    JWT para autenticación.

    Si TEST_JWT está definido, se usa tal cual. Si no, se genera un token HS256
    con PyJWT usando JWT_SECRET.
    """
    token = _get_env("TEST_JWT")
    if token:
        return token

    try:
        import jwt  # type: ignore
    except Exception as exc:  # pragma: no cover
        raise RuntimeError(
            "No hay TEST_JWT y no se pudo generar un token (falta PyJWT). "
            f"Detalle: {exc}"
        )

    secret = _get_env("JWT_SECRET", "jwt-secreto") or "jwt-secreto"
    now = int(time.time())
    payload = {
        "sub": "tests",
        "username": "tests",
        "room": project_id,
        "iat": now,
        "exp": now + 3600,
    }
    return jwt.encode(payload, secret, algorithm="HS256")


@pytest.fixture(scope="function")
def auth_headers(jwt_for_project: str) -> dict[str, str]:
    """Headers estándar de autenticación para REST."""
    return {
        "Authorization": f"Bearer {jwt_for_project}",
        "Content-Type": "application/json",
    }
