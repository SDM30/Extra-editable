"""
Pruebas REST del Servicio de Lenguaje (LSP) según Plan §5.1.

Apunta a `LSP_BASE_URL` (por defecto http://127.0.0.1:8085).
"""

from __future__ import annotations

import requests
import pytest


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(autouse=True)
def _cleanup(lsp_base_url: str, project_id: str, jwt_for_project: str):
    """Limpia contenedores creados por este módulo (best-effort)."""
    yield
    for language in ("python", "cpp", "typescript"):
        try:
            requests.delete(
                f"{lsp_base_url}/lsp/{project_id}",
                params={"language": language},
                headers=_auth_headers(jwt_for_project),
                timeout=10,
            )
        except Exception:
            pass


def _create(lsp_base_url: str, project_id: str, jwt_for_project: str, body: dict) -> dict:
    r = requests.post(
        f"{lsp_base_url}/lsp/{project_id}",
        headers=_auth_headers(jwt_for_project),
        json=body,
        timeout=20,
    )
    return {"status_code": r.status_code, "json": (r.json() if r.content else None), "text": r.text}


def _status(lsp_base_url: str, project_id: str, jwt_for_project: str, language: str) -> requests.Response:
    return requests.get(
        f"{lsp_base_url}/lsp/{project_id}",
        params={"language": language},
        headers=_auth_headers(jwt_for_project),
        timeout=15,
    )


def test_create_container_python(lsp_base_url, project_id, jwt_for_project):
    res = _create(lsp_base_url, project_id, jwt_for_project, {"language": "python", "max_clients": 4})
    assert res["status_code"] == 200, res["text"]
    data = res["json"]
    assert data["ws_url"].startswith("ws://")
    assert data["container_id"]
    assert data.get("host") is not None


def test_create_container_cpp(lsp_base_url, project_id, jwt_for_project):
    res = _create(lsp_base_url, project_id, jwt_for_project, {"language": "cpp"})
    assert res["status_code"] == 200, res["text"]
    data = res["json"]
    assert data["ws_url"].startswith("ws://")


def test_create_container_typescript(lsp_base_url, project_id, jwt_for_project):
    res = _create(lsp_base_url, project_id, jwt_for_project, {"language": "typescript"})
    assert res["status_code"] == 200, res["text"]
    data = res["json"]
    assert data["ws_url"].startswith("ws://")


def test_unsupported_language(lsp_base_url, project_id, jwt_for_project):
    res = _create(lsp_base_url, project_id, jwt_for_project, {"language": "java"})
    assert res["status_code"] == 400


def test_missing_language_defaults_to_python(lsp_base_url, project_id, jwt_for_project):
    """
    Diferencia deliberada vs algunos planes: el servicio permite POST {} y aplica defaults.
    """
    res = _create(lsp_base_url, project_id, jwt_for_project, {})
    assert res["status_code"] == 200, res["text"]
    assert res["json"]["language"] in ("python", None)


def test_get_status(lsp_base_url, project_id, jwt_for_project):
    _create(lsp_base_url, project_id, jwt_for_project, {"language": "python"})
    r = _status(lsp_base_url, project_id, jwt_for_project, "python")
    assert r.status_code == 200
    data = r.json()
    assert data.get("container_id") is not None or data.get("status") in ("created", "running", "ok")


def test_list_all(lsp_base_url, jwt_for_project):
    r = requests.get(f"{lsp_base_url}/lsp/", headers=_auth_headers(jwt_for_project), timeout=15)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_idempotent_create(lsp_base_url, project_id, jwt_for_project):
    a = _create(lsp_base_url, project_id, jwt_for_project, {"language": "python"})
    b = _create(lsp_base_url, project_id, jwt_for_project, {"language": "python"})
    assert a["status_code"] == 200 and b["status_code"] == 200
    assert a["json"]["container_id"] == b["json"]["container_id"]


def test_destroy(lsp_base_url, project_id, jwt_for_project):
    _create(lsp_base_url, project_id, jwt_for_project, {"language": "python"})
    r = requests.delete(
        f"{lsp_base_url}/lsp/{project_id}",
        params={"language": "python"},
        headers=_auth_headers(jwt_for_project),
        timeout=15,
    )
    assert r.status_code == 200

    r2 = _status(lsp_base_url, project_id, jwt_for_project, "python")
    assert r2.status_code == 200
    assert r2.json().get("status") == "not_found"
