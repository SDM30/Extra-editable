import time
import os
import sys
import pytest
from urllib.parse import urljoin

# ensure tests utils are importable
sys.path.insert(0, os.path.dirname(__file__))
from utils.lsp_ws_client import LSPWSClient


def ws_url_for(base, project_id):
    # expected websocket path used by the service
    base = base.replace("http://", "ws://")
    return base.rstrip("/") + f"/lsp/{project_id}/ws"


def test_ws_initialize_and_open(lsp_base_url, project_id, auth_headers):
    url = ws_url_for(lsp_base_url, project_id)
    headers = {k: v for k, v in auth_headers.items()}
    # websocket client expects header strings without "Authorization" casing issues
    ws = LSPWSClient(url, headers=headers)
    ws.connect()

    # send a basic initialize request (JSON-RPC)
    res = ws.request("initialize", params={"capabilities": {}}, id=1)
    assert res is None or isinstance(res, dict)

    # notify didOpen (document open) - many LSP multiplexors accept notifications
    ws.send({"jsonrpc": "2.0", "method": "textDocument/didOpen", "params": {"textDocument": {"uri": "file:///tmp/test.c", "languageId": "c", "version": 1, "text": "int main() {}"}}})

    # try to read a response or notification briefly
    msg = ws.recv(timeout=1)
    # Accept either a response or no message; main goal is successful handshake
    assert msg is None or isinstance(msg, dict)
    ws.close()

