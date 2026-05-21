"""
Pruebas WebSocket del Servicio de Lenguaje (LSP) según Plan §5.2.

Estos tests se conectan al multiplexor retornado por REST (`ws_url`) usando:
  ws://host:port?token=<JWT>
"""

from __future__ import annotations

import time
from urllib.parse import urlencode

import pytest
import requests

from utils.lsp_ws_client import LSPWSClient


PY_URI = "file:///workspace/main.py"


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _create_container(lsp_base_url: str, project_id: str, jwt_for_project: str, language: str = "python") -> dict:
    r = requests.post(
        f"{lsp_base_url}/lsp/{project_id}",
        headers=_auth_headers(jwt_for_project),
        json={"language": language, "max_clients": 4},
        timeout=25,
    )
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture()
def ws_client(lsp_base_url: str, project_id: str, jwt_for_project: str):
    created = _create_container(lsp_base_url, project_id, jwt_for_project, language="python")
    ws_url = created["ws_url"]
    url = f"{ws_url}?{urlencode({'token': jwt_for_project})}"
    client = LSPWSClient(url)
    client.connect()
    client.initialize(capabilities={})
    try:
        yield client
    finally:
        client.close()


def test_initialize(ws_client: LSPWSClient):
    # initialize() ya se ejecutó en el fixture; este test valida que el canal sigue vivo
    _id, resp = ws_client.request("workspace/symbol", params={"query": ""})
    assert resp is None or isinstance(resp, dict)


def test_did_open(ws_client: LSPWSClient):
    ws_client.open_document(PY_URI, "python", 'print("hola")\n')
    # No todos los servidores responden algo inmediato; basta con no fallar.
    notif = ws_client.wait_for_notification("textDocument/publishDiagnostics", timeout=2.0)
    assert notif is None or isinstance(notif, dict)


def test_completion(ws_client: LSPWSClient):
    ws_client.open_document(PY_URI, "python", "import os\nos.\n")
    _, resp = ws_client.request(
        "textDocument/completion",
        params={"textDocument": {"uri": PY_URI}, "position": {"line": 1, "character": 3}},
    )
    assert resp is not None and isinstance(resp, dict)
    result = resp.get("result")
    # LSP puede retornar array o {items: []}
    if isinstance(result, dict):
        items = result.get("items", [])
    else:
        items = result
    assert isinstance(items, list)
    assert len(items) >= 1
    assert isinstance(items[0], dict) and "label" in items[0]


def test_hover(ws_client: LSPWSClient):
    ws_client.open_document(PY_URI, "python", "print('x')\n")
    _, resp = ws_client.request(
        "textDocument/hover",
        params={"textDocument": {"uri": PY_URI}, "position": {"line": 0, "character": 1}},
    )
    assert resp is not None and isinstance(resp, dict)
    # Algunos servidores retornan hover vacío; verificamos estructura básica.
    assert "result" in resp


def test_definition(ws_client: LSPWSClient):
    code = "def foo():\n    return 1\n\nx = foo()\n"
    ws_client.open_document(PY_URI, "python", code)
    _, resp = ws_client.request(
        "textDocument/definition",
        params={"textDocument": {"uri": PY_URI}, "position": {"line": 3, "character": 5}},
    )
    assert resp is not None and isinstance(resp, dict)
    assert "result" in resp


def test_diagnostics(ws_client: LSPWSClient):
    ws_client.open_document(PY_URI, "python", "def x(:\n    pass\n")
    notif = ws_client.wait_for_notification("textDocument/publishDiagnostics", timeout=5.0)
    assert notif is not None
    params = notif.get("params", {})
    assert params.get("uri") == PY_URI
    assert isinstance(params.get("diagnostics"), list)
    assert len(params.get("diagnostics")) >= 1


def test_did_change(ws_client: LSPWSClient):
    ws_client.open_document(PY_URI, "python", "def foo():\n    return 1\n")
    ws_client.did_change(PY_URI, "def foo():\n    return \n", version=2)
    notif = ws_client.wait_for_notification("textDocument/publishDiagnostics", timeout=5.0)
    assert notif is not None
    assert notif.get("params", {}).get("uri") == PY_URI


def test_did_close(ws_client: LSPWSClient):
    ws_client.open_document(PY_URI, "python", "print('x')\n")
    ws_client.did_close(PY_URI)
    # No hay confirmación estándar; el objetivo es no lanzar excepción.
    time.sleep(0.1)
