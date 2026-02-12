import subprocess
import tempfile
import time
from pathlib import Path

class Ejecutor:
    
    @staticmethod
    def _resultado_str(
        fase: str,
        ok: bool,
        stdout: str = "",
        stderr: str = "",
        exit_code: int = -1,
    ) -> str:
        return (
            f"fase={fase}\n"
            f"ok={str(ok).lower()}\n"
            f"stdout={stdout}\n"
            f"stderr={stderr}\n"
            f"exitCode={exit_code}\n"
        )

    @staticmethod
    def _respuesta(
        fase: str,
        ok: bool,
        tiempo: int,
        stdout: str = "",
        stderr: str = "",
        exit_code: int = -1,
    ) -> dict:
        salida = Ejecutor._resultado_str(
            fase=fase,
            ok=ok,
            stdout=stdout,
            stderr=stderr,
            exit_code=exit_code,
        )
        return {"resultado": salida, "tiempo": str(tiempo)}

    @staticmethod
    def ejecutarCpp(codigo: str, entrada: str = "") -> dict:
        # Crear carpeta temporal aislada para compilar y ejecutar.
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            cpp = tmp_path / "main.cpp"
            exe = tmp_path / "main.out"
            cpp.write_text(codigo, encoding="utf-8")

            try:
                t0 = time.perf_counter()
                comp = subprocess.run(
                    ["g++", "-std=c++17", str(cpp), "-O2", "-o", str(exe)],
                    capture_output=True,
                    text=True,
                    timeout=10,
                )
                t_compile = int((time.perf_counter() - t0) * 1000)
            except subprocess.TimeoutExpired:
                t_compile = int((time.perf_counter() - t0) * 1000)
                return Ejecutor._respuesta(
                    fase="compile",
                    ok=False,
                    stderr="Compilation timeout",
                    tiempo=t_compile,
                )

            if comp.returncode != 0:
                return Ejecutor._respuesta(
                    fase="compile",
                    ok=False,
                    stdout=comp.stdout,
                    stderr=comp.stderr,
                    exit_code=comp.returncode,
                    tiempo=t_compile,
                )

            try:
                t1 = time.perf_counter()
                run = subprocess.run(
                    [str(exe)],
                    input=entrada,
                    capture_output=True,
                    text=True,
                    timeout=2,
                )
                t_run = int((time.perf_counter() - t1) * 1000)
            except subprocess.TimeoutExpired:
                t_run = int((time.perf_counter() - t1) * 1000)
                return Ejecutor._respuesta(
                    fase="run",
                    ok=False,
                    stderr="Execution timeout",
                    tiempo=t_run,
                )
            
            return Ejecutor._respuesta(
                fase="run",
                ok=(run.returncode == 0),
                stdout=run.stdout,
                stderr=run.stderr,
                exit_code=run.returncode,
                tiempo=t_run,
            )
