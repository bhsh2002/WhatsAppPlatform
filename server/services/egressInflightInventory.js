// Aggregate row counts, not unique operations. No payloads, credentials,
// identifiers or queue writes. A failed SMS request may still be uncertain:
// the legacy request ledger does not persist deliveryUncertain separately.
const CATEGORIES = Object.freeze([
    { name: 'broadcast_jobs', table: 'broadcast_jobs', column: 'status', states: ['pending', 'running', 'processing', 'publishing', 'inflight', 'unknown'] },
    { name: 'tenant_callbacks', table: 'tenant_api_callback_outbox', column: 'status', states: ['processing', 'publishing', 'inflight', 'unknown'] },
    { name: 'integration_outbox', table: 'savana_integration_outbox', column: 'status', states: ['processing', 'publishing', 'inflight', 'unknown'] },
    { name: 'integration_ingress', table: 'savana_integration_events', column: 'status', states: ['processing', 'inflight', 'unknown'] },
    { name: 'content_publications', table: 'facebook_content_publications', column: 'status', states: ['processing', 'publishing', 'inflight', 'unknown'] },
    { name: 'browser_push', table: 'web_push_deliveries', column: 'status', states: ['processing', 'publishing', 'inflight', 'unknown'] },
    { name: 'sms_api_requests', table: 'sms_api_requests', column: 'status', states: ['processing', 'failed', 'inflight', 'unknown'] },
    { name: 'billing_reservations', table: 'billing_usage_events', column: 'status', states: ['reserved', 'inflight', 'unknown'] },
    { name: 'sms_provisioning', table: 'sms_gateway_provision_deliveries', column: 'status', states: ['processing', 'inflight', 'unknown'] },
    { name: 'sms_outgoing', table: 'sms_messages', column: 'status', states: ['pending', 'queued', 'sending', 'processing', 'inflight', 'unknown'], direction: 'outgoing' },
    { name: 'ussd_requests', table: 'sms_ussd_requests', column: 'status', states: ['pending', 'processing', 'inflight', 'unknown'] },
    { name: 'delegated_identity_exchange', table: 'savana_delegated_read_flows', column: 'state', states: ['exchanging', 'unknown'] },
    { name: 'operational_read_actions', table: 'savana_operational_read_actions', column: 'state', states: ['prepared', 'inflight', 'unknown'] },
    { name: 'consumer_enrollment', table: 'savana_operational_consumer_enrollments', column: 'state', states: ['prepared', 'inflight', 'unknown'] },
    { name: 'owner_portal_login', table: 'savana_owner_portal_sessions', column: 'state', states: ['authorizing'] },
    { name: 'owner_portal_intents', table: 'savana_owner_portal_intents', column: 'state', states: ['prepared', 'inflight', 'unknown'] },
]);

export const getEgressInflightInventory = database => {
    if (!database || typeof database.prepare !== 'function') {
        throw new TypeError('A database is required for the read-only inflight inventory');
    }
    const collect = () => {
        let unresolvedCount = 0;
        let schemaComplete = true;
        const categories = {};
        for (const category of CATEGORIES) {
            const exists = database.prepare(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
            ).get(category.table);
            const columns = exists
                ? database.prepare(`PRAGMA table_info("${category.table}")`).all()
                    .map(column => column.name)
                : [];
            if (!exists || !columns.includes(category.column)
                || (category.direction && !columns.includes('direction'))) {
                schemaComplete = false;
                categories[category.name] = {
                    present: Boolean(exists),
                    unresolved_count: null,
                    states: null,
                    reason: exists ? 'required_column_missing' : 'table_missing',
                };
                continue;
            }
            const placeholders = category.states.map(() => '?').join(', ');
            const rows = database.prepare(`
                SELECT "${category.column}" AS state, COUNT(*) AS count
                FROM "${category.table}"
                WHERE "${category.column}" IN (${placeholders})
                    ${category.direction ? 'AND direction = ?' : ''}
                GROUP BY "${category.column}"
            `).all(...category.states, ...(category.direction ? [category.direction] : []));
            const states = Object.fromEntries(category.states.map(state => [state, 0]));
            for (const row of rows) states[row.state] = Number(row.count);
            const count = Object.values(states).reduce((sum, value) => sum + value, 0);
            unresolvedCount += count;
            categories[category.name] = { present: true, unresolved_count: count, states };
        }
        return { unresolved_count: unresolvedCount, schema_complete: schemaComplete, categories };
    };
    return database.inTransaction ? collect() : database.transaction(collect).deferred();
};
