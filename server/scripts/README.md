# Deployment Scripts

## Overview

The `platform.db` file contains all your data (tenants, users, messages, etc.) and should **NEVER be uploaded/replaced in production**. Doing so will:
1. Reset all data to the uploaded file's state
2. Lose any new data since that backup
3. Potentially cause migration conflicts

## Deployment Workflow

### Initial Setup
```bash
# 1. Set environment variables
export JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
export CRYPTO_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# 2. Start the server (migrations run automatically)
npm run dev
```

### Regular Updates
```bash
# 1. Pull latest code
git pull

# 2. Install new dependencies
npm install --production

# 3. Restart server (migrations run automatically)
# migrations are tracked in _migrations table, only new ones run
```

### Backup before Updates
```bash
# Create a timestamped backup
./scripts/backup.sh

# Backups are stored in db/backups/
# Only the last 10 backups are kept automatically
```

## Scripts

| Script | Purpose |
|--------|---------|
| `deploy.sh` | Production deployment (migrations only) |
| `backup.sh` | Create timestamped database backup |

## Migration System

Migrations are stored in `db/migrations/` and run automatically on server startup. The `_migrations` table tracks which ones have been applied:

- Migration files numbered sequentially: `001_*.sql`, `002_*.sql`, etc.
- Each runs once, then is recorded in `_migrations`
- Skipped if already applied

## Recovery

If you accidentally replace the database:
```bash
# 1. STOP the server immediately
# 2. Restore from backup:
gunzip -c db/backups/platform_TIMESTAMP.db.gz > db/platform.db

# 3. Restart server
npm run dev
```

## What NOT to Do

❌ Don't upload `platform.db` to production
❌ Don't copy `platform.db` between environments
❌ Don't commit `platform.db` to git (it's in `.gitignore`)
❌ Don't run migrations manually (they run on startup)