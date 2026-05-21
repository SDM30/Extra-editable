#!/usr/bin/env bash

set -uo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:8000/api}"
CODE_EXEC_URL="${CODE_EXEC_URL:-http://localhost:8081}"
COLLAB_LB_URL="${COLLAB_LB_URL:-http://localhost:8083}"
LSP_LB_URL="${LSP_LB_URL:-http://localhost:8085}"
COLLAB_SERVICE_URL="${COLLAB_SERVICE_URL:-http://localhost:8083}"
SMOKE_USERNAME="${SMOKE_USERNAME:-samuel}"
SMOKE_PASSWORD="${SMOKE_PASSWORD:-User1234!}"
if command -v curl.exe >/dev/null 2>&1; then
  CURL_BIN="curl.exe"
else
  CURL_BIN="curl"
fi

pass_count=0
fail_count=0
project_id=""
access_token=""
lsp_token=""
PYTHON_BIN="${PYTHON_BIN:-python3}"

log_pass() {
  pass_count=$((pass_count + 1))
  printf 'PASS %s\n' "$1"
}

log_fail() {
  fail_count=$((fail_count + 1))
  printf 'FAIL %s\n' "$1"
  if [ -n "${2:-}" ]; then
    printf '%s\n' "$2"
  fi
}

request() {
  local method="$1"
  local url="$2"
  local data="${3:-}"
  local auth_header="${4:-}"

  response="$($PYTHON_BIN - "$method" "$url" "$data" "$auth_header" <<'PY'
import json
import sys
import urllib.error
import urllib.request

method = sys.argv[1]
url = sys.argv[2]
data = sys.argv[3]
auth_header = sys.argv[4]

headers = {}
body = None

if data:
    headers['Content-Type'] = 'application/json'
    body = data.encode('utf-8')

if auth_header:
    name, _, value = auth_header.partition(':')
    if _:
        headers[name.strip()] = value.strip()

request = urllib.request.Request(url, data=body, headers=headers, method=method)

try:
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = response.read().decode('utf-8', errors='replace')
        sys.stdout.write(payload)
        sys.stdout.write(f"\n__HTTP_STATUS__{response.status}")
except urllib.error.HTTPError as exc:
    payload = exc.read().decode('utf-8', errors='replace')
    sys.stdout.write(payload)
    sys.stdout.write(f"\n__HTTP_STATUS__{exc.code}")
except Exception as exc:
    sys.stdout.write(str(exc))
    sys.stdout.write("\n__HTTP_STATUS__000")
PY
  )"

  RESPONSE_STATUS="${response##*__HTTP_STATUS__}"
  RESPONSE_BODY="${response%$'\n__HTTP_STATUS__'*}"
  if [ "$RESPONSE_STATUS" = "$response" ]; then
    RESPONSE_STATUS="000"
    RESPONSE_BODY="$response"
  fi
}

json_field() {
  local field="$1"
  local json_input="$2"
  JSON_INPUT="$json_input" "$PYTHON_BIN" - "$field" <<'PY'
import json
import os
import sys

field = sys.argv[1]
payload = json.loads(os.environ.get('JSON_INPUT', ''))

value = payload
for part in field.split('.'):
    if isinstance(value, dict):
        value = value.get(part)
    else:
        value = None
        break

if value is None:
    print('')
elif isinstance(value, (dict, list)):
    print(json.dumps(value, ensure_ascii=False))
else:
    print(value)
PY
}

expect_status() {
  local expected="$1"
  local label="$2"
  if [ "$RESPONSE_STATUS" = "$expected" ]; then
    log_pass "$label"
    return 0
  fi

  log_fail "$label" "Expected HTTP $expected, got $RESPONSE_STATUS. Body: $RESPONSE_BODY"
  return 1
}

cleanup() {
  if [ -n "$project_id" ] && [ -n "$access_token" ]; then
    request DELETE "$API_BASE_URL/projects/$project_id/" '' "Authorization: Bearer $access_token"
  fi
}

trap cleanup EXIT

printf 'Running smoke checks against:\n'
printf '  code-execution: %s\n' "$CODE_EXEC_URL"
printf '  collab-lb:      %s\n' "$COLLAB_LB_URL"
printf '  lsp-lb:         %s\n' "$LSP_LB_URL"
printf '  api:            %s\n' "$API_BASE_URL"

# 1. Code execution service health
request GET "$CODE_EXEC_URL/health"
if expect_status 200 '1. code-execution health'; then
  if JSON_INPUT="$RESPONSE_BODY" "$PYTHON_BIN" - <<'PY'
import json
import os

data = json.loads(os.environ.get('JSON_INPUT', ''))
raise SystemExit(0 if data.get('status') == 'ok' else 1)
PY
  then
    :
  else
    log_fail '1. code-execution health' "Unexpected body: $RESPONSE_BODY"
  fi
fi

# 2. Collab load balancer health
request GET "$COLLAB_LB_URL/health"
if expect_status 200 '2. collab load-balancer health'; then
  if JSON_INPUT="$RESPONSE_BODY" "$PYTHON_BIN" - <<'PY'
import json
import os

data = json.loads(os.environ.get('JSON_INPUT', ''))
expected = {'status': 'ok', 'service': 'collab-load-balancer'}
raise SystemExit(0 if all(data.get(k) == v for k, v in expected.items()) else 1)
PY
  then
    :
  else
    log_fail '2. collab load-balancer health' "Unexpected body: $RESPONSE_BODY"
  fi
fi

# 3. LSP load balancer health
request GET "$LSP_LB_URL/health"
if expect_status 200 '3. lsp load-balancer health'; then
  if JSON_INPUT="$RESPONSE_BODY" "$PYTHON_BIN" - <<'PY'
import json
import os

data = json.loads(os.environ.get('JSON_INPUT', ''))
expected = {'status': 'ok', 'service': 'lsp-load-balancer'}
raise SystemExit(0 if all(data.get(k) == v for k, v in expected.items()) else 1)
PY
  then
    :
  else
    log_fail '3. lsp load-balancer health' "Unexpected body: $RESPONSE_BODY"
  fi
fi

# 4. Login and collect access token
request POST "$API_BASE_URL/auth/login/" '{"username":"'"$SMOKE_USERNAME"'","password":"'"$SMOKE_PASSWORD"'"}'
if expect_status 200 '4. login'; then
  access_token="$(json_field access "$RESPONSE_BODY")"
  if [ -n "$access_token" ]; then
    :
  else
    log_fail '4. login' "Missing access token in response: $RESPONSE_BODY"
  fi
fi

# 5. Verify authenticated /me
if [ -n "$access_token" ]; then
  request GET "$API_BASE_URL/auth/me/" '' "Authorization: Bearer $access_token"
  if expect_status 200 '5. auth me'; then
    user_name="$(json_field username "$RESPONSE_BODY")"
    if [ "$user_name" = "$SMOKE_USERNAME" ]; then
      :
    else
      log_fail '5. auth me' "Unexpected username in response: $RESPONSE_BODY"
    fi
  fi
else
  log_fail '5. auth me' 'Skipping because login did not return a token'
fi

# 6. List projects
if [ -n "$access_token" ]; then
  request GET "$API_BASE_URL/projects/" '' "Authorization: Bearer $access_token"
  expect_status 200 '6. list projects'
else
  log_fail '6. list projects' 'Skipping because login did not return a token'
fi

# Create a temporary project for the LSP smoke checks.
if [ -n "$access_token" ]; then
  smoke_project_name="smoke-project-$(date +%s%N)"
  request POST "$API_BASE_URL/projects/" '{"nombre":"'"$smoke_project_name"'","descripcion":"smoke test project","lenguaje":"PYTHON"}' "Authorization: Bearer $access_token"
  if expect_status 201 'smoke setup. create project'; then
    project_id="$(json_field id "$RESPONSE_BODY")"
    if [ -z "$project_id" ]; then
      printf 'NOTE smoke setup. create project: Missing project id: %s\n' "$RESPONSE_BODY"
    fi
  fi
fi

if [ -n "$project_id" ] && [ -n "$access_token" ]; then
  request POST "$API_BASE_URL/projects/$project_id/lsp/token/" '' "Authorization: Bearer $access_token"
  if expect_status 200 'smoke setup. lsp token'; then
    lsp_token="$(json_field token "$RESPONSE_BODY")"
    if [ -z "$lsp_token" ]; then
      printf 'NOTE smoke setup. lsp token: Missing LSP token: %s\n' "$RESPONSE_BODY"
    fi
  fi
else
  printf 'NOTE smoke setup. lsp token: Skipping because project creation failed\n'
fi

# 7. Create LSP container for the temporary project.
if [ -n "$project_id" ] && [ -n "$lsp_token" ]; then
  request POST "$LSP_LB_URL/lsp/$project_id" '{"language":"python"}' "Authorization: Bearer $lsp_token"
  if expect_status 200 '7. create LSP container'; then
    ws_url="$(json_field ws_url "$RESPONSE_BODY")"
    if [ -n "$ws_url" ]; then
      :
    else
      log_fail '7. create LSP container' "Missing ws_url: $RESPONSE_BODY"
    fi
  fi
else
  log_fail '7. create LSP container' 'Skipping because LSP token is missing'
fi

# 8. Check LSP status.
if [ -n "$project_id" ] && [ -n "$lsp_token" ]; then
  request GET "$LSP_LB_URL/lsp/$project_id?language=python" '' "Authorization: Bearer $lsp_token"
  expect_status 200 '8. get LSP status'
else
  log_fail '8. get LSP status' 'Skipping because LSP token is missing'
fi

# 9. Destroy the LSP container.
if [ -n "$project_id" ] && [ -n "$lsp_token" ]; then
  request DELETE "$LSP_LB_URL/lsp/$project_id?language=python" '' "Authorization: Bearer $lsp_token"
  expect_status 200 '9. delete LSP container'
else
  log_fail '9. delete LSP container' 'Skipping because LSP token is missing'
fi

# 10. Collab service dev-token endpoint.
request POST "$COLLAB_SERVICE_URL/dev-token" '{"userId":"user-001","username":"samuel"}'
if expect_status 200 '10. collab dev-token'; then
  collab_token="$(json_field token "$RESPONSE_BODY")"
  if [ -n "$collab_token" ]; then
    :
  else
    log_fail '10. collab dev-token' "Missing token in response: $RESPONSE_BODY"
  fi
fi

printf '\nSmoke summary: %s passed, %s failed\n' "$pass_count" "$fail_count"

if [ "$fail_count" -ne 0 ]; then
  exit 1
fi

exit 0