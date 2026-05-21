"""
Cliente WebSocket reutilizable para pruebas LSP (JSON-RPC 2.0).

Este cliente se conecta al multiplexor del contenedor LSP (ws_url retornado por REST)
y permite:
- handshake initialize/initialized
- requests con correlación por `id`
- espera de notificaciones específicas (p.ej. publishDiagnostics)

Dependencias:
- websocket-client
"""

from __future__ import annotations

import json
import threading
import time
from dataclasses import dataclass
from typing import Any, Callable


@dataclass(frozen=True)
class LSPMessage:
    raw: Any

    @property
    def method(self) -> str | None:
        if isinstance(self.raw, dict):
            return self.raw.get("method")
        return None

    @property
    def id(self) -> Any:
        if isinstance(self.raw, dict):
            return self.raw.get("id")
        return None


class LSPWSClient:
    """Cliente LSP para tests con un receptor en background."""

    def __init__(self, url: str, timeout: float = 5.0):
        self.url = url
        self.timeout = timeout
        self._ws = None
        self._messages: list[LSPMessage] = []
        self._lock = threading.Lock()
        self._receiver_thread: threading.Thread | None = None
        self._next_id = 1

    def connect(self) -> None:
        """Conecta el WebSocket y comienza a recibir mensajes."""
        try:
            from websocket import create_connection  # type: ignore
        except Exception as exc:  # pragma: no cover
            raise RuntimeError(f"Falta websocket-client: {exc}")

        self._ws = create_connection(self.url, timeout=self.timeout)
        self._receiver_thread = threading.Thread(target=self._receiver, daemon=True)
        self._receiver_thread.start()

    def close(self) -> None:
        """Cierra el WebSocket."""
        if self._ws is None:
            return
        try:
            self._ws.close()
        except Exception:
            pass

    def _receiver(self) -> None:
        while True:
            try:
                data = self._ws.recv()
            except Exception:
                return
            try:
                msg = json.loads(data)
            except Exception:
                msg = data
            with self._lock:
                self._messages.append(LSPMessage(raw=msg))

    def send(self, payload: dict) -> None:
        if self._ws is None:
            raise RuntimeError("WebSocket no conectado")
        self._ws.send(json.dumps(payload))

    def initialize(self, capabilities: dict | None = None) -> dict | None:
        """
        Ejecuta initialize y luego envía initialized.

        Retorna el `result` del initialize cuando está disponible.
        """
        init_id = self._alloc_id()
        self.send(
            {
                "jsonrpc": "2.0",
                "id": init_id,
                "method": "initialize",
                "params": {"capabilities": capabilities or {}},
            }
        )
        resp = self.wait_for_response(init_id, timeout=self.timeout)
        self.send({"jsonrpc": "2.0", "method": "initialized", "params": {}})
        if isinstance(resp, dict):
            return resp.get("result")
        return None

    def open_document(self, uri: str, language_id: str, text: str, version: int = 1) -> None:
        """Envía textDocument/didOpen."""
        self.send(
            {
                "jsonrpc": "2.0",
                "method": "textDocument/didOpen",
                "params": {
                    "textDocument": {
                        "uri": uri,
                        "languageId": language_id,
                        "version": version,
                        "text": text,
                    }
                },
            }
        )

    def did_change(self, uri: str, text: str, version: int = 2) -> None:
        """Envía textDocument/didChange con reemplazo completo."""
        self.send(
            {
                "jsonrpc": "2.0",
                "method": "textDocument/didChange",
                "params": {
                    "textDocument": {"uri": uri, "version": version},
                    "contentChanges": [{"text": text}],
                },
            }
        )

    def did_close(self, uri: str) -> None:
        """Envía textDocument/didClose."""
        self.send(
            {
                "jsonrpc": "2.0",
                "method": "textDocument/didClose",
                "params": {"textDocument": {"uri": uri}},
            }
        )

    def request(self, method: str, params: dict | None = None) -> tuple[int, dict | None]:
        """Envía request con id y espera response con el mismo id."""
        req_id = self._alloc_id()
        payload: dict[str, Any] = {"jsonrpc": "2.0", "id": req_id, "method": method}
        if params is not None:
            payload["params"] = params
        self.send(payload)
        resp = self.wait_for_response(req_id, timeout=self.timeout)
        if isinstance(resp, dict):
            return req_id, resp
        return req_id, None

    def wait_for_response(self, req_id: int, timeout: float) -> dict | None:
        """Espera response (dict con id=req_id)."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            with self._lock:
                for m in self._messages:
                    if isinstance(m.raw, dict) and m.raw.get("id") == req_id:
                        return m.raw
            time.sleep(0.05)
        return None

    def wait_for_notification(self, method: str, timeout: float = 5.0) -> dict | None:
        """Espera una notificación por método (dict con method=<method> y sin id)."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            with self._lock:
                for m in self._messages:
                    if isinstance(m.raw, dict) and m.raw.get("method") == method and "id" not in m.raw:
                        return m.raw
            time.sleep(0.05)
        return None

    def wait_until(self, predicate: Callable[[Any], bool], timeout: float = 5.0) -> Any | None:
        """Espera hasta que `predicate(message)` retorne True sobre cualquier mensaje recibido."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            with self._lock:
                for m in self._messages:
                    if predicate(m.raw):
                        return m.raw
            time.sleep(0.05)
        return None

    def _alloc_id(self) -> int:
        nid = self._next_id
        self._next_id += 1
        return nid

