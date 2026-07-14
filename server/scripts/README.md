# Deployment Scripts

## Overview

The `platform.db` file contains all your data (tenants, users, messages, etc.) and should **NEVER be uploaded/replaced in production**. Doing so will:
1. Reset all data to the uploaded file's state
2. Lose any new data since that backup
3. Potentially cause migration conflicts

## Deployment Workflow

### Initial Setup
```bash
# 1. Generate missing local JWT, encryption, and first-admin bootstrap secrets
npm run setup:local

# 2. Start the server (migrations run automatically)
npm run dev
```

If the users table is empty, inspect the ignored local `.env` for the generated
`BOOTSTRAP_ADMIN_PASSWORD`, sign in as `admin`, rotate that password, then remove
the bootstrap value. Production should inject a chosen value from its secret
store. The server never prints it to logs.

### Regular Updates
```bash
# 1. Pull latest code
git pull

# 2. Install new dependencies
npm ci --omit=dev

# 3. Restart server (migrations run automatically)
# migrations are tracked in _migrations table, only new ones run
```

### Backup before Updates
```bash
# Create and restore-verify a timestamped backup
npm run backup

# Backups are stored in db/backups/
# Only the last 10 backups are kept automatically
```

The command uses SQLite's online backup API, runs `quick_check` and
`foreign_key_check`, compresses the snapshot, restores it to a private temporary
directory, checks it again, and prints a SHA-256 digest. Override locations and
retention with `DATABASE_PATH`, `BACKUP_DIR`, and `BACKUP_RETENTION`.

## Scripts

| Script | Purpose |
|--------|---------|
| `deploy.sh` | Production deployment (migrations only) |
| `backup.sh` | Compatibility wrapper for the verified Node backup workflow |
| `backup-database.js` | Create, validate, compress, restore-check, and retain backups |
| `verify-backup.js` | Restore an archive to a temporary directory and validate it |
| `ensure-local-secrets.js` | Add missing secrets for a fresh local database without printing values |
| `migrate-sensitive-credentials.js` | Dry-run report for plaintext credentials |

### Sensitive credential migration

Run the report first:

```bash
npm run migrate:credentials
```

After creating and verifying a database backup, apply the migration explicitly:

```bash
node scripts/migrate-sensitive-credentials.js --apply --backup-confirmed
```

The command encrypts legacy Meta tokens and webhook secrets, converts plaintext
API keys to indexed SHA-256 digests, and clears the plaintext columns. Existing
bcrypt API-key hashes cannot be converted without the original key and must be
rotated through the tenant portal.

## Migration System

Migrations are stored in `db/migrations/` and run automatically on server startup. The `_migrations` table tracks which ones have been applied:

- Migration files numbered sequentially: `001_*.sql`, `002_*.sql`, etc.
- Each runs once, then is recorded in `_migrations`
- Skipped if already applied

## Recovery

Verify an archive before any recovery:

```bash
npm run verify:backup -- db/backups/platform_TIMESTAMP.db.gz
```

Then restore without overwriting the live database in place:

```bash
# 1. STOP the server and confirm no process has platform.db open.
# 2. Restore to a separate path.
gunzip -c db/backups/platform_TIMESTAMP.db.gz > db/platform.restore.db

# 3. Keep platform.db as a rollback copy, atomically rename the verified
#    restore into place, preserve ownership/mode, and start the server.
# 4. Verify /health and critical tenant data before accepting writes.
```

The built-in retention covers local archives only. Production must schedule the
command and copy archives to encrypted off-host storage with an independently
managed retention policy.

## What NOT to Do

❌ Don't upload `platform.db` to production
❌ Don't copy `platform.db` between environments
❌ Don't commit `platform.db` to git (it's in `.gitignore`)
❌ Don't run migrations manually (they run on startup)
