#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_ENV_FILE="${WA_COMPOSE_ENV_FILE:-/srv/wa-savana/shared/production-compose.env}"

[[ -f "$COMPOSE_ENV_FILE" ]] || {
  printf 'Missing Compose environment file: %s\n' "$COMPOSE_ENV_FILE" >&2
  exit 2
}

data_dir="$(awk '
  index($0, "WA_DATA_DIR=") == 1 {
    print substr($0, length("WA_DATA_DIR=") + 1)
    found = 1
  }
  END { if (!found) exit 1 }
' "$COMPOSE_ENV_FILE")"
[[ "$data_dir" == /* && "$data_dir" != "/" && "$data_dir" != "/srv" ]] || {
  printf 'WA_DATA_DIR must be a narrow absolute path\n' >&2
  exit 2
}

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 0700 "$data_dir/backups"

docker exec wa-savana-server node --input-type=module -e '
  import Database from "better-sqlite3";
  const destination = `/app/data/backups/platform-${process.argv[1]}.db`;
  const database = new Database(process.env.DATABASE_PATH, { readonly: true });
  await database.backup(destination);
  database.close();
' "$timestamp"

gzip -f "$data_dir/backups/platform-${timestamp}.db"
sha256sum "$data_dir/backups/platform-${timestamp}.db.gz" \
  > "$data_dir/backups/platform-${timestamp}.db.gz.sha256"
printf 'Verified backup artifact created: %s\n' "$data_dir/backups/platform-${timestamp}.db.gz"
