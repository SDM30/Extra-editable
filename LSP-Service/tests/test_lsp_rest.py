import requests
import time

def test_create_get_delete_lsp(lsp_base_url, project_id, auth_headers):
    base = lsp_base_url.rstrip("/")
    # Create LSP container for project
    r = requests.post(f"{base}/lsp/{project_id}", headers=auth_headers, json={})
    assert r.status_code in (200, 201)
    data = r.json()
    assert "id" in data or "project" in data

    # Get status/listing
    r2 = requests.get(f"{base}/lsp/{project_id}", headers=auth_headers)
    assert r2.status_code == 200

    # Delete container
    r3 = requests.delete(f"{base}/lsp/{project_id}", headers=auth_headers)
    assert r3.status_code in (200, 204)
import os
import requests


def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


def test_create_and_get_container(lsp_base_url, project_id, jwt_for_project):
    url = f"{lsp_base_url}/lsp/{project_id}"
    r = requests.post(url, headers=auth_headers(jwt_for_project), json={})
    assert r.status_code in (200, 201)
    data = r.json()
    assert "id" in data or data.get("status") in ("created", "ok")


def test_list_containers(lsp_base_url, jwt_for_project):
    url = f"{lsp_base_url}/lsp"
    r = requests.get(url, headers=auth_headers(jwt_for_project))
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_delete_container(lsp_base_url, project_id, jwt_for_project):
    url = f"{lsp_base_url}/lsp/{project_id}"
    r = requests.delete(url, headers=auth_headers(jwt_for_project))
    assert r.status_code in (200, 204)
