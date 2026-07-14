#!/bin/sh
# Compatibility wrapper. The Node implementation uses SQLite online backup,
# validates the database before compression, and performs a restore drill.

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$SCRIPT_DIR/backup-database.js"
