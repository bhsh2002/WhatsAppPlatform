#!/bin/bash
# ============================================
# Production Deployment Script
# ============================================
# This script runs migrations WITHOUT replacing the database file.
# The database file should NEVER be uploaded/replaced in production.

set -e

echo "=== WhatsApp Platform Deployment ==="
echo ""

# Check for required environment variables
if [ -z "$JWT_SECRET" ]; then
    echo "ERROR: JWT_SECRET is not set"
    exit 1
fi

if [ -z "$CRYPTO_KEY" ]; then
    echo "ERROR: CRYPTO_KEY is not set"
    exit 1
fi

echo "✓ Environment variables validated"
echo ""

# Install dependencies
echo "Installing dependencies..."
npm install --production
echo "✓ Dependencies installed"
echo ""

# Run migrations (database file is NOT replaced)
echo "Running database migrations..."
node -e "
import('./db/migrator.js').then(m => {
    import('better-sqlite3').then(betterSqlite3 => {
        const db = betterSqlite3.default('./db/platform.db');
        const result = m.runMigrationsSync(db);
        console.log('Migrations complete:', result);
        db.close();
    });
});
"
echo "✓ Migrations complete"
echo ""

echo "=== Deployment Ready ==="
echo ""
echo "Important:"
echo "  • The platform.db file should NEVER be uploaded to production"
echo "  • Migrations run automatically on server startup"
echo "  • To backup: sqlite3 db/platform.db '.backup db/platform.db.backup'"
echo "  • To restore: Stop server, replace db/platform.db, start server"