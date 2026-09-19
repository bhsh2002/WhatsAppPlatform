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

require_private_file "$COMPOSE_ENV_FILE"

runtime_env="$(env_value WA_RUNTIME_ENV_FILE "$COMPOSE_ENV_FILE")"
data_dir="$(env_value WA_DATA_DIR "$COMPOSE_ENV_FILE")"
uploads_dir="$(env_value WA_UPLOADS_DIR "$COMPOSE_ENV_FILE")"
release_sha="$(env_value WA_RELEASE_SHA "$COMPOSE_ENV_FILE")"

require_private_file "$runtime_env"
require_absolute_data_dir "$data_dir" WA_DATA_DIR
require_absolute_data_dir "$uploads_dir" WA_UPLOADS_DIR
require_shared_data_dir "$data_dir" WA_DATA_DIR
require_shared_data_dir "$data_dir/backups" WA_BACKUP_DIR
require_shared_data_dir "$uploads_dir" WA_UPLOADS_DIR
[[ "$release_sha" =~ ^[0-9a-f]{40}$ ]] || fail "WA_RELEASE_SHA must be a full 40-character Git commit"
docker network inspect savana-control-plane-network >/dev/null \
  || fail "The savana-control-plane-network Docker network does not exist"

compose=(docker compose --env-file "$COMPOSE_ENV_FILE" -f "$COMPOSE_FILE")
"${compose[@]}" config --quiet

server_image="$("${compose[@]}" config --format json \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["server"]["image"])')"
client_image="$("${compose[@]}" config --format json \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["client"]["image"])')"
server_digest_pattern='^ghcr\.io/bhsh2002/wa-savana-server@sha256:[0-9a-f]{64}$'
client_digest_pattern='^ghcr\.io/bhsh2002/wa-savana-client@sha256:[0-9a-f]{64}$'
[[ "$server_image" =~ $server_digest_pattern ]] \
  || fail "WA_SERVER_IMAGE_DIGEST must resolve to the immutable wa-savana-server GHCR image"
[[ "$client_image" =~ $client_digest_pattern ]] \
  || fail "WA_CLIENT_IMAGE_DIGEST must resolve to the immutable wa-savana-client GHCR image"
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

if [[ -f "$data_dir/platform.db" ]] && docker inspect wa-savana-server >/dev/null 2>&1; then
  WA_COMPOSE_ENV_FILE="$COMPOSE_ENV_FILE" "$ROOT_DIR/tools/backup_production.sh"
fi

"${compose[@]}" up -d --remove-orphans --wait --wait-timeout 300

curl --fail --silent --show-error --max-time 10 \
  "http://127.0.0.1:3133/api/health" >/dev/null

docker exec wa-savana-server node --input-type=module -e '
  const response = await fetch("http://127.0.0.1:3031/metrics", {
    headers: { Authorization: `Bearer ${process.env.METRICS_TOKEN}` },
  });
  if (!response.ok || !(await response.text()).includes("whatsapp_process_uptime_seconds")) {
    process.exit(1);
  }
'

"${compose[@]}" ps
printf 'Wa Savana passed loopback health and authenticated metrics checks.\n'
