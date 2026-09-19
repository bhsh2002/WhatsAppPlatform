import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = path.join(testDirectory, '..', 'db', 'migrations');
const migrationFiles = fs.readdirSync(migrationsDirectory)
    .filter(file => file.endsWith('.sql'))
    .sort();
const migration = name => fs.readFileSync(
    path.join(migrationsDirectory, name),
    'utf8'
);
const migration050 = '050_savana_integration_degraded_status.sql';

const childTables = [
    'savana_integration_events',
    'savana_integration_outbox',
    'savana_service_requests',
];

const childSchema = db => db.prepare(`
    SELECT type, name, tbl_name, sql
    FROM sqlite_master
    WHERE tbl_name IN (${childTables.map(() => '?').join(', ')})
      AND type IN ('table', 'index', 'trigger')
    ORDER BY type, name
`).all(...childTables);

test('migration 050 deterministically preserves integration children and permits degraded', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');

    for (const file of migrationFiles.filter(file => file < migration050)) {
        db.exec(migration(file));
    }

    db.prepare(`
        INSERT INTO tenants (id, name, phone, status)
        VALUES (41, 'Migration tenant', '218910000041', 'Active')
    `).run();
    db.prepare(`
        INSERT INTO savana_integrations (
            id, tenant_id, platform_code, organization_id,
            local_platform_tenant_id, remote_platform_tenant_id,
            remote_external_tenant_id, connection_id, status, scopes_json,
            entitlement_payload_json, entitlement_signature,
            entitlement_valid_until, last_sync_at, last_error,
            created_at, updated_at, webhook_secret_encrypted
        ) VALUES (
            51, 41, 'catalog', 'organization-51',
            'local-tenant-51', 'remote-tenant-51',
            'catalog:shop:51', 'connection-51', 'active', '["catalog.products.projection"]',
            '{"version":1}', 'signature-51',
            '2026-08-14T12:00:00.000Z', '2026-08-13T12:00:00.000Z', 'existing-error',
            '2026-08-11 10:00:00', '2026-08-12 11:00:00', 'encrypted-secret-51'
        )
    `).run();
    db.prepare(`
        INSERT INTO savana_integration_events (
            id, integration_id, event_id, idempotency_key, event_type,
            payload_json, status, error_message, received_at, processed_at
        ) VALUES (
            61, 51, 'event-61', 'idempotency-61', 'catalog.product_snapshot.v1',
            '{"product_id":"product-61"}', 'failed', 'existing-event-error',
            '2026-08-12 12:00:00', '2026-08-12 12:01:00'
        )
    `).run();
    db.prepare(`
        INSERT INTO savana_integration_outbox (
            id, integration_id, event_id, idempotency_key, event_type,
            payload_json, status, attempts, available_at, locked_at,
            published_at, last_error, created_at, updated_at
        ) VALUES (
            71, 51, 'event-71', 'idempotency-71', 'wa_savana.notification_status_changed.v1',
            '{"status":"failed"}', 'failed', 3, '2026-08-12 13:00:00',
            '2026-08-12 13:01:00', NULL, 'existing-outbox-error',
            '2026-08-12 13:00:00', '2026-08-12 13:02:00'
        )
    `).run();
    db.prepare(`
        INSERT INTO savana_service_requests (
            id, tenant_id, integration_id, event_id, request_kind,
            request_key, payload_json, status, created_at, updated_at
        ) VALUES (
            81, 41, 51, 'event-81', 'content_publication',
            'request-81', '{"content_id":"content-81"}', 'approved',
            '2026-08-12 14:00:00', '2026-08-12 14:01:00'
        )
    `).run();

    const expectedIntegration = db.prepare(
        'SELECT * FROM savana_integrations WHERE id = 51'
    ).get();
    const expectedEvents = db.prepare(
        'SELECT * FROM savana_integration_events ORDER BY id'
    ).all();
    const expectedOutbox = db.prepare(
        'SELECT * FROM savana_integration_outbox ORDER BY id'
    ).all();
    const expectedRequests = db.prepare(
        'SELECT * FROM savana_service_requests ORDER BY id'
    ).all();
    const expectedChildSchema = childSchema(db);

    db.exec(migration(migration050));

    assert.deepEqual(
        db.prepare('SELECT * FROM savana_integrations WHERE id = 51').get(),
        expectedIntegration
    );
    assert.deepEqual(
        db.prepare('SELECT * FROM savana_integration_events ORDER BY id').all(),
        expectedEvents
    );
    assert.deepEqual(
        db.prepare('SELECT * FROM savana_integration_outbox ORDER BY id').all(),
        expectedOutbox
    );
    assert.deepEqual(
        db.prepare('SELECT * FROM savana_service_requests ORDER BY id').all(),
        expectedRequests
    );
    assert.deepEqual(childSchema(db), expectedChildSchema);
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    assert.equal(db.pragma('foreign_key_check').length, 0);

    db.prepare(
        "UPDATE savana_integrations SET status = 'degraded' WHERE id = 51"
    ).run();
    assert.equal(
        db.prepare('SELECT status FROM savana_integrations WHERE id = 51').get().status,
        'degraded'
    );
    assert.throws(
        () => db.prepare(
            "UPDATE savana_integrations SET status = 'unsupported' WHERE id = 51"
        ).run(),
        /CHECK constraint failed/
    );

    db.prepare('DELETE FROM savana_integrations WHERE id = 51').run();
    for (const table of childTables) {
        assert.equal(
            db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
            0
        );
    }
    assert.equal(db.pragma('foreign_key_check').length, 0);
    db.close();
});
