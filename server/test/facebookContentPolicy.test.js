import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { runMigrationsSync } from '../db/migrator.js';
import {
    evaluateFacebookContentPublishingPolicy,
    getFacebookContentPublishingPolicy,
    parsePageLocalDateTime,
} from '../services/facebookContentPolicy.js';
import { createContentPublication } from '../services/facebookContentScheduler.js';

const createDatabase = () => {
    const database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    runMigrationsSync(database);
    database.exec(`
        INSERT INTO tenants (id, name, phone, credits)
        VALUES (1, 'Tenant', '218910000090', 1000);
        INSERT INTO tenant_pages (id, tenant_id, page_id, page_name, is_active)
        VALUES (11, 1, 'page-policy', 'Policy Page', 1);
        INSERT INTO facebook_content_items (
            id, tenant_id, linked_page_id, kind, title, body, status
        ) VALUES
            (301, 1, 11, 'manual', 'First', 'First body', 'approved'),
            (302, 1, 11, 'manual', 'Second', 'Second body', 'approved');
        INSERT INTO facebook_content_settings (
            tenant_id, linked_page_id, timezone, allowed_days_json,
            posting_start_time, posting_end_time, daily_post_limit, no_repeat_days
        ) VALUES (
            1, 11, 'Africa/Tripoli', '[4]', '09:00', '11:00', 2, 14
        );
    `);
    return database;
};

test('publishing policy parses page-local input and rejects times outside the page window', () => {
    const database = createDatabase();
    const policy = getFacebookContentPublishingPolicy(database, 1, 11);
    assert.equal(policy.timezone, 'Africa/Tripoli');
    assert.deepEqual(policy.allowed_days, [4]);
    assert.equal(
        parsePageLocalDateTime('2026-07-16T10:15', policy.timezone).toISOString(),
        '2026-07-16T08:15:00.000Z',
    );

    const denied = evaluateFacebookContentPublishingPolicy(database, {
        tenantId: 1,
        linkedPageId: 11,
        contentItemId: 301,
        at: new Date('2026-07-16T12:00:00.000Z'),
        mode: 'schedule',
    });
    assert.equal(denied.allowed, false);
    assert.equal(denied.code, 'CONTENT_POSTING_WINDOW_CLOSED');
    assert.equal(denied.next_allowed_at, '2026-07-23T07:00:00.000Z');
    database.close();
});

test('publishing policy enforces daily capacity and source or exact-content repetition', () => {
    const database = createDatabase();
    const firstTime = new Date('2026-07-16T07:15:00.000Z');
    const secondTime = new Date('2026-07-16T08:00:00.000Z');
    createContentPublication(database, {
        tenantId: 1,
        linkedPageId: 11,
        contentItemId: 301,
        scheduledFor: firstTime,
        renderedMessage: 'Repeated direct text',
        idempotencyKey: 'policy-first',
    });
    createContentPublication(database, {
        tenantId: 1,
        linkedPageId: 11,
        contentItemId: 302,
        scheduledFor: secondTime,
        renderedMessage: 'Other text',
        idempotencyKey: 'policy-second',
    });

    const daily = evaluateFacebookContentPublishingPolicy(database, {
        tenantId: 1,
        linkedPageId: 11,
        at: new Date('2026-07-16T08:30:00.000Z'),
        mode: 'schedule',
    });
    assert.equal(daily.code, 'CONTENT_DAILY_LIMIT_REACHED');

    database.prepare(`
        UPDATE facebook_content_settings SET daily_post_limit = 5 WHERE tenant_id = 1
    `).run();
    database.prepare(`
        UPDATE facebook_content_publications
        SET status = 'published', published_at = scheduled_for
        WHERE idempotency_key = 'policy-first'
    `).run();
    const repeatedSource = evaluateFacebookContentPublishingPolicy(database, {
        tenantId: 1,
        linkedPageId: 11,
        contentItemId: 301,
        at: new Date('2026-07-16T08:30:00.000Z'),
        mode: 'publish',
    });
    assert.equal(repeatedSource.code, 'CONTENT_REPEAT_WINDOW_ACTIVE');

    const repeatedText = evaluateFacebookContentPublishingPolicy(database, {
        tenantId: 1,
        linkedPageId: 11,
        renderedMessage: 'Repeated direct text',
        at: new Date('2026-07-16T08:30:00.000Z'),
        mode: 'publish',
    });
    assert.equal(repeatedText.code, 'CONTENT_REPEAT_WINDOW_ACTIVE');
    database.close();
});
