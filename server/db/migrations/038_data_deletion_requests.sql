CREATE TABLE IF NOT EXISTS data_deletion_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    confirmation_code_hash TEXT UNIQUE NOT NULL,
    subject_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'failed')),
    records_deleted INTEGER NOT NULL DEFAULT 0,
    records_redacted INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    requested_at DATETIME DEFAULT (datetime('now', 'localtime')),
    completed_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_data_deletion_status
    ON data_deletion_requests(status, requested_at);
