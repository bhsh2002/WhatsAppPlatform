-- ============================================
-- Migration 030: Messenger guided bot
-- ============================================

CREATE TABLE IF NOT EXISTS bot_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    sku TEXT,
    name TEXT NOT NULL,
    description TEXT,
    price REAL DEFAULT 0,
    currency TEXT DEFAULT 'LYD',
    image_url TEXT,
    product_url TEXT,
    category TEXT,
    availability TEXT DEFAULT 'available' CHECK(availability IN ('available', 'out_of_stock', 'hidden')),
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_products_sku ON bot_products(tenant_id, sku) WHERE sku IS NOT NULL AND sku != '';
CREATE INDEX IF NOT EXISTS idx_bot_products_tenant ON bot_products(tenant_id, is_active, category);

CREATE TABLE IF NOT EXISTS bot_flows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    linked_page_id INTEGER,
    name TEXT NOT NULL,
    trigger_type TEXT NOT NULL DEFAULT 'keyword' CHECK(trigger_type IN ('welcome', 'keyword', 'postback', 'fallback', 'menu')),
    trigger_value TEXT,
    priority INTEGER DEFAULT 100,
    status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'active', 'paused')),
    description TEXT,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (linked_page_id) REFERENCES tenant_pages(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_bot_flows_tenant ON bot_flows(tenant_id, status, trigger_type, priority);
CREATE INDEX IF NOT EXISTS idx_bot_flows_page ON bot_flows(linked_page_id);

CREATE TABLE IF NOT EXISTS bot_flow_nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    flow_id INTEGER NOT NULL,
    node_key TEXT NOT NULL DEFAULT 'start',
    node_type TEXT NOT NULL DEFAULT 'text' CHECK(node_type IN ('text', 'quick_replies', 'product_list', 'product_detail', 'service_menu', 'handoff', 'end')),
    title TEXT,
    body TEXT,
    config_json TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (flow_id) REFERENCES bot_flows(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_flow_nodes_key ON bot_flow_nodes(flow_id, node_key);

CREATE TABLE IF NOT EXISTS bot_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    linked_page_id INTEGER NOT NULL,
    conversation_id INTEGER,
    user_psid TEXT NOT NULL,
    active_flow_id INTEGER,
    current_node_key TEXT,
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'handoff', 'closed')),
    context_json TEXT,
    last_user_message_at DATETIME,
    last_bot_message_at DATETIME,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (linked_page_id) REFERENCES tenant_pages(id) ON DELETE CASCADE,
    FOREIGN KEY (conversation_id) REFERENCES fb_conversations(id) ON DELETE SET NULL,
    FOREIGN KEY (active_flow_id) REFERENCES bot_flows(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_sessions_user ON bot_sessions(linked_page_id, user_psid);
CREATE INDEX IF NOT EXISTS idx_bot_sessions_conversation ON bot_sessions(conversation_id);
CREATE INDEX IF NOT EXISTS idx_bot_sessions_tenant ON bot_sessions(tenant_id, status, updated_at);

CREATE TABLE IF NOT EXISTS bot_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    linked_page_id INTEGER,
    conversation_id INTEGER,
    session_id INTEGER,
    event_type TEXT NOT NULL,
    direction TEXT,
    payload_json TEXT,
    status TEXT DEFAULT 'info',
    error_message TEXT,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (linked_page_id) REFERENCES tenant_pages(id) ON DELETE SET NULL,
    FOREIGN KEY (conversation_id) REFERENCES fb_conversations(id) ON DELETE SET NULL,
    FOREIGN KEY (session_id) REFERENCES bot_sessions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_bot_events_tenant ON bot_events(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bot_events_session ON bot_events(session_id, created_at);

INSERT OR IGNORE INTO billing_price_items (operation_key, channel, operation_type, display_name_ar, unit_price_credits, is_billable, is_active)
VALUES ('messenger.bot_reply', 'messenger', 'bot_reply', 'رد آلي Messenger Bot', 1, 1, 1);
