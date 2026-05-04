#!/usr/bin/env python3
"""
Cliente LSP Persistente - Reutilizable para pruebas
"""

import json
import time
import signal
import threading
import websocket
from typing import Optional, Callable


class PersistentClient:
    """Cliente LSP que mantiene la conexión viva"""
    
    def __init__(self, url: str, client_id: str, verbose: bool = True):
        self.url = url
        self.client_id = client_id
        self.verbose = verbose
        self.ws: Optional[websocket.WebSocketApp] = None
        self.connected = False
        self.initialized = False
        self.keep_running = True
        self.on_initialized_callback: Optional[Callable] = None
        
    def log(self, message: str, level: str = "INFO"):
        """Log con prefijo del cliente"""
        if self.verbose:
            print(f"[{self.client_id}] {level}: {message}", flush=True)
    
    def on_open(self, ws):
        """Callback cuando se abre la conexión"""
        self.log("CONECTADO", "OK")
        self.connected = True
        
        # Enviar initialize
        ws.send(json.dumps({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "processId": None,
                "rootUri": "file:///workspace",
                "capabilities": {
                    "textDocument": {
                        "completion": {"completionItem": {"snippetSupport": True}}
                    }
                }
            }
        }))
    
    def on_message(self, ws, message):
        """Callback cuando se recibe un mensaje"""
        try:
            data = json.loads(message)
            
            # Respuesta a initialize
            if data.get("id") == 1 and "result" in data:
                self.initialized = True
                self.log("INICIALIZADO", "OK")
                
                # Enviar initialized
                ws.send(json.dumps({
                    "jsonrpc": "2.0",
                    "method": "initialized",
                    "params": {}
                }))
                
                # Ejecutar callback si existe
                if self.on_initialized_callback:
                    self.on_initialized_callback(self)
                    
            # Manejar errores
            elif "error" in data:
                self.log(f"Error: {data['error'].get('message', 'Unknown')}", "ERROR")
                
        except json.JSONDecodeError:
            self.log(f"Respuesta no JSON: {message[:100]}", "WARN")
        except Exception as e:
            self.log(f"Error procesando mensaje: {e}", "ERROR")
    
    def on_error(self, ws, error):
        """Callback cuando ocurre un error"""
        self.log(f"ERROR: {error}", "ERROR")
    
    def on_close(self, ws, status, msg):
        """Callback cuando se cierra la conexión"""
        self.log(f"CERRADO: {msg} (code: {status})", "INFO")
        self.connected = False
        self.keep_running = False
    
    def send_message(self, method: str, params: dict = None, msg_id: int = None):
        """Envía un mensaje JSON-RPC"""
        if not self.ws or not self.connected:
            self.log("No conectado", "WARN")
            return None
        
        if msg_id is None:
            msg_id = int(time.time() * 1000) % 10000
        
        message = {
            "jsonrpc": "2.0",
            "id": msg_id,
            "method": method,
            "params": params or {}
        }
        
        self.ws.send(json.dumps(message))
        return msg_id
    
    def send_notification(self, method: str, params: dict = None):
        """Envía una notificación (sin ID)"""
        if not self.ws or not self.connected:
            return
        
        message = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params or {}
        }
        
        self.ws.send(json.dumps(message))
    
    def heartbeat(self):
        """Mantiene viva la conexión enviando mensajes periódicos"""
        while self.keep_running and self.connected:
            time.sleep(30)
            if self.ws and self.connected:
                try:
                    self.send_message("workspace/symbol", {"query": ""}, 999)
                except Exception as e:
                    self.log(f"Heartbeat fallido: {e}", "WARN")
                    break
    
    def set_on_initialized(self, callback: Callable):
        """Establece un callback para cuando se inicializa el LSP"""
        self.on_initialized_callback = callback
    
    def run(self):
        """Ejecuta el cliente (bloqueante)"""
        self.ws = websocket.WebSocketApp(
            self.url,
            on_open=self.on_open,
            on_message=self.on_message,
            on_error=self.on_error,
            on_close=self.on_close
        )
        
        # Iniciar heartbeat en thread separado
        heartbeat_thread = threading.Thread(target=self.heartbeat, daemon=True)
        heartbeat_thread.start()
        
        # Ejecutar WebSocket (bloqueante)
        self.ws.run_forever()
    
    def stop(self):
        """Detiene el cliente"""
        self.keep_running = False
        if self.ws:
            self.ws.close()


class ConnectionTester:
    """Cliente para probar conexiones (extra/quick)"""
    
    def __init__(self, url: str, timeout: float = 3.0):
        self.url = url
        self.timeout = timeout
        self.ws: Optional[websocket.WebSocket] = None
        
    def test_connection(self) -> dict:
        """
        Prueba una conexión y retorna el resultado
        
        Returns:
            dict: {
                "success": bool,
                "rejected": bool,
                "message": str,
                "error_code": int or None
            }
        """
        result = {
            "success": False,
            "rejected": False,
            "message": "",
            "error_code": None
        }
        
        try:
            self.ws = websocket.WebSocket()
            self.ws.connect(self.url, timeout=self.timeout)
            
            # Enviar initialize
            self.ws.send(json.dumps({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "processId": None,
                    "rootUri": "file:///workspace",
                    "capabilities": {}
                }
            }))
            
            # Esperar respuesta
            self.ws.settimeout(2)
            try:
                response = self.ws.recv()
                
                # Verificar si la respuesta está vacía
                if not response or response.strip() == "":
                    result["rejected"] = True
                    result["message"] = "Conexión cerrada por el servidor (límite alcanzado)"
                    result["error_code"] = 1013
                    return result
                
                # Intentar parsear JSON
                try:
                    data = json.loads(response)
                    
                    if 'error' in data:
                        result["rejected"] = True
                        error_msg = data['error'].get('message', 'Rejected')
                        result["message"] = error_msg
                        result["error_code"] = data['error'].get('code', None)
                    else:
                        result["success"] = True
                        result["message"] = "Connection accepted"
                        
                except json.JSONDecodeError:
                    # Respuesta no JSON - probablemente rechazo
                    result["rejected"] = True
                    result["message"] = f"Respuesta no JSON (rechazo implícito): {response[:50]}"
                    result["error_code"] = 1013
                    
            except websocket.WebSocketTimeoutException:
                result["rejected"] = True
                result["message"] = "Timeout esperando respuesta (límite probable)"
            except Exception as e:
                error_msg = str(e)
                if "Connection closed" in error_msg:
                    result["rejected"] = True
                    result["message"] = "Conexión cerrada por el servidor (límite alcanzado)"
                    result["error_code"] = 1013
                else:
                    result["message"] = error_msg
                
        except Exception as e:
            error_msg = str(e)
            result["message"] = error_msg
            
            # Detectar rechazo por código 1013
            if '1013' in error_msg or 'Maximum clients' in error_msg:
                result["rejected"] = True
                result["message"] = "Maximum clients reached"
                result["error_code"] = 1013
            elif 'refused' in error_msg.lower():
                result["message"] = "Connection refused"
            elif 'timeout' in error_msg.lower():
                result["message"] = "Connection timeout"
            elif 'closed' in error_msg.lower():
                result["rejected"] = True
                result["message"] = "Connection closed by server (limit reached)"
                result["error_code"] = 1013
            elif 'handshake' in error_msg.lower():
                result["rejected"] = True
                result["message"] = "Handshake failed (limit reached)"
                result["error_code"] = 1013
        
        finally:
            if self.ws:
                try:
                    self.ws.close()
                except:
                    pass
        
        return result
    
    def print_result(self, result: dict):
        """Imprime el resultado de forma legible"""
        if result["rejected"]:
            code = f" (code: {result['error_code']})" if result['error_code'] else ""
            print(f"   ✅ RECHAZADA: {result['message']}{code}")
        elif result["success"]:
            print(f"   ❌ ACEPTADA: {result['message']}")
        else:
            print(f"   ⚠️  ERROR: {result['message']}")
    
    def print_result(self, result: dict):
        """Imprime el resultado de forma legible"""
        if result["rejected"]:
            print(f"   ✅ RECHAZADA: {result['message']}")
        elif result["success"]:
            print(f"   ❌ ACEPTADA: {result['message']}")
        else:
            print(f"   ⚠️  ERROR: {result['message']}")