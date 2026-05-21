"""
Pruebas de ciclo de vida del LSP (Plan §5.3).

Precondición importante:
- Para validar idle timeout, el servicio debe correr con CONTAINER_IDLE_TIMEOUT=30000
  (30s). El runner solo puede advertir, no imponer esta configuración.
"""

from __future__ import annotations

import os
import time
from urllib.parse import urlencode

import pytest
import requests

from utils.lsp_ws_client import LSPWSClient


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _create_container(lsp_base_url: str, project_id: str, jwt_for_project: str, language: str, max_clients: int) -> dict:
    r = requests.post(
        f"{lsp_base_url}/lsp/{project_id}",
        headers=_auth_headers(jwt_for_project),
        json={"language": language, "max_clients": max_clients},
        timeout=25,
    )
    assert r.status_code == 200, r.text
    return r.json()


def _get_status(lsp_base_url: str, project_id: str, jwt_for_project: str, language: str) -> dict:
    r = requests.get(
        f"{lsp_base_url}/lsp/{project_id}",
        params={"language": language},
        headers=_auth_headers(jwt_for_project),
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(autouse=True)
def _cleanup(lsp_base_url: str, project_id: str, jwt_for_project: str):
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


def test_idle_timeout_destroys_container(lsp_base_url, project_id, jwt_for_project):
    """
    Crea contenedor, conecta WS y luego desconecta.
    Espera a que idle timeout destruya el contenedor (status not_found).
    """
    created = _create_container(lsp_base_url, project_id, jwt_for_project, language="python", max_clients=2)
    ws_url = created["ws_url"]

    client = LSPWSClient(f"{ws_url}?{urlencode({'token': jwt_for_project})}")
    client.connect()
    client.initialize(capabilities={})
    client.close()

    # Esperar hasta 45s (idle 30s + margen) con polling para reducir flakiness.
    deadline = time.time() + 45
    while time.time() < deadline:
        st = _get_status(lsp_base_url, project_id, jwt_for_project, "python")
        if st.get("status") == "not_found":
            return
        time.sleep(2)
    raise AssertionError("El contenedor no fue destruido por idle timeout dentro del tiempo esperado.")


def test_activity_resets_idle_timer(lsp_base_url, project_id, jwt_for_project):
    """
    Mantiene actividad para evitar shutdown por idle: envía didChange periódicamente.
    """
    created = _create_container(lsp_base_url, project_id, jwt_for_project, language="python", max_clients=2)
    ws_url = created["ws_url"]

    uri = "file:///workspace/keepalive.py"
    client = LSPWSClient(f"{ws_url}?{urlencode({'token': jwt_for_project})}")
    client.connect()
    client.initialize(capabilities={})
    client.open_document(uri, "python", "x = 1\n", version=1)

    start = time.time()
    version = 2
    while time.time() - start < 40:
        client.did_change(uri, f"x = {version}\n", version=version)
        version += 1
        time.sleep(10)

    client.close()
    st = _get_status(lsp_base_url, project_id, jwt_for_project, "python")
    assert st.get("status") != "not_found"


def test_max_clients_enforced(lsp_base_url, project_id, jwt_for_project):
    created = _create_container(lsp_base_url, project_id, jwt_for_project, language="python", max_clients=2)
    ws_url = created["ws_url"]
    url = f"{ws_url}?{urlencode({'token': jwt_for_project})}"

    a = LSPWSClient(url)
    b = LSPWSClient(url)
    a.connect()
    b.connect()
    a.initialize(capabilities={})
    b.initialize(capabilities={})

    # Tercer cliente: debe ser rechazado por el multiplexor (idealmente close code 1013).
    rejected = False
    try:
        c = LSPWSClient(url)
        c.connect()
        # Si conectó, al intentar initialize debería cerrarse o responder error.
        c.initialize(capabilities={})
        # Leer algo breve; si el server cierra, este flujo puede no llegar.
        msg = c.wait_for_notification("window/logMessage", timeout=1.0)
        if msg is None:
            # No concluyente; consideramos fallo solo si el socket quedó estable.
            pass
        c.close()
    except Exception as exc:
        rejected = True
        # En muchos casos el cierre 1013 aparece en el mensaje de error.
        assert "1013" in str(exc) or "Maximum clients" in str(exc) or "closed" in str(exc).lower()

    a.close()
    b.close()
    assert rejected, "El tercer cliente no fue rechazado (se esperaba enforcement de max_clients)."


def test_multiplexing_different_files(lsp_base_url, project_id, jwt_for_project):
    created = _create_container(lsp_base_url, project_id, jwt_for_project, language="python", max_clients=4)
    ws_url = created["ws_url"]
    url = f"{ws_url}?{urlencode({'token': jwt_for_project})}"

    a = LSPWSClient(url)
    b = LSPWSClient(url)
    a.connect()
    b.connect()
    a.initialize(capabilities={})
    b.initialize(capabilities={})

    a_uri = "file:///workspace/a.py"
    b_uri = "file:///workspace/b.py"
    a.open_document(a_uri, "python", "def a():\n    return 1\n")
    b.open_document(b_uri, "python", "def b():\n    return 2\n")

    # Esperar diag (puede ser vacío) por cada uri.
    diag_a = a.wait_until(lambda m: isinstance(m, dict) and m.get("method") == "textDocument/publishDiagnostics" and m.get("params", {}).get("uri") == a_uri, timeout=5.0)
    diag_b = b.wait_until(lambda m: isinstance(m, dict) and m.get("method") == "textDocument/publishDiagnostics" and m.get("params", {}).get("uri") == b_uri, timeout=5.0)
    assert diag_a is not None
    assert diag_b is not None

    a.close()
    b.close()


def test_multiplexing_same_file(lsp_base_url, project_id, jwt_for_project):
    created = _create_container(lsp_base_url, project_id, jwt_for_project, language="python", max_clients=4)
    ws_url = created["ws_url"]
    url = f"{ws_url}?{urlencode({'token': jwt_for_project})}"

    a = LSPWSClient(url)
    b = LSPWSClient(url)
    a.connect()
    b.connect()
    a.initialize(capabilities={})
    b.initialize(capabilities={})

    uri = "file:///workspace/main.py"
    a.open_document(uri, "python", "def foo():\n    return 1\n")
    b.open_document(uri, "python", "def foo():\n    return 1\n")

    # A introduce error y se espera que B vea publishDiagnostics para el mismo URI.
    a.did_change(uri, "def foo(:\n    pass\n", version=2)
    diag_b = b.wait_until(
        lambda m: isinstance(m, dict)
        and m.get("method") == "textDocument/publishDiagnostics"
        and m.get("params", {}).get("uri") == uri
        and isinstance(m.get("params", {}).get("diagnostics"), list)
        and len(m.get("params", {}).get("diagnostics")) >= 1,
        timeout=7.0,
    )
    assert diag_b is not None

    a.close()
    b.close()
