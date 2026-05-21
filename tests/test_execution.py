"""
Pruebas de ejecución de código (NF-008)

Dependencias requeridas:
    pip install pytest websocket-client python-dotenv

Valida:
- Ejecución de Python, C++, TypeScript
- Outputs correctos
- Manejo de timeouts (60s)
- Errores de compilación
- Ejecución concurrente (serialización)
"""
import pytest
import json
import time
import threading
import os
from dotenv import load_dotenv
from websocket import create_connection, WebSocketException, WebSocketTimeoutException

# Cargar variables de entorno
load_dotenv()

# Configuración
EXECUTION_URL = os.getenv('EXECUTION_URL', 'ws://localhost:8081/ws/execute')

@pytest.fixture
def execution_ws_url():
    return EXECUTION_URL


class CodeExecutor:
    """Cliente WebSocket para ejecutar código"""
    
    def __init__(self, ws_url):
        self.ws_url = ws_url
        self.ws = None
        self.messages = []
        self.finished = False
    
    def connect(self):
        """Conectar al WebSocket"""
        try:
            self.ws = create_connection(self.ws_url, timeout=5)
            return True
        except Exception as e:
            raise RuntimeError(f"No se pudo conectar a {self.ws_url}: {e}")
    
    def run_code(self, language, code, timeout=65, inputs=None, input_delay=0.5):
        """
        Ejecutar código y retornar todos los mensajes hasta 'finished'.

        Args:
            language: 'python', 'cpp', 'typescript'
            code: Código a ejecutar
            timeout: Tiempo máximo de espera
            inputs: Lista de strings para enviar por stdin vía WebSocket
            input_delay: Tiempo antes de enviar stdin, para dejar iniciar el proceso

        Returns:
            Lista de mensajes recibidos
        """
        if not self.ws:
            raise RuntimeError("WebSocket no conectado")
        
        self.finished = False
        self.messages = []

        request = {
            'type': 'run',
            'language': language,
            'code': code
        }

        self.ws.send(json.dumps(request))

        messages = []
        start_time = time.time()
        inputs_sent = False
        inputs = inputs or []

        while time.time() - start_time < timeout:
            try:
                # Enviar stdin después de una pequeña espera
                if inputs and not inputs_sent and time.time() - start_time >= input_delay:
                    for user_input in inputs:
                        input_request = {
                            'type': 'input',
                            'data': user_input
                        }
                        self.ws.send(json.dumps(input_request))
                    inputs_sent = True

                msg = self.ws.recv()

                if msg:
                    data = json.loads(msg)
                    messages.append(data)

                    if data.get('type') == 'finished':
                        self.finished = True
                        break

            except WebSocketTimeoutException:
                continue

            except Exception as e:
                raise RuntimeError(f"Error recibiendo mensaje: {e}")
        
        self.messages = messages
        return messages
    
    def get_output(self):
        """Concatenar todos los mensajes de 'output'"""
        output = []
        for msg in self.messages:
            if msg.get('type') == 'output':
                output.append(msg.get('data', ''))
        return ''.join(output)
    
    def get_error(self):
        """Obtener el primer mensaje de 'error'"""
        for msg in self.messages:
            if msg.get('type') == 'error':
                return msg.get('data', '')
        return None
    
    def get_exit_code(self):
        """Obtener exit code del mensaje 'finished'"""
        for msg in self.messages:
            if msg.get('type') == 'finished':
                return msg.get('exitCode')
        return None
    
    def close(self):
        """Cerrar WebSocket"""
        if self.ws:
            try:
                self.ws.close()
            except:
                pass
            self.ws = None

class TestCodeExecution:
    """Suite de pruebas para ejecución de código"""
    
    @pytest.fixture
    def executor(self, execution_ws_url):
        """Fixture que proporciona un executor conectado"""
        exec = CodeExecutor(execution_ws_url)
        exec.connect()
        yield exec
        exec.close()

    def test_python_hello_world(self, executor):
        """
        Test: Ejecución básica de Python
        
        Código: print("hola mundo")
        
        Resultado esperado:
            - Output contiene "hola mundo\n"
            - exitCode == 0
        """
        code = 'print("hola mundo")'
        messages = executor.run_code('python', code)
        
        assert executor.finished, "No se recibió mensaje 'finished'"
        assert executor.get_exit_code() == 0, \
            f"Exit code no es 0: {executor.get_exit_code()}"
        
        output = executor.get_output()
        assert 'hola mundo' in output, \
            f"Output no contiene 'hola mundo': {output}"

    def test_cpp_hello_world(self, executor):
        """
        Test: Ejecución básica de C++
        
        Código: #include<iostream> + main que imprime "hola"
        
        Resultado esperado:
            - Output contiene "hola"
            - exitCode == 0
        """
        code = '''#include <iostream>
int main(){
    std::cout << "hola";
    return 0;
}'''
        messages = executor.run_code('cpp', code)
        
        assert executor.finished, "No se recibió mensaje 'finished'"
        assert executor.get_exit_code() == 0, \
            f"Exit code no es 0: {executor.get_exit_code()}"
        
        output = executor.get_output()
        assert 'hola' in output, \
            f"Output no contiene 'hola': {output}"

    def test_typescript_hello_world(self, executor):
        """
        Test: Ejecución básica de TypeScript
        
        Código: console.log("hola ts")
        
        Resultado esperado:
            - Output contiene "hola ts"
            - exitCode == 0
        """
        code = 'console.log("hola ts");'
        messages = executor.run_code('typescript', code)
        
        assert executor.finished, "No se recibió mensaje 'finished'"
        assert executor.get_exit_code() == 0, \
            f"Exit code no es 0: {executor.get_exit_code()}"
        
        output = executor.get_output()
        assert 'hola ts' in output, \
            f"Output no contiene 'hola ts': {output}"

    def test_cpp_compile_error(self, executor):
        """
        Test: Error de compilación en C++
        
        Código: referencia a variable no definida
        
        Resultado esperado:
            - Output contiene mensaje de error de compilación
            - exitCode != 0
        """
        code = '''int main(){
    return foo;
}'''
        messages = executor.run_code('cpp', code)
        
        assert executor.finished, "No se recibió mensaje 'finished'"
        assert executor.get_exit_code() != 0, \
            f"Exit code debería ser != 0: {executor.get_exit_code()}"
        
        output = executor.get_output()
        assert len(output) > 0, "No hay output (error message esperado)"

    def test_python_timeout(self, executor):
        """
        Test: Timeout en Python
        
        Código: Bucle infinito
        
        Resultado esperado:
            - Mensaje de type 'timeout' dentro de 60s
        """
        code = 'while True: pass'
        messages = executor.run_code('python', code, timeout=65)
        
        # Buscar mensaje de timeout
        timeout_msg = None
        for msg in messages:
            if msg.get('type') == 'timeout':
                timeout_msg = msg
                break
        
        assert timeout_msg, f"No se recibió timeout. Mensajes: {messages}"

    def test_python_with_input_output(self, executor):
        """
        Test: Python con entrada/salida interactiva vía WebSocket

        Código:
            input() + print()

        Resultado esperado:
            - Recibe input por WebSocket
            - Output contiene Hola Gabriel
            - exitCode == 0
        """
        code = '''name = input("¿Nombre? ")
print(f"Hola {name}")'''

        messages = executor.run_code(
            'python',
            code,
            timeout=20,
            inputs=['Gabriel\n']
        )

        assert executor.finished, f"No completó. Mensajes: {messages}"
        assert executor.get_exit_code() == 0, \
            f"Exit code debería ser 0: {executor.get_exit_code()}"

        output = executor.get_output()
        assert 'Hola Gabriel' in output, \
            f"Output no contiene 'Hola Gabriel': {output}"

    def test_concurrent_executions(self, execution_ws_url):
        """
        Test: Ejecuciones concurrentes con cola por contenedor/lenguaje

        Contexto real del sistema:
            Cada contenedor de código solo admite una ejecución al tiempo.
            Las demás ejecuciones quedan en cola.

        Procedimiento:
            - Crear 3 conexiones WebSocket.
            - Lanzar 3 ejecuciones Python concurrentemente.
            - Verificar que todas completan correctamente.

        Resultado esperado:
            - Las 3 ejecuciones terminan.
            - Todas tienen exitCode == 0.
            - Cada output corresponde a su request.
        """
        executors = []
        results = {}
        errors = {}

        def run_request(i, executor):
            try:
                code = f'''import time
time.sleep(1)
print("request {i}")'''

                messages = executor.run_code(
                    'python',
                    code,
                    timeout=60
                )

                results[i] = {
                    'finished': executor.finished,
                    'exit_code': executor.get_exit_code(),
                    'output': executor.get_output(),
                    'messages': messages
                }

            except Exception as e:
                errors[i] = str(e)

        try:
            for _ in range(3):
                exec_client = CodeExecutor(execution_ws_url)
                exec_client.connect()
                executors.append(exec_client)

            threads = []

            for i, exec_client in enumerate(executors):
                thread = threading.Thread(
                    target=run_request,
                    args=(i, exec_client)
                )
                threads.append(thread)
                thread.start()

            for thread in threads:
                thread.join(timeout=90)

            assert not errors, f"Errores durante ejecución concurrente: {errors}"

            assert len(results) == 3, \
                f"No se recibieron resultados de las 3 ejecuciones. Resultados: {results}"

            for i in range(3):
                assert results[i]['finished'], \
                    f"Executor {i} no terminó. Mensajes: {results[i]['messages']}"

                assert results[i]['exit_code'] == 0, \
                    f"Executor {i} exitCode != 0: {results[i]['exit_code']}"

                assert f"request {i}" in results[i]['output'], \
                    f"Output {i} incorrecto: {results[i]['output']}"

        finally:
            for exec_client in executors:
                exec_client.close()

    def test_python_multiline_with_errors(self, executor):
        """
        Test: Python con múltiples líneas incluyendo error runtime
        
        Código: división por cero
        
        Resultado esperado:
            - Output contiene traceback
            - exitCode != 0
        """
        code = '''x = 10
y = 0
z = x / y'''
        messages = executor.run_code('python', code)
        
        assert executor.finished, "No completó"
        assert executor.get_exit_code() != 0, \
            f"Exit code debería ser != 0: {executor.get_exit_code()}"
        
        output = executor.get_output()
        assert 'ZeroDivisionError' in output or 'Error' in output or 'error' in output, \
            f"Output no contiene error: {output}"

    def test_cpp_with_input(self, executor):
        """
        Test: C++ con lectura de entrada stdin vía WebSocket

        Código:
            cin >> value
            cout << value * 2

        Resultado esperado:
            - El proceso recibe input por WebSocket
            - Output contiene 10
            - exitCode == 0
        """
        code = '''#include <iostream>
int main(){
    int x;
    std::cin >> x;
    std::cout << x * 2;
    return 0;
}'''

        messages = executor.run_code(
            'cpp',
            code,
            timeout=20,
            inputs=['5\n']
        )

        assert executor.finished, f"No completó. Mensajes: {messages}"
        assert executor.get_exit_code() == 0, \
            f"Exit code debería ser 0: {executor.get_exit_code()}"

        output = executor.get_output()
        assert '10' in output, \
            f"Output no contiene resultado esperado '10': {output}"