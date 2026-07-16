import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { runMigrationsSync } from '../db/migrator.js';
import {
    createContentPublication,
    materializeDueCampaigns,
    processDuePublications,
    selectCampaignSource,
} from '../services/facebookContentScheduler.js';
import { publishFacebookContent } from '../services/facebookContentPublisher.js';

const createDatabase = () => {
    const database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    runMigrationsSync(database);
    database.exec(`
        INSERT INTO tenants (id, name, phone, credits)
        VALUES (1, 'Tenant', '218910000003', 1000);
        INSERT INTO users (id, username, password_hash, role, tenant_id)
        VALUES (1, 'tenant', 'hash', 'tenant', 1);
        INSERT INTO tenant_pages (id, tenant_id, page_id, page_name, is_active)
        VALUES (11, 1, 'page-11', 'Page 11', 1);
        INSERT INTO bot_products (
            id, tenant_id, sku, name, description, price, currency,
            image_url, product_url, category, availability, is_active
        ) VALUES (
            101, 1, 'SKU-101', 'منتج تدوير', 'وصف المنتج', 30, 'LYD',
            'https://cdn.test/product.jpg', 'https://shop.test/product',
            'اختبار', 'available', 1
        );
        INSERT INTO facebook_content_items (
            id, tenant_id, linked_page_id, kind, title, body, link_url,
            media_url, status, created_by
        ) VALUES (
            301, 1, 11, 'manual', 'منشور معتمد', 'محتوى الحملة',
            'https://example.test/post', NULL, 'approved', 1
        );
    `);
    return database;
};

test('Facebook publisher sends text and photo posts with idempotent billing', async () => {
    const billingEvents = [];
    const billing = {
        reserve: options => {
            billingEvents.push(['reserve', options]);
            return { id: 1 };
        },
        commit: (reservation, options) => billingEvents.push(['commit', reservation, options]),
        release: (reservation, message) => billingEvents.push(['release', reservation, message]),
    };
    const requests = [];
    const fetchImpl = async (url, init) => {
        requests.push({ url, init, body: Object.fromEntries(init.body.entries()) });
        return new Response(JSON.stringify({
            id: url.endsWith('/photos') ? 'photo-1' : 'post-1',
            post_id: url.endsWith('/photos') ? 'post-photo-1' : undefined,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const common = {
        database: {},
        fetchImpl,
        credentialResolver: () => ({
            page: { page_id: 'page-11', page_name: 'Page 11' },
            accessToken: 'page-token',
        }),
        billing,
        metaApiBase: 'https://graph.test/v25.0',
    };
    const textResult = await publishFacebookContent({
        ...common,
        publication: {
            id: 1,
            tenant_id: 1,
            linked_page_id: 11,
            rendered_message: 'Text post',
            link_url: 'https://example.test',
        },
    });
    const photoResult = await publishFacebookContent({
        ...common,
        publication: {
            id: 2,
            tenant_id: 1,
            linked_page_id: 11,
            rendered_message: 'Photo post',
            media_url: 'https://cdn.test/photo.jpg',
        },
    });
    assert.equal(requests[0].url, 'https://graph.test/v25.0/page-11/feed');
    assert.deepEqual(requests[0].body, {
        message: 'Text post',
        link: 'https://example.test',
    });
    assert.equal(requests[1].url, 'https://graph.test/v25.0/page-11/photos');
    assert.equal(requests[1].body.url, 'https://cdn.test/photo.jpg');
    assert.equal(textResult.post_id, 'post-1');
    assert.equal(photoResult.post_id, 'post-photo-1');
    assert.equal(billingEvents.filter(event => event[0] === 'reserve').length, 2);
    assert.equal(billingEvents.filter(event => event[0] === 'commit').length, 2);
});

test('publisher releases billing and marks transient Meta failures retryable', async () => {
    const events = [];
    await assert.rejects(
        () => publishFacebookContent({
            database: {},
            publication: {
                id: 9,
                tenant_id: 1,
                linked_page_id: 11,
                rendered_message: 'Retry me',
            },
            credentialResolver: () => ({
                page: { page_id: 'page-11', page_name: 'Page' },
                accessToken: 'token',
            }),
            billing: {
                reserve: () => ({ id: 9 }),
                commit: () => events.push('commit'),
                release: () => events.push('release'),
            },
            fetchImpl: async () => new Response(JSON.stringify({
                error: { message: 'Temporary', is_transient: true },
            }), { status: 503, headers: { 'Content-Type': 'application/json' } }),
        }),
        error => error.retryable === true && error.code === 'META_PUBLISH_FAILED',
    );
    assert.deepEqual(events, ['release']);
});

test('scheduler materializes a due campaign once and publishes its approved content', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const now = new Date('2026-07-16T12:00:00.000Z');
    database.prepare(`
        INSERT INTO facebook_content_campaigns (
            id, tenant_id, linked_page_id, name, source_mode, rotation_mode,
            timezone, allowed_days_json, schedule_times_json, no_repeat_days,
            max_posts_per_day, approval_required, status, next_run_at, created_by
        ) VALUES (
            401, 1, 11, 'Library campaign', 'library', 'sequential',
            'Africa/Tripoli', '[0,1,2,3,4,5,6]', '["09:00"]', 14,
            2, 1, 'active', '2026-07-16T11:59:00.000Z', 1
        )
    `).run();
    database.prepare(`
        INSERT INTO facebook_content_campaign_items (
            campaign_id, content_item_id, sort_order, is_active
        ) VALUES (401, 301, 0, 1)
    `).run();

    const materialized = materializeDueCampaigns(database, { now });
    assert.equal(materialized.length, 1);
    assert.equal(materialized[0].content_item_id, 301);
    assert.equal(materializeDueCampaigns(database, { now }).length, 0);

    const result = await processDuePublications(database, {
        now,
        publish: async ({ publication }) => ({
            post_id: `meta-${publication.id}`,
            billing_warning: null,
        }),
    });
    assert.deepEqual(
        { processed: result.processed, published: result.published, failed: result.failed },
        { processed: 1, published: 1, failed: 0 },
    );
    const publication = database.prepare(`
        SELECT status, attempts, meta_post_id, published_at
        FROM facebook_content_publications
        WHERE campaign_id = 401
    `).get();
    assert.equal(publication.status, 'published');
    assert.equal(publication.attempts, 1);
    assert.match(publication.meta_post_id, /^meta-/);
    assert.equal(publication.published_at, now.toISOString());
});

test('product rotation uses shared products and respects no-repeat history', () => {
    const database = createDatabase();
    const campaign = {
        id: 402,
        tenant_id: 1,
        linked_page_id: 11,
        source_mode: 'products',
        rotation_mode: 'sequential',
        cursor_position: 0,
        product_category: 'اختبار',
        product_template: '{name}\nالسعر {price} {currency}\n{url}',
        no_repeat_days: 14,
        approval_required: 1,
    };
    const now = new Date('2026-07-16T12:00:00.000Z');
    const source = selectCampaignSource(database, campaign, { now });
    assert.equal(source.product_id, 101);
    assert.match(source.rendered_message, /30/);
    assert.equal(source.media_url, 'https://cdn.test/product.jpg');

    createContentPublication(database, {
        tenantId: 1,
        linkedPageId: 11,
        campaignId: null,
        productId: 101,
        scheduledFor: now,
        renderedMessage: source.rendered_message,
        idempotencyKey: 'published-product',
    });
    database.prepare(`
        UPDATE facebook_content_publications
        SET status = 'published', published_at = ?
        WHERE idempotency_key = 'published-product'
    `).run(now.toISOString());
    assert.equal(selectCampaignSource(database, campaign, { now }), null);
    database.close();
});

test('retryable publication failures back off then pause the campaign at its threshold', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    database.exec(`
        INSERT INTO facebook_content_settings (
            tenant_id, linked_page_id, auto_pause_failures
        ) VALUES (1, 11, 2);
        INSERT INTO facebook_content_campaigns (
            id, tenant_id, linked_page_id, name, source_mode, rotation_mode,
            timezone, allowed_days_json, schedule_times_json, status
        ) VALUES (
            403, 1, 11, 'Failing campaign', 'library', 'sequential',
            'Africa/Tripoli', '[0,1,2,3,4,5,6]', '["09:00"]', 'active'
        );
    `);
    createContentPublication(database, {
        tenantId: 1,
        linkedPageId: 11,
        campaignId: 403,
        contentItemId: 301,
        scheduledFor: new Date('2026-07-16T12:00:00.000Z'),
        renderedMessage: 'Will fail',
        idempotencyKey: 'retry-publication',
        maxAttempts: 2,
    });
    const transientError = Object.assign(new Error('Meta temporary failure'), {
        retryable: true,
        code: 'META_TEMPORARY',
    });
    const first = await processDuePublications(database, {
        now: new Date('2026-07-16T12:00:00.000Z'),
        publish: async () => { throw transientError; },
    });
    assert.equal(first.retried, 1);
    assert.equal(database.prepare(`
        SELECT status, attempts FROM facebook_content_publications
        WHERE idempotency_key = 'retry-publication'
    `).get().status, 'pending');

    const second = await processDuePublications(database, {
        now: new Date('2026-07-16T12:03:00.000Z'),
        publish: async () => { throw transientError; },
    });
    assert.equal(second.failed, 1);
    assert.deepEqual(database.prepare(`
        SELECT status, consecutive_failures
        FROM facebook_content_campaigns WHERE id = 403
    `).get(), { status: 'paused', consecutive_failures: 2 });
});
