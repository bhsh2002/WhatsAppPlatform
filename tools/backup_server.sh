#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p server/db/backups

docker exec wa-savana-server node --input-type=module -e '
  import Database from "better-sqlite3";
  const source = process.env.DATABASE_PATH;
  const destination = `/app/data/backups/platform-${process.argv[1]}.db`;
  const database = new Database(source, { readonly: true });
  await database.backup(destination);
  database.close();
' "$timestamp"

gzip -f "server/db/backups/platform-${timestamp}.db"
sha256sum "server/db/backups/platform-${timestamp}.db.gz" \
  > "server/db/backups/platform-${timestamp}.db.gz.sha256"
printf 'Backup created: %s\n' "$ROOT_DIR/server/db/backups/platform-${timestamp}.db.gz"
