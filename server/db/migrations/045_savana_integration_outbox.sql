-- Durable outbound events from Wa Savana to Savana Connect.

CREATE TABLE IF NOT EXISTS savana_integration_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    integration_id INTEGER NOT NULL,
    event_id TEXT NOT NULL UNIQUE,
    idempotency_key TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    available_at DATETIME NOT NULL,
    locked_at DATETIME,
    published_at DATETIME,
    last_error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (integration_id) REFERENCES savana_integrations(id) ON DELETE CASCADE,
    UNIQUE (integration_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_savana_integration_outbox_due
    ON savana_integration_outbox(status, available_at);
