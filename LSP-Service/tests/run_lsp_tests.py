#!/usr/bin/env python3
"""
Runner único para pruebas LSP (sección 5 del plan de pruebas del sistema).

Características:
- Soporta cargar un archivo `.env` por ambiente (dev/prod) con `python-dotenv`.
- Asume que el servicio ya está corriendo: valida `GET /health` y ejecuta pytest.
- Exporta variables de entorno usadas por los tests: LSP_BASE_URL, JWT_SECRET,
  LSP_TEST_PROJECT, TEST_JWT.
- Limpieza best-effort de contenedores creados por el `project_id` de prueba.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
import uuid
from dataclasses import dataclass


def _try_load_dotenv(env_file: str | None) -> None:
    """Carga variables de entorno desde un archivo .env si existe."""
    if not env_file:
        return

    try:
        from dotenv import load_dotenv  # type: ignore
    except Exception as exc:  # pragma: no cover
        raise SystemExit(
            "Falta dependencia para --env-file: instala `python-dotenv`.\n"
            f"Detalle: {exc}"
        )

    if not os.path.exists(env_file):
        raise SystemExit(f"No existe el archivo de entorno: {env_file}")

    load_dotenv(env_file, override=False)


def _require(value: str | None, name: str) -> str:
    """Valida que una variable requerida exista."""
    if not value:
        raise SystemExit(f"Falta variable requerida: {name}")
    return value


@dataclass(frozen=True)
class RunnerConfig:
    lsp_base_url: str
    jwt_secret: str
    project_id: str
    test_jwt: str | None
    env_file: str | None
    idle_timeout_ms: str | None


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Ejecuta pruebas LSP (REST, WS, lifecycle) con soporte de .env",
    )
    parser.add_argument(
        "--env-file",
        default=os.environ.get("LSP_ENV_FILE"),
        help="Ruta a archivo .env (alternativa: variable LSP_ENV_FILE).",
    )
    parser.add_argument(
        "--base-url",
        default=os.environ.get("LSP_BASE_URL"),
        help="Base URL del LSP Load Balancer (ej: http://127.0.0.1:8085).",
    )
    parser.add_argument(
        "--jwt-secret",
        default=os.environ.get("JWT_SECRET"),
        help="Secreto HS256 para generar TEST_JWT si no se provee.",
    )
    parser.add_argument(
        "--project-id",
        default=os.environ.get("LSP_TEST_PROJECT"),
        help="Project ID de prueba (si no se provee, se genera uno).",
    )
    parser.add_argument(
        "--jwt",
        default=os.environ.get("TEST_JWT"),
        help="JWT del proyecto (si no se provee, se genera con JWT_SECRET).",
    )
    parser.add_argument(
        "--pytest-args",
        default="",
        help="Args adicionales para pytest (ej: '-q -vv').",
    )
    return parser.parse_args()


def _build_config(args: argparse.Namespace) -> RunnerConfig:
    _try_load_dotenv(args.env_file)

    lsp_base_url = args.base_url or os.environ.get("LSP_BASE_URL") or "http://127.0.0.1:8085"
    jwt_secret = args.jwt_secret or os.environ.get("JWT_SECRET") or "jwt-secreto"

    project_id = args.project_id or os.environ.get("LSP_TEST_PROJECT")
    if not project_id:
        project_id = f"test-project-{uuid.uuid4().hex[:10]}"

    test_jwt = args.jwt or os.environ.get("TEST_JWT") or None
    idle_timeout_ms = os.environ.get("CONTAINER_IDLE_TIMEOUT_MS")

    return RunnerConfig(
        lsp_base_url=lsp_base_url.rstrip("/"),
        jwt_secret=jwt_secret,
        project_id=project_id,
        test_jwt=test_jwt,
        env_file=args.env_file,
        idle_timeout_ms=idle_timeout_ms,
    )


def _health_check(base_url: str) -> None:
    """Valida que el servicio responda /health."""
    try:
        import requests  # type: ignore
    except Exception as exc:  # pragma: no cover
        raise SystemExit(f"Falta dependencia `requests` para health-check: {exc}")

    url = f"{base_url}/health"
    try:
        resp = requests.get(url, timeout=5)
    except Exception as exc:
        raise SystemExit(f"No se pudo conectar a {url}: {exc}")

    if resp.status_code != 200:
        raise SystemExit(f"/health retornó {resp.status_code}: {resp.text[:200]}")


def _ensure_pytest_available() -> None:
    """Falla rápido si pytest no está instalado."""
    try:
        import pytest  # noqa: F401
    except Exception:
        raise SystemExit("pytest no está instalado. Instala dependencias de tests y reintenta.")


def _maybe_generate_test_jwt(project_id: str, jwt_secret: str, existing: str | None) -> str:
    """Genera un JWT HS256 si no fue provisto por el usuario/entorno."""
    if existing:
        return existing

    try:
        import jwt  # type: ignore
    except Exception as exc:  # pragma: no cover
        raise SystemExit(
            "No hay TEST_JWT y no se puede generar porque falta PyJWT.\n"
            f"Detalle: {exc}"
        )

    now = int(time.time())
    payload = {
        "sub": "tests",
        "username": "tests",
        "room": project_id,
        "iat": now,
        "exp": now + 3600,
    }
    return jwt.encode(payload, jwt_secret, algorithm="HS256")


def _run_pytest(pytest_args: str) -> int:
    """Ejecuta pytest para los archivos que cubren sección 5."""
    test_files = [
        os.path.join(os.path.dirname(__file__), "test_lsp_rest.py"),
        os.path.join(os.path.dirname(__file__), "test_lsp_ws.py"),
        os.path.join(os.path.dirname(__file__), "test_lsp_lifecycle.py"),
    ]

    cmd = [sys.executable, "-m", "pytest", *test_files]
    if pytest_args.strip():
        cmd.extend(pytest_args.strip().split())

    return subprocess.call(cmd)


def _best_effort_cleanup(base_url: str, token: str, project_id: str) -> None:
    """Elimina contenedores de prueba para python/cpp/typescript, ignorando 404."""
    try:
        import requests  # type: ignore
    except Exception:
        return

    headers = {"Authorization": f"Bearer {token}"}
    for language in ("python", "cpp", "typescript"):
        try:
            requests.delete(
                f"{base_url}/lsp/{project_id}",
                params={"language": language},
                headers=headers,
                timeout=10,
            )
        except Exception:
            continue


def main() -> int:
    args = _parse_args()
    cfg = _build_config(args)

    _ensure_pytest_available()
    _health_check(cfg.lsp_base_url)

    test_jwt = _maybe_generate_test_jwt(cfg.project_id, cfg.jwt_secret, cfg.test_jwt)

    # Exportar env para pytest/fixtures
    os.environ["LSP_BASE_URL"] = cfg.lsp_base_url
    os.environ["JWT_SECRET"] = cfg.jwt_secret
    os.environ["LSP_TEST_PROJECT"] = cfg.project_id
    os.environ["TEST_JWT"] = test_jwt

    if cfg.idle_timeout_ms:
        print(f"[INFO] CONTAINER_IDLE_TIMEOUT_MS={cfg.idle_timeout_ms} (solo referencia; el servicio debe aplicarlo)")

    print(f"[INFO] LSP_BASE_URL={cfg.lsp_base_url}")
    print(f"[INFO] LSP_TEST_PROJECT={cfg.project_id}")
    if cfg.env_file:
        print(f"[INFO] Env file={cfg.env_file}")

    exit_code = 1
    try:
        exit_code = _run_pytest(args.pytest_args)
        return exit_code
    finally:
        _best_effort_cleanup(cfg.lsp_base_url, test_jwt, cfg.project_id)


if __name__ == "__main__":
    raise SystemExit(main())

