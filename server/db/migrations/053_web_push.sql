-- Durable, user-scoped browser push subscriptions and delivery outbox.
-- Tenant ownership is intentionally resolved through users at dispatch time so
-- a stale subscription cannot retain access after a user is moved or disabled.

-- A monotonic generation avoids the one-second ambiguity of JWT iat and
-- SQLite timestamps when passwords or all sessions are rotated.
ALTER TABLE users ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0 CHECK(auth_version >= 0);

CREATE TABLE IF NOT EXISTS web_push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    endpoint_hash TEXT NOT NULL UNIQUE,
    endpoint_encrypted TEXT NOT NULL,
    p256dh_encrypted TEXT NOT NULL,
    auth_encrypted TEXT NOT NULL,
    session_jti TEXT NOT NULL,
    session_auth_version INTEGER NOT NULL DEFAULT 0 CHECK(session_auth_version >= 0),
    session_issued_at INTEGER NOT NULL,
    session_expires_at INTEGER NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
    failure_count INTEGER NOT NULL DEFAULT 0,
    last_success_at TEXT,
    last_failure_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CHECK(session_expires_at > session_issued_at)
);

CREATE INDEX IF NOT EXISTS idx_web_push_subscriptions_user
    ON web_push_subscriptions(user_id, enabled);
CREATE INDEX IF NOT EXISTS idx_web_push_subscriptions_session
    ON web_push_subscriptions(session_jti, session_expires_at);

CREATE TABLE IF NOT EXISTS web_push_preferences (
    user_id INTEGER PRIMARY KEY,
    messages_enabled INTEGER NOT NULL DEFAULT 1 CHECK(messages_enabled IN (0, 1)),
    alerts_enabled INTEGER NOT NULL DEFAULT 1 CHECK(alerts_enabled IN (0, 1)),
    message_preview_enabled INTEGER NOT NULL DEFAULT 0
        CHECK(message_preview_enabled IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS web_push_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dedupe_key TEXT NOT NULL UNIQUE,
    tenant_id INTEGER,
    kind TEXT NOT NULL CHECK(kind IN ('message', 'alert')),
    channel TEXT CHECK(channel IS NULL OR channel IN ('whatsapp', 'messenger', 'sms')),
    alert_code TEXT,
    severity TEXT CHECK(severity IS NULL OR severity IN ('info', 'warning', 'critical')),
    source_hash TEXT NOT NULL,
    notification_tag TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'delivered', 'partial', 'failed', 'no_recipients')),
    created_at TEXT NOT NULL,
    completed_at TEXT,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    CHECK(
        (kind = 'message' AND tenant_id IS NOT NULL AND channel IS NOT NULL AND alert_code IS NULL)
        OR
        (kind = 'alert' AND channel IS NULL AND alert_code IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_web_push_events_tenant
    ON web_push_events(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_web_push_events_status
    ON web_push_events(status, id);

CREATE TABLE IF NOT EXISTS web_push_deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    subscription_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'processing', 'failed', 'delivered', 'dead_letter', 'skipped')),
    attempts INTEGER NOT NULL DEFAULT 0,
    available_at TEXT NOT NULL,
    locked_at TEXT,
    delivered_at TEXT,
    response_status INTEGER,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (event_id) REFERENCES web_push_events(id) ON DELETE CASCADE,
    FOREIGN KEY (subscription_id) REFERENCES web_push_subscriptions(id) ON DELETE CASCADE,
    UNIQUE(event_id, subscription_id)
);

CREATE INDEX IF NOT EXISTS idx_web_push_deliveries_due
    ON web_push_deliveries(status, available_at, id);
CREATE INDEX IF NOT EXISTS idx_web_push_deliveries_event
    ON web_push_deliveries(event_id, status);

-- Persists alert transitions across process restarts so polling the same
-- operational signal cannot generate repeated browser notifications.
CREATE TABLE IF NOT EXISTS web_push_alert_states (
    scope_key TEXT NOT NULL,
    alert_code TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 0 CHECK(is_active IN (0, 1)),
    last_source_hash TEXT,
    activated_at TEXT,
    resolved_at TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (scope_key, alert_code)
);
