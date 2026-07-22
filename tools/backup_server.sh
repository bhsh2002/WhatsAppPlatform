#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p data/backups

docker exec wa-savana-server node --input-type=module -e '
  import Database from "better-sqlite3";
  const source = process.env.DATABASE_PATH;
  const destination = `/app/data/backups/platform-${process.argv[1]}.db`;
  const database = new Database(source, { readonly: true });
  await database.backup(destination);
  database.close();
' "$timestamp"

gzip -f "data/backups/platform-${timestamp}.db"
sha256sum "data/backups/platform-${timestamp}.db.gz" \
  > "data/backups/platform-${timestamp}.db.gz.sha256"
printf 'Backup created: %s\n' "$ROOT_DIR/data/backups/platform-${timestamp}.db.gz"
