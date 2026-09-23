#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.production.yml"
COMPOSE_ENV_FILE="${WA_COMPOSE_ENV_FILE:-/srv/wa-savana/shared/production-compose.env}"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

env_value() {
  local key="$1"
  local file="$2"
  awk -v key="$key" '
    index($0, key "=") == 1 {
      value = substr($0, length(key) + 2)
      sub(/\r$/, "", value)
      print value
      found = 1
    }
    END { if (!found) exit 1 }
  ' "$file"
}

require_private_file() {
  local file="$1"
  [[ -f "$file" ]] || fail "Missing required file: $file"
  local mode
  mode="$(stat -c '%a' "$file")"
  [[ "${mode: -2}" == "00" ]] || fail "$file must not be readable or writable by group/others"
}

require_absolute_data_dir() {
  local directory="$1"
  local name="$2"
  [[ "$directory" == /* ]] || fail "$name must be an absolute path"
  [[ "$directory" != "/" && "$directory" != "/srv" ]] || fail "$name is too broad"
}

require_shared_data_dir() {
  local directory="$1"
  local name="$2"
  local expected_group
  local owner
  local group
  local mode

  [[ -d "$directory" ]] || fail "$name does not exist; create it during one-time host preparation"
  expected_group="$(id -g)"
  owner="$(stat -c '%u' "$directory")"
  group="$(stat -c '%g' "$directory")"
  mode="$(stat -c '%a' "$directory")"
  [[ "$owner" == "1000" ]] || fail "$name must be owned by container UID 1000"
  [[ "$group" == "$expected_group" ]] || fail "$name must use the deployment operator's primary group"
  [[ "$mode" == "2770" ]] || fail "$name must have mode 2770 so backups remain operator-accessible"
  [[ -r "$directory" && -w "$directory" && -x "$directory" ]] \
    || fail "$name is not accessible to the deployment operator"
}

require_release_checkout() {
  local release_sha="$1"
  local checkout_sha
  local checkout_status

  if ! command -v git >/dev/null 2>&1 \
    || ! checkout_sha="$(git -C "$ROOT_DIR" rev-parse --verify HEAD 2>/dev/null)"; then
    printf '%s\n' \
      'WARNING: Release source is not a Git checkout; relying on immutable OCI revision labels.' >&2
    return
  fi
  [[ "$checkout_sha" == "$release_sha" ]] \
    || fail "Release checkout HEAD does not match WA_RELEASE_SHA"

  checkout_status="$(git -C "$ROOT_DIR" status --porcelain=v1 --untracked-files=all)"
  [[ -z "$checkout_status" ]] \
    || fail "Release checkout must be clean before deployment"
}

enabled_value() {
  case "${1,,}" in
    1|true) return 0 ;;
    *) return 1 ;;
  esac
}

header_value() {
  local name="$1"
  local file="$2"
  awk -v expected="$name" '
    BEGIN { expected = tolower(expected) }
    {
      line = $0
      sub(/\r$/, "", line)
      separator = index(line, ":")
      if (separator > 0 && tolower(substr(line, 1, separator - 1)) == expected) {
        value = substr(line, separator + 1)
        sub(/^[[:space:]]+/, "", value)
      }
    }
    END { if (value != "") print value }
  ' "$file"
}

verify_pwa_asset() {
  local asset_path="$1"
  local asset_kind="$2"
  local headers_file="$3"
  local body_file="$4"
  local status
  local content_type
  local cache_control

  if ! status="$(curl --proto '=http' --silent --show-error --max-time 10 \
    --dump-header "$headers_file" \
    --output "$body_file" \
    --write-out '%{http_code}' \
    "http://127.0.0.1:3133${asset_path}")"; then
    fail "Unable to fetch production PWA asset ${asset_path}"
  fi
  [[ "$status" == "200" ]] \
    || fail "Production PWA asset ${asset_path} returned HTTP ${status}"
  [[ -s "$body_file" ]] \
    || fail "Production PWA asset ${asset_path} is empty"

  content_type="$(header_value Content-Type "$headers_file" | tr '[:upper:]' '[:lower:]')"
  case "$asset_kind:$content_type" in
    manifest:application/manifest+json*|manifest:application/json*) ;;
    worker:application/javascript*|worker:text/javascript*) ;;
    *) fail "Production PWA asset ${asset_path} returned unexpected Content-Type" ;;
  esac

  cache_control="$(header_value Cache-Control "$headers_file" | tr '[:upper:]' '[:lower:]')"
  [[ -n "$cache_control" ]] \
    || fail "Production PWA asset ${asset_path} is missing Cache-Control"
  case "$cache_control" in
    *no-cache*|*no-store*) ;;
    *) fail "Production PWA asset ${asset_path} must require cache revalidation" ;;
  esac
  [[ "$cache_control" != *immutable* ]] \
    || fail "Production PWA asset ${asset_path} must not be immutable"

  if grep -aEiq '<!doctype[[:space:]]+html|<html([[:space:]>])' "$body_file"; then
    fail "Production PWA asset ${asset_path} incorrectly returned the SPA HTML fallback"
  fi

  if [[ "$asset_kind" == "manifest" ]]; then
    python3 - "$body_file" <<'PY' \
      || fail "Production web app manifest is not valid installable JSON"
import json
import sys

with open(sys.argv[1], encoding="utf-8") as manifest_file:
    manifest = json.load(manifest_file)

required_strings = ("name", "short_name", "start_url", "display")
if any(not isinstance(manifest.get(field), str) or not manifest[field].strip()
       for field in required_strings):
    raise SystemExit(1)
if not isinstance(manifest.get("icons"), list) or not manifest["icons"]:
    raise SystemExit(1)
PY
  fi
}

require_private_file "$COMPOSE_ENV_FILE"

runtime_env="$(env_value WA_RUNTIME_ENV_FILE "$COMPOSE_ENV_FILE")"
data_dir="$(env_value WA_DATA_DIR "$COMPOSE_ENV_FILE")"
uploads_dir="$(env_value WA_UPLOADS_DIR "$COMPOSE_ENV_FILE")"
release_sha="$(env_value WA_RELEASE_SHA "$COMPOSE_ENV_FILE")"
require_web_push="${WA_REQUIRE_WEB_PUSH:-false}"
recovery_mode="${WA_DEPLOY_RECOVERY_MODE:-}"

case "${require_web_push,,}" in
  0|false) web_push_required=0 ;;
  1|true) web_push_required=1 ;;
  *) fail "WA_REQUIRE_WEB_PUSH must be true, false, 1, or 0" ;;
esac

case "$recovery_mode" in
  '') ;;
  verified-database-restore) ;;
  *) fail "WA_DEPLOY_RECOVERY_MODE must be empty or verified-database-restore" ;;
esac

require_private_file "$runtime_env"
if (( web_push_required )); then
  web_push_enabled="$(env_value WEB_PUSH_ENABLED "$runtime_env" 2>/dev/null || true)"
  enabled_value "$web_push_enabled" \
    || fail "This release requires WEB_PUSH_ENABLED=true"
fi
require_absolute_data_dir "$data_dir" WA_DATA_DIR
require_absolute_data_dir "$uploads_dir" WA_UPLOADS_DIR
require_shared_data_dir "$data_dir" WA_DATA_DIR
require_shared_data_dir "$data_dir/backups" WA_BACKUP_DIR
require_shared_data_dir "$uploads_dir" WA_UPLOADS_DIR
[[ "$release_sha" =~ ^[0-9a-f]{40}$ ]] || fail "WA_RELEASE_SHA must be a full 40-character Git commit"
require_release_checkout "$release_sha"
docker network inspect savana-control-plane-network >/dev/null \
  || fail "The savana-control-plane-network Docker network does not exist"

compose=(docker compose --env-file "$COMPOSE_ENV_FILE" -f "$COMPOSE_FILE")
"${compose[@]}" config --quiet

server_image="$("${compose[@]}" config --format json \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["server"]["image"])')"
client_image="$("${compose[@]}" config --format json \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["client"]["image"])')"
server_digest_pattern='^ghcr\.io/bhsh2002/savana-wa-server@sha256:[0-9a-f]{64}$'
client_digest_pattern='^ghcr\.io/bhsh2002/savana-wa-client@sha256:[0-9a-f]{64}$'
[[ "$server_image" =~ $server_digest_pattern ]] \
  || fail "WA_SERVER_IMAGE_DIGEST must resolve to the immutable savana-wa-server GHCR image"
[[ "$client_image" =~ $client_digest_pattern ]] \
  || fail "WA_CLIENT_IMAGE_DIGEST must resolve to the immutable savana-wa-client GHCR image"
[[ "$server_image" != *"sha256:0000000000000000000000000000000000000000000000000000000000000000" ]] \
  || fail "WA_SERVER_IMAGE_DIGEST still contains the example digest"
[[ "$client_image" != *"sha256:0000000000000000000000000000000000000000000000000000000000000000" ]] \
  || fail "WA_CLIENT_IMAGE_DIGEST still contains the example digest"

"${compose[@]}" pull

server_revision="$(docker image inspect \
  --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' \
  "$server_image")"
client_revision="$(docker image inspect \
  --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' \
  "$client_image")"
[[ "$server_revision" == "$release_sha" ]] \
  || fail "Server image revision label does not match WA_RELEASE_SHA"
[[ "$client_revision" == "$release_sha" ]] \
  || fail "Client image revision label does not match WA_RELEASE_SHA"

docker run --rm \
  --network none \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --env-file "$runtime_env" \
  "$server_image" \
  node scripts/check-production-env.js

database_path="$data_dir/platform.db"
database_present=0
if [[ -e "$database_path" || -L "$database_path" ]]; then
  [[ -f "$database_path" && ! -L "$database_path" ]] \
    || fail 'Wa database path exists but is not a safe regular file'
  database_present=1
fi

server_container_present=0
server_container_running=0
if docker inspect wa-savana-server >/dev/null 2>&1; then
  server_container_present=1
  if [[ "$(docker inspect -f '{{.State.Running}}' wa-savana-server)" == true ]]; then
    server_container_running=1
  fi
fi

if [[ "$recovery_mode" == verified-database-restore ]]; then
  (( database_present == 1 )) \
    || fail 'Recovery mode requires a verified restored Wa database'
  (( server_container_present == 0 )) \
    || fail 'Recovery mode requires the prior wa-savana-server container to be absent'
  printf '%s\n' \
    'Recovery mode: starting from an explicitly verified restored database without an online backup.' >&2
else
  (( database_present == server_container_present )) \
    || fail 'Unsafe Wa state: platform.db and wa-savana-server must either both exist or both be absent'
fi

if (( database_present == 1 && server_container_present == 1 )); then
  (( server_container_running == 1 )) \
    || fail 'Existing Wa database requires the current wa-savana-server container to be running'
  backup_output="$(WA_COMPOSE_ENV_FILE="$COMPOSE_ENV_FILE" \
    "$ROOT_DIR/tools/backup_production.sh")"
  backup_archive="$(awk -F'[ =]' '
    /^WA_BACKUP_VERIFIED / {
      for (index = 1; index <= NF; index += 1) {
        if ($index == "path") {
          print $(index + 1)
          found = 1
          exit
        }
      }
    }
    END { if (!found) exit 1 }
  ' <<<"$backup_output")" \
    || fail 'Production backup did not return a verified archive path'
  "$ROOT_DIR/tools/preflight_migrations.sh" \
    "$backup_archive" "$server_image" "$data_dir"
fi

"${compose[@]}" up -d --remove-orphans --wait --wait-timeout 300

curl --fail --silent --show-error --max-time 10 \
  "http://127.0.0.1:3133/api/health" >/dev/null

if (( web_push_required )); then
  docker exec wa-savana-server node --input-type=module -e '
    import { webPushConfigFromEnv } from "./services/webPush.js";
    const config = webPushConfigFromEnv(process.env);
    if (!config.enabled || !config.publicKey || !config.privateKey || !config.subject) {
      process.exit(1);
    }
  ' || fail "Running Wa server did not enable the required Web Push configuration"
fi

pwa_headers="$(mktemp)"
pwa_body="$(mktemp)"
cleanup_pwa_smoke() {
  rm -f -- "$pwa_headers" "$pwa_body"
}
trap cleanup_pwa_smoke EXIT
verify_pwa_asset /manifest.webmanifest manifest "$pwa_headers" "$pwa_body"
verify_pwa_asset /sw.js worker "$pwa_headers" "$pwa_body"

docker exec wa-savana-server node --input-type=module -e '
  const response = await fetch("http://127.0.0.1:3031/metrics", {
    headers: { Authorization: `Bearer ${process.env.METRICS_TOKEN}` },
  });
  if (!response.ok || !(await response.text()).includes("whatsapp_process_uptime_seconds")) {
    process.exit(1);
  }
'

"${compose[@]}" ps
printf 'Wa Savana passed loopback health, PWA asset and authenticated metrics checks.\n'
