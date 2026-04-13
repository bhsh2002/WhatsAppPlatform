#!/bin/bash
# ============================================
# Database Backup Script
# ============================================
# Creates a timestamped backup of the SQLite database.
# Run this before any risky operations or on a schedule.

set -e

DB_FILE="./db/platform.db"
BACKUP_DIR="./db/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Check if database exists
if [ ! -f "$DB_FILE" ]; then
    echo "ERROR: Database file not found: $DB_FILE"
    exit 1
fi

# Create backup
BACKUP_FILE="$BACKUP_DIR/platform_$TIMESTAMP.db"
sqlite3 "$DB_FILE" ".backup '$BACKUP_FILE'"

# Compress backup
gzip "$BACKUP_FILE"
BACKUP_FILE="${BACKUP_FILE}.gz"

echo "✓ Backup created: $BACKUP_FILE"
echo "  Size: $(du -h "$BACKUP_FILE" | cut -f1)"

# Keep only last 10 backups
echo ""
echo "Cleaning old backups (keeping last 10)..."
ls -t "$BACKUP_DIR"/*.gz 2>/dev/null | tail -n +11 | xargs rm -f 2>/dev/null || true
echo "✓ Cleanup complete"