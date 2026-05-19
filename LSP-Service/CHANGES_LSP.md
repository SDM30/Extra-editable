# CHANGES — Multi-Machine Support for LSP-Service

## Summary

Added support for running LSP-Service API instances on separate physical/virtual machines
sharing state via Redis and project files via NFS.

## Architecture Decisions

- **Sticky containers:** each machine owns the LSP containers it creates on its local
  Docker daemon. The container registry in Redis records which machine (`host`) owns each
  container.
- **Cross-machine forwarding:** when an instance needs to destroy, query status, or fetch
  logs from a container owned by another machine, it forwards the request via HTTP to
  the owning machine's API.
- **Internal endpoint:** a new `DELETE /lsp/{project_id}/_internal/destroy` endpoint
  (protected by `X-LSP-Internal` header/secret) receives forwarded destroy requests.

## Files Modified

### `language-service/app/services/registry.py`

- `add()` now accepts optional `host` parameter; defaults to `WS_PUBLIC_HOST` env var.
- Container entries in Redis now include a `"host"` field identifying the owning machine.

### `language-service/app/services/lifecycle.py`

- Added `_get_local_host()` — returns `WS_PUBLIC_HOST` for this machine.
- Added `_is_local(entry)` — checks if a container entry belongs to this machine.
- Added `_forward_destroy_to_host()` — forwards destroy request to remote host via HTTP.
- Added `_forward_get_logs()` — forwards log request to remote host via HTTP.
- Added `destroy_container_local()` — destroys container without cross-machine check
  (used by internal endpoint).
- `create_container()` — when registry entry exists for a remote host, returns it
  immediately instead of trying to check Docker locally. Passes `host` to `registry.add()`.
- `destroy_container()` — detects remote ownership and forwards instead of calling Docker.
- `get_status()` — returns `"status": "remote"` for containers owned by other machines.
- `get_container_logs()` — forwards to remote host for cross-machine containers.
- Added `import httpx` for HTTP forwarding.

### `language-service/app/routers/lsp.py`

- Added `import os` and `from fastapi import Header`.
- `CreateResponse` and `StatusResponse` now include `host` field.
- `create_lsp` returns `host` in the response body.
- Added `DELETE /{project_id}/_internal/destroy` — internal endpoint for cross-machine
  destroy forwarding, protected by `X-LSP-Internal` header + optional `LSP_INTERNAL_SECRET`.

### `language-service/require.txt`

- Added `httpx` dependency for cross-machine HTTP forwarding.

### `docker-compose.yml`

- `WS_PUBLIC_HOST` now sourced from `${WS_PUBLIC_HOST}` env var (was `HOST_IP`).
- Added `REDIS_HOST`, `REDIS_PORT`, `REDIS_DB`, `LSP_INTERNAL_SECRET`, `PORT` env vars.
- `language-service` port changed from dynamic (`"8135"`) to fixed (`"${PORT:-8135}:8135"`).
- Projects volume changed from named volume (`projects_data`) to bind mount
  (`/home/projects:/home/projects`) for NFS compatibility.
- Removed `projects_data` from volumes section.
- Updated comments explaining single-machine vs multi-machine deployment.
- Redis service kept for single-machine deployments; comments show how to expose to network.

## Files Created

### `.env.multi`
Template with all environment variables needed for multi-machine deployment:
`WS_PUBLIC_HOST`, `REDIS_HOST`, `REDIS_PORT`, `PORT`, `LSP_INTERNAL_SECRET`, etc.

### `deploy-multi.sh`
Automated deployment script for each machine in the cluster. Validates:
- `.env` file exists and is configured
- Redis connectivity (`redis-cli ping`)
- NFS mount is active on `/home/projects`
- `lsp-multiplexor:latest` image exists (builds if missing)
- API health check after deployment

### `scripts/setup-nfs.sh`
Idempotent NFS configuration script with three modes:
- `server` — configures NFS server, creates export, configures firewall instructions
- `client <IP>` — configures NFS client, mounts share, persists in `/etc/fstab`, validates write
- `check` — diagnostics: IPs, packages, exports, mounts, fstab

### `tests/test_multi_machine.py`
Integration tests validating:
- Both machines respond to health checks.
- Creating on machine A and querying on machine B returns matching `ws_url` and `host`.
- Duplicate creation is prevented across machines (registry deduplication).
- Destroying from a different machine works (cross-machine forward).
- Global listing (`GET /lsp/`) sees containers from both machines.

### `scripts/test-multi-machine.sh`
Runner for the integration tests. Validates connectivity to both machines before
running pytest.

### `docs/multi-machine-setup.md`
Complete setup guide covering: NFS setup, Redis exposure, image distribution,
`.env` configuration, deployment, verification, load balancer configuration,
troubleshooting, and security notes.

## Test Instructions

### Prerequisites

1. **Redis accessible** from all test machines on the configured port.
2. **NFS mounted** on `/home/projects` on all test machines.
3. **Two machines** running LSP-Service with distinct `WS_PUBLIC_HOST` values.

### Setup (one-time)

```bash
# On the NFS server machine:
cd LSP-Service && sudo ./scripts/setup-nfs.sh server

# On each API machine:
cd LSP-Service && sudo ./scripts/setup-nfs.sh client <NFS_SERVER_IP>

# On the Redis machine:
docker run -d --name redis-lsp --restart unless-stopped \
  -p 0.0.0.0:6379:6379 redis:7-alpine \
  redis-server --save "" --appendonly no

# On each API machine — build LSP container image:
cd LSP-Service/lsp-container && docker build -t lsp-multiplexor:latest .

# On each API machine — configure and deploy:
cd LSP-Service
cp .env.multi .env
# Edit .env: set WS_PUBLIC_HOST to this machine's IP, REDIS_HOST to Redis IP
./deploy-multi.sh
```

### Run Tests

```bash
cd LSP-Service
TEST_HOST_A=http://10.0.0.1:8135 TEST_HOST_B=http://10.0.0.2:8135 \
  ./scripts/test-multi-machine.sh
```

### Expected Output

```
╔══════════════════════════════════════╗
║   LSP MULTI-MACHINE INTEGRATION TESTS ║
╠══════════════════════════════════════╣
║ Máquina A: http://10.0.0.1:8135
║ Máquina B: http://10.0.0.2:8135
╚══════════════════════════════════════╝

test_multi_machine.py::TestMultiMachineHealth::test_machine_a_healthy PASSED
test_multi_machine.py::TestMultiMachineHealth::test_machine_b_healthy PASSED
test_multi_machine.py::TestCreateAndQuery::test_create_on_a_returns_host_field PASSED
test_multi_machine.py::TestCreateAndQuery::test_query_on_b_sees_container_from_a PASSED
test_multi_machine.py::TestCreateAndQuery::test_create_duplicate_cross_machine_prevented PASSED
test_multi_machine.py::TestDestroy::test_destroy_from_other_machine PASSED
test_multi_machine.py::TestListAll::test_list_all_sees_both_machines PASSED

7 passed
```

### Manual Test Commands

```bash
# Create container on machine A
curl -s -X POST http://10.0.0.1:8135/lsp/test-manual \
  -H "Content-Type: application/json" \
  -d '{"language":"python"}' | python3 -m json.tool

# Query on machine B (should see same container)
curl -s http://10.0.0.2:8135/lsp/test-manual?language=python | python3 -m json.tool

# Destroy from machine B (cross-machine forward)
curl -s -X DELETE http://10.0.0.2:8135/lsp/test-manual?language=python

# Verify destroyed (from A)
curl -s http://10.0.0.1:8135/lsp/test-manual?language=python
# Expected: {"status": "not_found"}

# Check Redis registry
redis-cli -h <REDIS_IP> keys "lsp:container:*"
redis-cli -h <REDIS_IP> smembers lsp:instances
```

## Backward Compatibility

- **Single-machine deployment** (existing `docker compose up --scale`) continues to work
  unchanged. `WS_PUBLIC_HOST` defaults to `127.0.0.1`, Redis defaults to `redis-lsp`
  (Docker Compose internal DNS).
- The `host` field is added to registry entries but older entries without it are treated
  as local (`_is_local` returns `True` when `host` is missing).
- All existing API endpoints maintain the same contract; `host` is an additional field.
