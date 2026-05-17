-- ============================================
-- Migration 008: Allow Pending tenant status
-- ============================================
-- SQLite doesn't support ALTER CHECK constraint directly.
-- Since CHECK constraints in SQLite are enforced at row level,
-- we need to recreate the table. However, the existing CHECK
-- was defined with CREATE TABLE IF NOT EXISTS which is already applied.
-- 
-- Workaround: SQLite doesn't enforce CHECK on ALTER TABLE,
-- and the CHECK was on the initial CREATE. We need to just ensure
-- new inserts with 'Pending' work by disabling the check.
-- 
-- Actually, the simplest approach: drop and recreate the constraint
-- by rebuilding the table.

-- Step 1: Create new table with updated CHECK
CREATE TABLE IF NOT EXISTS tenants_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT UNIQUE,
    status TEXT DEFAULT 'Active' CHECK(status IN ('Active', 'Warning', 'Suspended', 'Pending')),
    tier TEXT DEFAULT '1K',
    credits INTEGER DEFAULT 0,
    quality TEXT DEFAULT 'High' CHECK(quality IN ('High', 'Medium', 'Low')),
    phone_number_id TEXT,
    access_token TEXT,
    webhook_secret TEXT,
    waba_id TEXT,
    business_id TEXT,
    dataset_id TEXT,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
);

-- Step 2: Copy data
INSERT INTO tenants_new SELECT * FROM tenants;

-- Step 3: Drop old table
DROP TABLE tenants;

-- Step 4: Rename new table
ALTER TABLE tenants_new RENAME TO tenants
