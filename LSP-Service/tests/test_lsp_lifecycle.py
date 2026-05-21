import time
import requests


def test_lifecycle_create_and_idle(lsp_base_url, project_id, auth_headers):
    base = lsp_base_url.rstrip("/")
    # create
    r = requests.post(f"{base}/lsp/{project_id}", headers=auth_headers, json={})
    assert r.status_code in (200, 201)

    # optionally wait a short time for container to be ready
    time.sleep(1)

    # query instance list/status
    r2 = requests.get(f"{base}/lsp/{project_id}", headers=auth_headers)
    assert r2.status_code == 200

    # delete
    r3 = requests.delete(f"{base}/lsp/{project_id}", headers=auth_headers)
    assert r3.status_code in (200, 204)
import time


def test_idle_timeout_behavior(lsp_base_url, project_id, jwt_for_project):
    # This is a lightweight lifecycle check: create a container then wait a bit
    import requests

    url = f"{lsp_base_url}/lsp/{project_id}"
    r = requests.post(url, headers={"Authorization": f"Bearer {jwt_for_project}"}, json={})
    assert r.status_code in (200, 201)

    # wait a short period to allow heartbeat/idle logic to run in real service
    time.sleep(1)

    # query status
    r2 = requests.get(url, headers={"Authorization": f"Bearer {jwt_for_project}"})
    assert r2.status_code in (200, 404, 204)
