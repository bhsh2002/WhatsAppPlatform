-- Track paged product snapshots and source membership without repeatedly
-- scanning the unbounded integration-event history.

CREATE TABLE savana_product_snapshot_streams (
    integration_id INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    latest_snapshot_id TEXT,
    latest_generated_at TEXT,
    applied_snapshot_id TEXT,
    applied_generated_at TEXT,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
    PRIMARY KEY (integration_id, event_type),
    FOREIGN KEY (integration_id) REFERENCES savana_integrations(id) ON DELETE CASCADE
);

CREATE TABLE savana_product_snapshot_pages (
    integration_id INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    snapshot_id TEXT NOT NULL,
    page_number INTEGER NOT NULL CHECK(page_number >= 1),
    page_count INTEGER NOT NULL CHECK(page_count >= 1),
    generated_at TEXT,
    complete INTEGER NOT NULL DEFAULT 0 CHECK(complete IN (0, 1)),
    products_json TEXT NOT NULL,
    received_at DATETIME DEFAULT (datetime('now', 'localtime')),
    PRIMARY KEY (integration_id, event_type, snapshot_id, page_number),
    FOREIGN KEY (integration_id) REFERENCES savana_integrations(id) ON DELETE CASCADE
);

CREATE TABLE savana_product_snapshot_memberships (
    integration_id INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    projection_key TEXT NOT NULL,
    snapshot_id TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
    updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
    PRIMARY KEY (integration_id, event_type, projection_key),
    FOREIGN KEY (integration_id) REFERENCES savana_integrations(id) ON DELETE CASCADE
);

CREATE INDEX idx_savana_snapshot_pages_stream
    ON savana_product_snapshot_pages(integration_id, event_type, snapshot_id);

CREATE INDEX idx_savana_snapshot_memberships_product
    ON savana_product_snapshot_memberships(projection_key, is_active);
