import json
import threading
import time
from websocket import create_connection, WebSocketTimeoutException


class LSPWSClient:
    def __init__(self, url, headers=None, timeout=5):
        self.url = url
        self.headers = headers or {}
        self.timeout = timeout
        self.ws = None
        self._recv_lock = threading.Lock()

    def connect(self):
        header_list = [f"{k}: {v}" for k, v in (self.headers or {}).items()]
        self.ws = create_connection(self.url, header=header_list, timeout=self.timeout)

    def close(self):
        if self.ws:
            try:
                self.ws.close()
            except Exception:
                pass

    def send(self, obj):
        self.ws.send(json.dumps(obj))

    def recv(self, timeout=None):
        if timeout is None:
            timeout = self.timeout
        self.ws.settimeout(timeout)
        try:
            data = self.ws.recv()
            return json.loads(data)
        except WebSocketTimeoutException:
            return None

    def request(self, method, params=None, id=1):
        msg = {"jsonrpc": "2.0", "id": id, "method": method}
        if params is not None:
            msg["params"] = params
        self.send(msg)
        return self.recv()
"""Lightweight LSP WebSocket test client used by pytest tests.

Depends on `websocket-client` and `json`.
"""
import json
import threading
import time
from websocket import create_connection, WebSocketTimeoutException


class LSPTestClient:
    def __init__(self, url, headers=None, timeout=5):
        self.url = url
        self.headers = headers or {}
        self.timeout = timeout
        self.ws = None
        self._recv_lock = threading.Lock()
        self._messages = []

    def connect(self):
        self.ws = create_connection(self.url, header=[f"{k}: {v}" for k, v in self.headers.items()], timeout=self.timeout)
        thr = threading.Thread(target=self._receiver, daemon=True)
        thr.start()

    def _receiver(self):
        while True:
            try:
                data = self.ws.recv()
            except WebSocketTimeoutException:
                continue
            except Exception:
                break
            try:
                msg = json.loads(data)
            except Exception:
                msg = data
            with self._recv_lock:
                self._messages.append(msg)

    def send(self, payload):
        if isinstance(payload, (dict, list)):
            payload = json.dumps(payload)
        self.ws.send(payload)

    def request(self, method, params=None, id=1):
        payload = {"jsonrpc": "2.0", "id": id, "method": method}
        if params is not None:
            payload["params"] = params
        self.send(payload)
        return id

    def wait_for_notification(self, predicate, timeout=5):
        deadline = time.time() + timeout
        while time.time() < deadline:
            with self._recv_lock:
                for m in list(self._messages):
                    if predicate(m):
                        return m
            time.sleep(0.05)
        raise TimeoutError("timeout waiting for notification")

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass
