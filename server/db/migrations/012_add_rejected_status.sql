-- ============================================
-- Migration 012: Add Rejected tenant status
-- ============================================
-- Allows tenants to have status = 'Rejected'

-- SQLite requires table rebuild to modify CHECK constraints
CREATE TABLE IF NOT EXISTS tenants_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT UNIQUE,
    status TEXT DEFAULT 'Active' CHECK(status IN ('Active', 'Warning', 'Suspended', 'Pending', 'Rejected')),
    tier TEXT DEFAULT '1K',
    credits INTEGER DEFAULT 0,
    quality TEXT DEFAULT 'High' CHECK(quality IN ('High', 'Medium', 'Low')),
    phone_number_id TEXT,
    access_token TEXT,
    access_token_encrypted TEXT,
    webhook_secret TEXT,
    waba_id TEXT,
    business_id TEXT,
    dataset_id TEXT,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
);

-- Copy data
INSERT INTO tenants_new SELECT * FROM tenants;

-- Drop old table
DROP TABLE tenants;

-- Rename
ALTER TABLE tenants_new RENAME TO tenants;