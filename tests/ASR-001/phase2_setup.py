"""
Fase 2 — Setup y teardown de usuarios/proyectos de prueba.

Crea N usuarios, los distribuye en grupos de hasta 4 por proyecto (round-robin),
crea proyectos con colaboradores y archivo de prueba. Al finalizar, los elimina.
"""

from typing import Dict, List

import requests

LANGUAGES = ["python", "typescript", "cpp"]

DEFAULT_FILENAME = {
    "python": "main.py",
    "typescript": "main.ts",
    "cpp": "main.cpp",
}

DEFAULT_CODE = {
    "python": 'print("hola mundo desde playwright")',
    "typescript": 'const msg: string = "hola playwright";\nconsole.log(msg);',
    "cpp": '#include <iostream>\n\nint main() {\n  std::cout << "hola cpp desde playwright" << std::endl;\n  return 0;\n}',
}


def _api(method: str, url: str, token: str = None, json_body: dict = None) -> dict:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    r = requests.request(method, url, headers=headers, json=json_body or {}, timeout=15)
    if r.status_code >= 400:
        print(f"  [setup] WARNING: {method} {url} -> {r.status_code} {r.text[:100]}")
    return r.json() if r.text else {}


def _login(backend_url: str, username: str, password: str) -> str:
    data = _api("POST", f"{backend_url}/api/auth/login/",
                json_body={"username": username, "password": password})
    token = data.get("access")
    if not token:
        raise RuntimeError(f"Login fallo para {username}: {data}")
    return token


def setup_phase2(backend_url: str, num_users: int, password: str) -> dict:
    """
    Crea N usuarios y los distribuye en proyectos (max 4 c/u, round-robin).
    Rota lenguajes entre proyectos: python -> typescript -> cpp -> python ...

    Retorna:
        {
            "worker_configs": [{username, password, project_name, language}, ...],
            "setup_data": {project_owner_tokens, project_ids, user_ids, usernames},
        }
    """
    print("\n" + "-" * 50)
    print(f"FASE 2 SETUP -- {num_users} usuarios")
    print("-" * 50)

    # -- 1. Registrar usuarios --------------------------------------------------
    users: list[dict] = []
    for i in range(1, num_users + 1):
        username = f"p2-user-{i}"
        email = f"p2-user-{i}@test.local"
        data = _api("POST", f"{backend_url}/api/auth/register/",
                     json_body={"username": username, "email": email,
                                "password": password, "nombre": f"Phase2 User {i}"})
        uid = data.get("id")
        if not uid:
            token = _login(backend_url, username, password)
            me = _api("GET", f"{backend_url}/api/auth/me/", token=token)
            uid = me.get("id")
            if not uid:
                raise RuntimeError(f"No se pudo registrar ni loguear {username}: {data}")
            print(f"  [setup] Usuario '{username}' ya existia (id={uid})")
        else:
            print(f"  [setup] Usuario '{username}' creado (id={uid})")
        users.append({"id": uid, "username": username, "password": password})

    # -- 2. Agrupar y crear proyectos -------------------------------------------
    worker_configs: list[dict] = []
    project_owner_tokens: list[dict] = []
    project_ids: list[int] = []

    group_size = 4
    num_groups = (num_users + group_size - 1) // group_size

    for g_idx in range(num_groups):
        group = users[g_idx * group_size : (g_idx + 1) * group_size]
        language = LANGUAGES[g_idx % len(LANGUAGES)]
        owner = group[0]
        collaborator_ids = [u["id"] for u in group[1:]]

        project_name = f"p2-proj-{g_idx}-{language}"

        # Login como owner
        owner_token = _login(backend_url, owner["username"], owner["password"])
        project_owner_tokens.append({"project": project_name, "token": owner_token})

        # Crear proyecto con colaboradores
        body: dict = {
            "nombre": project_name,
            "lenguaje": language.upper(),
            "descripcion": f"Phase2 test project {g_idx} ({language})",
        }
        if collaborator_ids:
            body["colaboradores"] = collaborator_ids

        proj = _api("POST", f"{backend_url}/api/projects/",
                     token=owner_token, json_body=body)
        pid = proj.get("id")
        if not pid:
            proj_list = _api("GET", f"{backend_url}/api/projects/", token=owner_token)
            for p in proj_list.get("results", []):
                if p.get("nombre") == project_name:
                    pid = p["id"]
                    break
            if not pid:
                raise RuntimeError(
                    f"No se pudo crear/encontrar proyecto '{project_name}': {proj}"
                )
            print(f"  [setup] Proyecto '{project_name}' ya existia (id={pid})")
        else:
            print(
                f"  [setup] Proyecto '{project_name}' creado "
                f"(id={pid}, {language}, owner={owner['username']}, "
                f"collabs={collaborator_ids})"
            )
        project_ids.append(pid)

        # Crear archivo de prueba
        filename = DEFAULT_FILENAME.get(language, "main.txt")
        code = DEFAULT_CODE.get(language, "")
        _api("POST", f"{backend_url}/api/projects/{pid}/archivos/",
              token=owner_token,
              json_body={"nombre": filename, "contenido": code})
        print(f"  [setup]   Archivo '{filename}' creado en proyecto {pid}")

        # Armar configs de workers para este grupo
        for user in group:
            worker_configs.append({
                "username": user["username"],
                "password": user["password"],
                "project_name": project_name,
                "language": language,
            })

    print(f"  [setup] Total: {len(worker_configs)} workers en {num_groups} proyectos")
    print("-" * 50 + "\n")

    return {
        "worker_configs": worker_configs,
        "setup_data": {
            "project_owner_tokens": project_owner_tokens,
            "project_ids": project_ids,
            "user_ids": [u["id"] for u in users],
            "usernames": [u["username"] for u in users],
        },
    }


def teardown_phase2(backend_url: str, setup_data: dict):
    """Elimina todos los proyectos y usuarios creados por setup_phase2."""
    print("\n" + "-" * 50)
    print("FASE 2 TEARDOWN")
    print("-" * 50)

    # Login admin para eliminar usuarios (solo admin puede)
    admin_token = _login(backend_url, "admin1", "Admin1234!")

    # -- Eliminar proyectos -----------------------------------------------------
    for entry in setup_data["project_owner_tokens"]:
        project_name = entry["project"]
        token = entry["token"]
        try:
            proj_list = _api("GET", f"{backend_url}/api/projects/", token=token)
            for p in proj_list.get("results", []):
                if p.get("nombre") == project_name:
                    _api("DELETE", f"{backend_url}/api/projects/{p['id']}/",
                         token=token)
                    print(f"  [teardown] Proyecto '{project_name}' eliminado")
                    break
        except Exception as exc:
            print(f"  [teardown] ERROR eliminando proyecto '{project_name}': {exc}")

    # -- Eliminar usuarios ------------------------------------------------------
    for uid, username in zip(setup_data["user_ids"], setup_data["usernames"]):
        try:
            _api("DELETE", f"{backend_url}/api/auth/usuarios/{uid}/",
                 token=admin_token)
            print(f"  [teardown] Usuario '{username}' (id={uid}) eliminado")
        except Exception as exc:
            print(f"  [teardown] ERROR eliminando usuario '{username}': {exc}")

    print("-" * 50 + "\n")
