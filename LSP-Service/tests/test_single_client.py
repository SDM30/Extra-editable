#!/usr/bin/env python3
"""
Cliente WebSocket para pruebas LSP - Versión simplificada y funcional
"""

import json
import websocket
import threading
import time
import sys

class LSPClient:
    def __init__(self, url):
        self.url = url
        self.ws = None
        self.message_id = 1
        self.initialized = False
        self.running = True
        
    def send_message(self, method, params=None, msg_id=None):
        """Envía un mensaje JSON-RPC"""
        if msg_id is None:
            msg_id = self.message_id
            self.message_id += 1
        
        message = {
            "jsonrpc": "2.0",
            "id": msg_id,
            "method": method,
            "params": params or {}
        }
        
        print(f"\n📤 {method}")
        self.ws.send(json.dumps(message))
        return msg_id
    
    def send_notification(self, method, params=None):
        """Envía una notificación"""
        message = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params or {}
        }
        self.ws.send(json.dumps(message))
    
    def on_message(self, ws, message):
        """Maneja mensajes recibidos"""
        try:
            data = json.loads(message)
            
            # Respuesta a un request
            if "id" in data:
                if "result" in data:
                    result = data["result"]
                    # Mostrar resumen según el tipo
                    if "capabilities" in result:
                        print(f"📥 Response {data['id']}: ✅ Capacidades LSP")
                    elif "items" in result:
                        items = result.get("items", [])
                        print(f"📥 Response {data['id']}: {len(items)} sugerencias")
                        if items:
                            labels = [i["label"] for i in items[:5]]
                            print(f"   📝 {', '.join(labels)}")
                    elif "contents" in result:
                        print(f"📥 Response {data['id']}: 📖 Hover recibido")
                    elif isinstance(result, (list, dict)):
                        print(f"📥 Response {data['id']}: 📍 Definición")
                elif "error" in data:
                    print(f"📥 Response {data['id']}: ❌ {data['error'].get('message', 'Error')}")
            
            # Notificación
            elif "method" in data:
                method = data["method"]
                if "publishDiagnostics" in method:
                    diags = data.get("params", {}).get("diagnostics", [])
                    if diags:
                        print(f"📥 {method}: ⚠️  {len(diags)} problemas")
                elif "window/logMessage" in method:
                    msg = data.get("params", {}).get("message", "")
                    print(f"📥 {method}: {msg}")
                else:
                    print(f"📥 {method}")
            
            # Marcar inicializado
            if data.get("id") == 1 and "result" in data:
                self.initialized = True
                print("✅ LSP inicializado!")
                
        except Exception as e:
            print(f"❌ Error: {e}")
    
    def on_error(self, ws, error):
        print(f"❌ WebSocket error: {error}")
    
    def on_close(self, ws, status, msg):
        print(f"\n🔌 Desconectado: {status} - {msg}")
        self.running = False
    
    def on_open(self, ws):
        print("✅ Conectado!\n")
        print("="*50)
        print("COMANDOS DISPONIBLES:")
        print("="*50)
        print("  1 - Inicializar LSP")
        print("  2 - Probar autocompletado básico")
        print("  3 - Probar autocompletado en clase")
        print("  4 - Probar hover")
        print("  5 - Probar definición")
        print("  6 - Probar código complejo")
        print("  7 - Ejecutar TODAS las pruebas")
        print("  8 - Probar posición inválida (-32602)")
        print("  q - Salir")
        print("  raw - Modo JSON manual")
        print("="*50)
    
    def initialize(self):
        """Inicializa el LSP"""
        print("\n🔧 Inicializando LSP...")
        self.send_message("initialize", {
            "processId": None,
            "rootUri": "file:///workspace",
            "capabilities": {
                "textDocument": {
                    "completion": {"completionItem": {"snippetSupport": True}},
                    "hover": {"contentFormat": ["markdown", "plaintext"]},
                    "definition": {"linkSupport": True}
                }
            }
        })
        time.sleep(1)
        self.send_notification("initialized", {})
        time.sleep(0.5)
    
    def test_completion(self):
        """Prueba autocompletado básico"""
        if not self.initialized:
            print("⚠️  Primero inicializa el LSP (comando 1)")
            return
        
        print("\n🧪 Probando autocompletado básico...")
        
        # Abrir documento
        self.send_notification("textDocument/didOpen", {
            "textDocument": {
                "uri": "file:///workspace/test.py",
                "languageId": "python",
                "version": 1,
                "text": "import os\nos.path."
            }
        })
        
        time.sleep(0.5)
        
        # Solicitar completions
        self.send_message("textDocument/completion", {
            "textDocument": {"uri": "file:///workspace/test.py"},
            "position": {"line": 1, "character": 8}
        })
    
    def test_class_completion(self):
        """Prueba autocompletado en clases"""
        if not self.initialized:
            print("⚠️  Primero inicializa el LSP (comando 1)")
            return
        
        print("\n🧪 Probando autocompletado en clases...")
        
        code = '''class Calculator:
    def __init__(self):
        self.value = 0
    def add(self, a, b):
        return a + b
    def get_value(self):
        return self.value

calc = Calculator()
calc.'''

        last_line_index = len(code.splitlines()) - 1
        last_line_text = code.splitlines()[-1]
        completion_character = len(last_line_text)
        
        self.send_notification("textDocument/didOpen", {
            "textDocument": {
                "uri": "file:///workspace/class_test.py",
                "languageId": "python",
                "version": 1,
                "text": code
            }
        })
        
        time.sleep(0.5)
        
        self.send_message("textDocument/completion", {
            "textDocument": {"uri": "file:///workspace/class_test.py"},
            "position": {"line": last_line_index, "character": completion_character}
        })
    
    def test_hover(self):
        """Prueba hover"""
        if not self.initialized:
            print("⚠️  Primero inicializa el LSP (comando 1)")
            return
        
        print("\n🧪 Probando hover...")
        
        code = '''def greet(name: str) -> str:
    """Saluda a una persona"""
    return f"Hello, {name}!"

greet("World")'''
        
        self.send_notification("textDocument/didOpen", {
            "textDocument": {
                "uri": "file:///workspace/hover_test.py",
                "languageId": "python",
                "version": 1,
                "text": code
            }
        })
        
        time.sleep(0.5)
        
        self.send_message("textDocument/hover", {
            "textDocument": {"uri": "file:///workspace/hover_test.py"},
            "position": {"line": 4, "character": 1}
        })
    
    def test_definition(self):
        """Prueba ir a definición"""
        if not self.initialized:
            print("⚠️  Primero inicializa el LSP (comando 1)")
            return
        
        print("\n🧪 Probando ir a definición...")
        
        code = '''def calculate(x, y):
    return x + y

result = calculate(10, 20)'''
        
        self.send_notification("textDocument/didOpen", {
            "textDocument": {
                "uri": "file:///workspace/def_test.py",
                "languageId": "python",
                "version": 1,
                "text": code
            }
        })
        
        time.sleep(0.5)
        
        self.send_message("textDocument/definition", {
            "textDocument": {"uri": "file:///workspace/def_test.py"},
            "position": {"line": 3, "character": 10}
        })
    
    def test_complex(self):
        """Prueba código complejo"""
        if not self.initialized:
            print("⚠️  Primero inicializa el LSP (comando 1)")
            return
        
        print("\n🧪 Probando código complejo...")
        
        code = '''from dataclasses import dataclass
from typing import List

@dataclass
class User:
    id: int
    name: str
    email: str
    
    def to_dict(self):
        return {"id": self.id, "name": self.name}

class Processor:
    def process(self, users: List[User]) -> List[dict]:
        return [u.to_dict() for u in users]

proc = Processor()
proc.'''

        last_line_index = len(code.splitlines()) - 1
        last_line_text = code.splitlines()[-1]
        completion_character = len(last_line_text)
        
        self.send_notification("textDocument/didOpen", {
            "textDocument": {
                "uri": "file:///workspace/complex.py",
                "languageId": "python",
                "version": 1,
                "text": code
            }
        })
        
        time.sleep(1)
        
        self.send_message("textDocument/completion", {
            "textDocument": {"uri": "file:///workspace/complex.py"},
            "position": {"line": last_line_index, "character": completion_character}
        })

    def test_invalid_position(self):
        """Prueba que el multiplexor rechaza posiciones fuera de rango"""
        if not self.initialized:
            print("⚠️  Primero inicializa el LSP (comando 1)")
            return

        print("\n🧪 Probando posición inválida (debe devolver -32602)...")

        code = "print('hello')\n"
        uri = "file:///workspace/invalid_pos.py"

        self.send_notification("textDocument/didOpen", {
            "textDocument": {
                "uri": uri,
                "languageId": "python",
                "version": 1,
                "text": code
            }
        })

        time.sleep(0.5)

        self.send_message("textDocument/completion", {
            "textDocument": {"uri": uri},
            "position": {"line": 999, "character": 0}
        })
    
    def test_all(self):
        """Ejecuta todas las pruebas"""
        if not self.initialized:
            self.initialize()
            time.sleep(2)
        
        tests = [
            self.test_completion,
            self.test_class_completion,
            self.test_hover,
            self.test_definition,
            self.test_complex
        ]
        
        for test in tests:
            test()
            time.sleep(2)
        
        print("\n✅ Todas las pruebas ejecutadas!")
    
    def raw_mode(self):
        """Modo JSON manual"""
        print("\n📝 Modo JSON manual (pega el JSON completo)")
        print("Ejemplo: {\"jsonrpc\":\"2.0\",\"method\":\"initialized\",\"params\":{}}")
        print("Escribe 'exit' para salir del modo raw\n")
        
        while self.running:
            try:
                msg = input("JSON > ").strip()
                if msg.lower() == 'exit':
                    break
                if msg:
                    self.ws.send(msg)
            except EOFError:
                break
        
        print("Saliendo del modo raw\n")
        print("="*50)
        print("COMANDOS: 1=Init 2=Complet 3=Class 4=Hover 5=Def 6=Complex 7=All q=Salir")
        print("="*50)
    
    def command_loop(self):
        """Loop de comandos"""
        while self.running:
            try:
                cmd = input("\n💻 > ").strip().lower()
                
                if cmd == '1':
                    self.initialize()
                elif cmd == '2':
                    self.test_completion()
                elif cmd == '3':
                    self.test_class_completion()
                elif cmd == '4':
                    self.test_hover()
                elif cmd == '5':
                    self.test_definition()
                elif cmd == '6':
                    self.test_complex()
                elif cmd == '7':
                    self.test_all()
                elif cmd == '8':
                    self.test_invalid_position()
                elif cmd == 'raw':
                    self.raw_mode()
                elif cmd in ['q', 'quit', 'exit']:
                    print("👋 Cerrando...")
                    if self.initialized:
                        self.send_message("shutdown")
                        time.sleep(0.5)
                        self.send_notification("exit")
                    self.ws.close()
                    break
                elif cmd:
                    print("❓ Comando no reconocido")
                    
            except EOFError:
                break
            except Exception as e:
                print(f"❌ Error: {e}")
    
    def connect(self):
        """Conecta al WebSocket"""
        self.ws = websocket.WebSocketApp(
            self.url,
            on_open=self.on_open,
            on_message=self.on_message,
            on_error=self.on_error,
            on_close=self.on_close
        )
        
        # Iniciar loop de comandos en thread separado
        threading.Thread(target=self.command_loop, daemon=True).start()
        
        # Iniciar WebSocket
        self.ws.run_forever()


def main():
    url = sys.argv[1] if len(sys.argv) > 1 else "ws://127.0.0.1:32768"
    
    print("\n" + "="*50)
    print("🔧 CLIENTE LSP - PRUEBAS INTERACTIVAS")
    print("="*50)
    print(f"📍 URL: {url}")
    print("="*50)
    
    client = LSPClient(url)
    client.connect()


if __name__ == "__main__":
    main()
