"""
Pruebas de integración para despliegue multi-máquina del LSP-Service.

Requiere:
  - Redis accesible en REDIS_HOST:REDIS_PORT
  - 2 instancias del API corriendo en máquinas con WS_PUBLIC_HOST distintos
  - NFS montado en /home/projects en ambas máquinas

Ejecutar con:
  TEST_HOST_A=http://10.0.0.1:8135 TEST_HOST_B=http://10.0.0.2:8135 \\
    pytest tests/test_multi_machine.py -v

O via script:
  ./scripts/test-multi-machine.sh
"""

import os
import time
import pytest
import httpx

MACHINE_A = os.environ.get("TEST_HOST_A", "http://127.0.0.1:8135")
MACHINE_B = os.environ.get("TEST_HOST_B", "http://127.0.0.2:8135")


def _extract_host(url: str) -> str:
    """Extrae el hostname de una URL (sin puerto ni protocolo)."""
    return url.split("://")[1].split(":")[0]


@pytest.fixture(autouse=True)
def _cleanup():
    """Limpia contenedores de prueba al final de cada test."""
    yield
    for project_id in ["test-mm-1", "test-mm-2", "test-mm-3", "test-mm-4"]:
        for lang in ["python"]:
            try:
                httpx.delete(f"{MACHINE_A}/lsp/{project_id}?language={lang}", timeout=10)
            except Exception:
                pass
            try:
                httpx.delete(f"{MACHINE_B}/lsp/{project_id}?language={lang}", timeout=10)
            except Exception:
                pass


class TestMultiMachineHealth:
    """Verifica que ambas máquinas están operativas."""

    def test_machine_a_healthy(self):
        r = httpx.get(f"{MACHINE_A}/health", timeout=5)
        assert r.status_code == 200

    def test_machine_b_healthy(self):
        r = httpx.get(f"{MACHINE_B}/health", timeout=5)
        assert r.status_code == 200


class TestCreateAndQuery:
    """Pruebas del flujo crear → consultar cross-machine."""

    def test_create_on_a_returns_host_field(self):
        """Al crear en A, la respuesta incluye el campo host."""
        project = "test-mm-1"
        r = httpx.post(
            f"{MACHINE_A}/lsp/{project}",
            json={"language": "python", "max_clients": 2},
            timeout=15,
        )
        assert r.status_code == 200
        data = r.json()
        assert "host" in data
        assert data["host"] == _extract_host(MACHINE_A)
        assert data["ws_url"].startswith("ws://")

    def test_query_on_b_sees_container_from_a(self):
        """Crear en A, consultar en B — debe ver el mismo ws_url y host."""
        project = "test-mm-2"

        r_create = httpx.post(
            f"{MACHINE_A}/lsp/{project}",
            json={"language": "python", "max_clients": 2},
            timeout=15,
        )
        assert r_create.status_code == 200
        data_a = r_create.json()

        time.sleep(1)

        r_status = httpx.get(
            f"{MACHINE_B}/lsp/{project}?language=python", timeout=10
        )
        assert r_status.status_code == 200
        data_b = r_status.json()

        assert data_b["ws_url"] == data_a["ws_url"]
        assert data_b["host"] == data_a["host"]

    def test_create_duplicate_cross_machine_prevented(self):
        """Intentar crear duplicado en B después de crear en A — retorna existente."""
        project = "test-mm-3"

        httpx.post(
            f"{MACHINE_A}/lsp/{project}",
            json={"language": "python", "max_clients": 2},
            timeout=15,
        )

        time.sleep(1)

        r_dup = httpx.post(
            f"{MACHINE_B}/lsp/{project}",
            json={"language": "python", "max_clients": 2},
            timeout=15,
        )
        assert r_dup.status_code == 200
        data = r_dup.json()
        assert data["host"] == _extract_host(MACHINE_A), (
            f"Host should be machine A ({_extract_host(MACHINE_A)}), "
            f"got {data['host']}"
        )


class TestDestroy:
    """Pruebas de destrucción cross-machine."""

    def test_destroy_from_other_machine(self):
        """Crear en A, destruir desde B."""
        project = "test-mm-4"

        httpx.post(
            f"{MACHINE_A}/lsp/{project}",
            json={"language": "python", "max_clients": 2},
            timeout=15,
        )

        time.sleep(1)

        r_destroy = httpx.delete(
            f"{MACHINE_B}/lsp/{project}?language=python", timeout=15
        )
        assert r_destroy.status_code == 200

        time.sleep(1)

        r_check = httpx.get(
            f"{MACHINE_A}/lsp/{project}?language=python", timeout=10
        )
        assert r_check.json()["status"] == "not_found"


class TestListAll:
    """Pruebas de listado global."""

    def test_list_all_sees_both_machines(self):
        """Listar desde A muestra contenedores creados en ambas máquinas."""
        project_a = "test-mm-1"
        project_b = "test-mm-2"

        httpx.post(
            f"{MACHINE_A}/lsp/{project_a}",
            json={"language": "python", "max_clients": 2},
            timeout=15,
        )
        httpx.post(
            f"{MACHINE_B}/lsp/{project_b}",
            json={"language": "python", "max_clients": 2},
            timeout=15,
        )

        time.sleep(2)

        r = httpx.get(f"{MACHINE_A}/lsp/", timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert data["total"] >= 2

        hosts = {c.get("host") for c in data["containers"]}
        assert _extract_host(MACHINE_A) in hosts
        assert _extract_host(MACHINE_B) in hosts
