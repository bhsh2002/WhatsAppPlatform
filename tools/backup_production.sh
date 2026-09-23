#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

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

[[ -d "$data_dir/backups" && -r "$data_dir/backups" && -w "$data_dir/backups" ]] || {
  printf 'Backup directory must exist and be readable/writable by the deployment operator\n' >&2
  exit 2
}

# The application backup utility performs SQLite online backup, quick_check,
# foreign_key_check, compression, a full decompression restore drill, and
# retention pruning. Parse only its stable result lines and independently
# confirm the archive checksum from the host-visible bind mount.
backup_output="$(docker exec wa-savana-server node scripts/backup-database.js)"
container_archive="$(awk -F': ' '/^Backup verified: / { print $2 }' <<<"$backup_output")"
reported_sha="$(awk -F': ' '/^SHA-256: / { print $2 }' <<<"$backup_output")"

case "$container_archive" in
  /app/data/backups/*.db.gz) ;;
  *)
    printf 'Backup utility returned an unexpected archive path\n' >&2
    exit 3
    ;;
esac
[[ "$reported_sha" =~ ^[0-9a-f]{64}$ ]] || {
  printf 'Backup utility returned an invalid SHA-256 digest\n' >&2
  exit 3
}

backup_archive="$data_dir/backups/${container_archive##*/}"
[[ -f "$backup_archive" && ! -L "$backup_archive" && -s "$backup_archive" ]] || {
  printf 'Verified backup archive is not available on the host bind mount\n' >&2
  exit 3
}
actual_sha="$(sha256sum "$backup_archive" | awk '{ print $1 }')"
[[ "$actual_sha" == "$reported_sha" ]] || {
  printf 'Verified backup archive checksum changed after creation\n' >&2
  exit 3
}

checksum_file="${backup_archive}.sha256"
printf '%s  %s\n' "$reported_sha" "$(basename "$backup_archive")" >"$checksum_file"
chmod 0640 "$backup_archive" "$checksum_file"
(
  cd "$data_dir/backups"
  sha256sum --check --status "$(basename "$checksum_file")"
)

printf 'WA_BACKUP_VERIFIED path=%s checksum=%s\n' "$backup_archive" "$checksum_file"
