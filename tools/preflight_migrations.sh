#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

[[ $# -eq 3 ]] \
  || fail 'Usage: preflight_migrations.sh <verified-backup.db.gz> <server-image> <data-dir>'

backup_archive="$1"
server_image="$2"
data_dir="$3"
backup_checksum="${backup_archive}.sha256"

[[ "$data_dir" == /* && "$data_dir" != / && "$data_dir" != /srv ]] \
  || fail 'Data directory must be a narrow absolute path'
case "$backup_archive" in
  "$data_dir"/backups/*.db.gz) ;;
  *) fail 'Migration preflight backup is outside the Wa backup directory' ;;
esac
[[ -f "$backup_archive" && ! -L "$backup_archive" && -s "$backup_archive" ]] \
  || fail 'Migration preflight backup is missing or unsafe'
[[ -f "$backup_checksum" && ! -L "$backup_checksum" && -s "$backup_checksum" ]] \
  || fail 'Migration preflight checksum is missing or unsafe'
[[ "$server_image" =~ ^ghcr\.io/bhsh2002/savana-wa-server@sha256:[0-9a-f]{64}$ ]] \
  || fail 'Migration preflight requires the immutable Wa server image'

checksum_directory="$(dirname "$backup_checksum")"
checksum_name="$(basename "$backup_checksum")"
(
  cd "$checksum_directory"
  sha256sum --check --status "$checksum_name"
) || fail 'Migration preflight backup checksum failed'
gzip --test -- "$backup_archive" \
  || fail 'Migration preflight backup compression check failed'

preflight_dir=''
cleanup_preflight() {
  if [[ -z "$preflight_dir" ]]; then
    return
  fi
  case "$preflight_dir" in
    /tmp/wa-migration-preflight.*)
      rm -f -- \
        "$preflight_dir/platform.db" \
        "$preflight_dir/platform.db-wal" \
        "$preflight_dir/platform.db-shm"
      rmdir -- "$preflight_dir"
      ;;
    *) printf 'Refusing to clean an unexpected preflight path\n' >&2 ;;
  esac
}
trap cleanup_preflight EXIT

deployment_gid="$(id -g)"
preflight_dir="$(mktemp -d /tmp/wa-migration-preflight.XXXXXX)"
chmod 0770 "$preflight_dir"
gzip --decompress --stdout -- "$backup_archive" >"$preflight_dir/platform.db"
chmod 0660 "$preflight_dir/platform.db"

docker run --rm \
  --network none \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --user "1000:${deployment_gid}" \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16m \
  --volume "${preflight_dir}:/preflight:Z" \
  --env PREFLIGHT_DB=/preflight/platform.db \
  "$server_image" \
  node --input-type=module -e '
    import Database from "better-sqlite3";
    import { configureDatabaseConnection } from "./db/configure.js";
    import { getMigrationStatusSync, runMigrationsSync } from "./db/migrator.js";

    const database = new Database(process.env.PREFLIGHT_DB, { fileMustExist: true });
    try {
      configureDatabaseConnection(database);
      runMigrationsSync(database);
      const status = getMigrationStatusSync(database);
      if (status.pending !== 0 || status.applied !== status.total) {
        throw new Error("Migration preflight left pending migrations");
      }
      database.pragma("wal_checkpoint(TRUNCATE)");
      if (database.pragma("quick_check", { simple: true }) !== "ok") {
        throw new Error("SQLite quick_check failed after migration preflight");
      }
      if (database.pragma("foreign_key_check").length !== 0) {
        throw new Error("SQLite foreign_key_check failed after migration preflight");
      }
    } finally {
      database.close();
    }
  '

printf 'WA_MIGRATIONS_PREFLIGHT_OK image=%s\n' "$server_image"
