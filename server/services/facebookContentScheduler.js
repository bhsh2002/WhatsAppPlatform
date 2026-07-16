import crypto from 'node:crypto';

import {
    CONTENT_SCHEDULER_BATCH_SIZE,
    CONTENT_SCHEDULER_INTERVAL_MS,
} from '../config/index.js';
import db from '../db/database.js';
import {
    nextCampaignRun,
    normalizeScheduleDays,
    normalizeScheduleTimes,
    parseStoredList,
    zonedDayBounds,
} from './facebookContentSchedule.js';
import { publishFacebookContent } from './facebookContentPublisher.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_CLAIM_MS = 15 * 60 * 1000;

const iso = value => (value instanceof Date ? value : new Date(value)).toISOString();
const safeDate = (value, fallback = new Date()) => {
    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isNaN(parsed.getTime()) ? fallback : parsed;
};

const attachPrimaryImage = (database, product) => {
    if (!product) return null;
    const image = database.prepare(`
        SELECT image_url
        FROM bot_product_images
        WHERE product_id = ? AND tenant_id = ?
        ORDER BY is_primary DESC, sort_order ASC, id ASC
        LIMIT 1
    `).get(product.id, product.tenant_id);
    return { ...product, image_url: image?.image_url || product.image_url || null };
};

const productMessage = (campaign, product) => {
    const price = Number(product.price || 0);
    const values = {
        name: product.name || '',
        description: product.description || '',
        price: price ? price.toLocaleString('ar-LY') : '',
        currency: product.currency || 'LYD',
        category: product.category || '',
        sku: product.sku || '',
        url: product.product_url || '',
    };
    const fallback = [
        values.name,
        values.description,
        price ? `${values.price} ${values.currency}` : '',
        values.url,
    ].filter(Boolean).join('\n\n');
    return String(campaign.product_template || '').trim()
        .replace(/\{(name|description|price|currency|category|sku|url)\}/g, (_, key) => values[key])
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim() || fallback;
};

const eligibleLibraryItems = (database, campaign, now) => {
    const explicitItems = database.prepare(`
        SELECT COUNT(*) AS count
        FROM facebook_content_campaign_items
        WHERE campaign_id = ? AND is_active = 1
    `).get(campaign.id).count > 0;
    const statusClause = campaign.approval_required
        ? "i.status = 'approved'"
        : "i.status != 'archived'";
    const repeatThreshold = new Date(now.getTime() - (campaign.no_repeat_days * DAY_MS)).toISOString();
    return database.prepare(`
        SELECT i.*, COALESCE(ci.sort_order, i.id) AS campaign_order
        FROM facebook_content_items i
        LEFT JOIN facebook_content_campaign_items ci
          ON ci.content_item_id = i.id
         AND ci.campaign_id = ?
         AND ci.is_active = 1
        WHERE i.tenant_id = ?
          AND (i.linked_page_id IS NULL OR i.linked_page_id = ?)
          AND ${statusClause}
          ${explicitItems ? 'AND ci.id IS NOT NULL' : ''}
          AND NOT EXISTS (
              SELECT 1
              FROM facebook_content_publications publication
              WHERE publication.tenant_id = i.tenant_id
                AND publication.content_item_id = i.id
                AND publication.status = 'published'
                AND publication.published_at >= ?
          )
        ORDER BY campaign_order ASC, i.id ASC
        LIMIT 500
    `).all(campaign.id, campaign.tenant_id, campaign.linked_page_id, repeatThreshold);
};

const eligibleProducts = (database, campaign, now) => {
    const repeatThreshold = new Date(now.getTime() - (campaign.no_repeat_days * DAY_MS)).toISOString();
    const params = [campaign.tenant_id];
    let categoryClause = '';
    if (campaign.product_category) {
        categoryClause = 'AND LOWER(p.category) = LOWER(?)';
        params.push(campaign.product_category);
    }
    params.push(repeatThreshold);
    return database.prepare(`
        SELECT p.*
        FROM bot_products p
        WHERE p.tenant_id = ?
          AND p.is_active = 1
          AND p.availability = 'available'
          ${categoryClause}
          AND NOT EXISTS (
              SELECT 1
              FROM facebook_content_publications publication
              WHERE publication.tenant_id = p.tenant_id
                AND publication.product_id = p.id
                AND publication.status = 'published'
                AND publication.published_at >= ?
          )
        ORDER BY p.updated_at DESC, p.id DESC
        LIMIT 500
    `).all(...params).map(product => attachPrimaryImage(database, product));
};

const selectByRotation = (rows, campaign, random = Math.random) => {
    if (!rows.length) return null;
    if (campaign.rotation_mode === 'random') {
        return rows[Math.floor(random() * rows.length) % rows.length];
    }
    return rows[Math.max(Number(campaign.cursor_position) || 0, 0) % rows.length];
};

export const selectCampaignSource = (database, campaign, {
    now = new Date(),
    random = Math.random,
} = {}) => {
    const order = campaign.source_mode === 'mixed'
        ? ((Number(campaign.cursor_position) || 0) % 2 === 0 ? ['library', 'products'] : ['products', 'library'])
        : [campaign.source_mode];

    for (const source of order) {
        if (source === 'library') {
            const item = selectByRotation(eligibleLibraryItems(database, campaign, now), campaign, random);
            if (item) {
                return {
                    content_item_id: item.id,
                    product_id: item.product_id || null,
                    rendered_message: item.body,
                    link_url: item.link_url || null,
                    media_url: item.media_url || null,
                };
            }
        }
        if (source === 'products') {
            const product = selectByRotation(eligibleProducts(database, campaign, now), campaign, random);
            if (product) {
                return {
                    content_item_id: null,
                    product_id: product.id,
                    rendered_message: productMessage(campaign, product),
                    link_url: product.product_url || null,
                    media_url: product.image_url || null,
                };
            }
        }
    }
    return null;
};

export const createContentPublication = (database, {
    tenantId,
    linkedPageId,
    campaignId = null,
    contentItemId = null,
    productId = null,
    scheduledFor,
    renderedMessage,
    linkUrl = null,
    mediaUrl = null,
    createdBy = null,
    idempotencyKey = crypto.randomUUID(),
    maxAttempts = 3,
} = {}) => {
    const result = database.prepare(`
        INSERT INTO facebook_content_publications (
            tenant_id, linked_page_id, campaign_id, content_item_id, product_id,
            status, scheduled_for, next_attempt_at, max_attempts, idempotency_key,
            rendered_message, link_url, media_url, created_by
        ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(idempotency_key) DO NOTHING
    `).run(
        tenantId,
        linkedPageId,
        campaignId,
        contentItemId,
        productId,
        iso(scheduledFor),
        iso(scheduledFor),
        maxAttempts,
        idempotencyKey,
        renderedMessage,
        linkUrl,
        mediaUrl,
        createdBy,
    );
    if (result.changes === 0) {
        return database.prepare(`
            SELECT * FROM facebook_content_publications WHERE idempotency_key = ?
        `).get(idempotencyKey);
    }
    return database.prepare(`
        SELECT * FROM facebook_content_publications WHERE id = ?
    `).get(result.lastInsertRowid);
};

const nextRunForCampaign = (campaign, from) => nextCampaignRun({
    from,
    timeZone: campaign.timezone,
    days: normalizeScheduleDays(parseStoredList(campaign.allowed_days_json, [])),
    times: normalizeScheduleTimes(parseStoredList(campaign.schedule_times_json, [])),
});

const pageDailyPublicationCount = (database, campaign, now) => {
    const { start, end } = zonedDayBounds(now, campaign.timezone);
    return database.prepare(`
        SELECT COUNT(*) AS count
        FROM facebook_content_publications
        WHERE tenant_id = ? AND linked_page_id = ?
          AND scheduled_for >= ? AND scheduled_for < ?
          AND status NOT IN ('cancelled', 'skipped')
    `).get(campaign.tenant_id, campaign.linked_page_id, start.toISOString(), end.toISOString()).count;
};

export const materializeDueCampaigns = (database, {
    now = new Date(),
    limit = CONTENT_SCHEDULER_BATCH_SIZE,
    random = Math.random,
} = {}) => {
    const dueIds = database.prepare(`
        SELECT id
        FROM facebook_content_campaigns
        WHERE status = 'active'
          AND next_run_at IS NOT NULL
          AND next_run_at <= ?
        ORDER BY next_run_at ASC, id ASC
        LIMIT ?
    `).all(iso(now), limit).map(row => row.id);
    const publications = [];

    for (const campaignId of dueIds) {
        const transaction = database.transaction(() => {
            const campaign = database.prepare(`
                SELECT *
                FROM facebook_content_campaigns
                WHERE id = ? AND status = 'active' AND next_run_at <= ?
            `).get(campaignId, iso(now));
            if (!campaign) return null;
            const scheduledSlot = safeDate(campaign.next_run_at, now);
            const nextRun = nextRunForCampaign(campaign, now);
            if (pageDailyPublicationCount(database, campaign, now) >= campaign.max_posts_per_day) {
                database.prepare(`
                    UPDATE facebook_content_campaigns
                    SET next_run_at = ?, last_error = ?, updated_at = datetime('now')
                    WHERE id = ?
                `).run(nextRun.toISOString(), 'تم تجاوز الحد اليومي للمنشورات', campaign.id);
                return null;
            }
            const source = selectCampaignSource(database, campaign, { now, random });
            if (!source) {
                database.prepare(`
                    UPDATE facebook_content_campaigns
                    SET next_run_at = ?, last_run_at = ?, last_error = ?,
                        updated_at = datetime('now')
                    WHERE id = ?
                `).run(
                    nextRun.toISOString(),
                    scheduledSlot.toISOString(),
                    'لا يوجد محتوى مؤهل وغير مكرر للنشر',
                    campaign.id,
                );
                return null;
            }
            const publication = createContentPublication(database, {
                tenantId: campaign.tenant_id,
                linkedPageId: campaign.linked_page_id,
                campaignId: campaign.id,
                contentItemId: source.content_item_id,
                productId: source.product_id,
                scheduledFor: scheduledSlot.getTime() < now.getTime() ? now : scheduledSlot,
                renderedMessage: source.rendered_message,
                linkUrl: source.link_url,
                mediaUrl: source.media_url,
                createdBy: campaign.created_by,
                idempotencyKey: `facebook-campaign:${campaign.id}:${scheduledSlot.toISOString()}`,
            });
            database.prepare(`
                UPDATE facebook_content_campaigns
                SET cursor_position = cursor_position + 1,
                    next_run_at = ?, last_run_at = ?, last_error = NULL,
                    updated_at = datetime('now')
                WHERE id = ?
            `).run(nextRun.toISOString(), scheduledSlot.toISOString(), campaign.id);
            return publication;
        });
        const publication = transaction.immediate();
        if (publication) publications.push(publication);
    }
    return publications;
};

const recoverStaleClaims = (database, now) => {
    const staleBefore = new Date(now.getTime() - STALE_CLAIM_MS).toISOString();
    database.prepare(`
        UPDATE facebook_content_publications
        SET status = 'published', published_at = COALESCE(published_at, updated_at),
            claimed_at = NULL, claimed_by = NULL, updated_at = datetime('now')
        WHERE status = 'processing' AND meta_post_id IS NOT NULL
          AND claimed_at < ?
    `).run(staleBefore);
    return database.prepare(`
        UPDATE facebook_content_publications
        SET status = 'pending', claimed_at = NULL, claimed_by = NULL,
            next_attempt_at = ?, updated_at = datetime('now')
        WHERE status = 'processing' AND meta_post_id IS NULL
          AND claimed_at < ?
    `).run(iso(now), staleBefore).changes;
};

const autoPauseThreshold = (database, campaign) => {
    const page = database.prepare(`
        SELECT auto_pause_failures
        FROM facebook_content_settings
        WHERE tenant_id = ? AND linked_page_id = ?
    `).get(campaign.tenant_id, campaign.linked_page_id);
    const tenant = database.prepare(`
        SELECT auto_pause_failures
        FROM facebook_content_settings
        WHERE tenant_id = ? AND linked_page_id IS NULL
    `).get(campaign.tenant_id);
    return Math.min(Math.max(Number(page?.auto_pause_failures || tenant?.auto_pause_failures || 3), 1), 20);
};

const updateCampaignFailure = (database, campaignId, message) => {
    if (!campaignId) return;
    database.prepare(`
        UPDATE facebook_content_campaigns
        SET consecutive_failures = consecutive_failures + 1,
            last_error = ?, updated_at = datetime('now')
        WHERE id = ?
    `).run(String(message || '').slice(0, 1000), campaignId);
    const campaign = database.prepare(`
        SELECT id, tenant_id, linked_page_id, consecutive_failures
        FROM facebook_content_campaigns WHERE id = ?
    `).get(campaignId);
    if (campaign && campaign.consecutive_failures >= autoPauseThreshold(database, campaign)) {
        database.prepare(`
            UPDATE facebook_content_campaigns
            SET status = 'paused', last_error = ?, updated_at = datetime('now')
            WHERE id = ?
        `).run(`تم إيقاف الحملة تلقائياً: ${String(message || '').slice(0, 800)}`, campaignId);
    }
};

export const processDuePublications = async (database, {
    now = new Date(),
    limit = CONTENT_SCHEDULER_BATCH_SIZE,
    workerId = `content-${process.pid}`,
    publish = publishFacebookContent,
} = {}) => {
    const recovered = recoverStaleClaims(database, now);
    const dueIds = database.prepare(`
        SELECT id
        FROM facebook_content_publications
        WHERE status = 'pending'
          AND scheduled_for <= ?
          AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
        ORDER BY scheduled_for ASC, id ASC
        LIMIT ?
    `).all(iso(now), iso(now), limit).map(row => row.id);
    const result = { recovered, processed: 0, published: 0, retried: 0, failed: 0 };

    for (const publicationId of dueIds) {
        const claim = database.transaction(() => {
            const update = database.prepare(`
                UPDATE facebook_content_publications
                SET status = 'processing', attempts = attempts + 1,
                    claimed_at = ?, claimed_by = ?, updated_at = datetime('now')
                WHERE id = ? AND status = 'pending'
                  AND scheduled_for <= ?
                  AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
            `).run(iso(now), workerId, publicationId, iso(now), iso(now));
            if (!update.changes) return null;
            return database.prepare(`
                SELECT * FROM facebook_content_publications WHERE id = ?
            `).get(publicationId);
        }).immediate();
        if (!claim) continue;
        result.processed += 1;

        try {
            const published = await publish({ database, publication: claim });
            database.prepare(`
                UPDATE facebook_content_publications
                SET status = 'published', meta_post_id = ?, published_at = ?,
                    error_code = NULL, error_message = ?, claimed_at = NULL,
                    claimed_by = NULL, updated_at = datetime('now')
                WHERE id = ?
            `).run(
                published.post_id,
                iso(now),
                published.billing_warning || null,
                claim.id,
            );
            if (claim.campaign_id) {
                database.prepare(`
                    UPDATE facebook_content_campaigns
                    SET consecutive_failures = 0, last_error = NULL,
                        updated_at = datetime('now')
                    WHERE id = ?
                `).run(claim.campaign_id);
            }
            result.published += 1;
        } catch (error) {
            const canRetry = Boolean(error.retryable) && claim.attempts < claim.max_attempts;
            if (canRetry) {
                const delayMinutes = Math.min(2 ** claim.attempts, 60);
                const retryAt = new Date(now.getTime() + (delayMinutes * 60 * 1000));
                database.prepare(`
                    UPDATE facebook_content_publications
                    SET status = 'pending', next_attempt_at = ?, error_code = ?,
                        error_message = ?, claimed_at = NULL, claimed_by = NULL,
                        updated_at = datetime('now')
                    WHERE id = ?
                `).run(
                    retryAt.toISOString(),
                    error.code || 'PUBLISH_RETRY',
                    String(error.message || '').slice(0, 1000),
                    claim.id,
                );
                result.retried += 1;
            } else {
                database.prepare(`
                    UPDATE facebook_content_publications
                    SET status = 'failed', error_code = ?, error_message = ?,
                        claimed_at = NULL, claimed_by = NULL, updated_at = datetime('now')
                    WHERE id = ?
                `).run(
                    error.code || 'PUBLISH_FAILED',
                    String(error.message || '').slice(0, 1000),
                    claim.id,
                );
                result.failed += 1;
            }
            updateCampaignFailure(database, claim.campaign_id, error.message);
        }
    }
    return result;
};

export const runFacebookContentSchedulerTick = async ({
    database = db,
    now = new Date(),
    limit = CONTENT_SCHEDULER_BATCH_SIZE,
    publish = publishFacebookContent,
    workerId,
} = {}) => {
    const materialized = materializeDueCampaigns(database, { now, limit });
    const processed = await processDuePublications(database, {
        now,
        limit,
        publish,
        workerId,
    });
    return { materialized: materialized.length, ...processed };
};

export function startFacebookContentScheduler({
    database = db,
    intervalMs = CONTENT_SCHEDULER_INTERVAL_MS,
    limit = CONTENT_SCHEDULER_BATCH_SIZE,
    publish = publishFacebookContent,
} = {}) {
    let running = false;
    const workerId = `content-${process.pid}-${crypto.randomUUID()}`;
    const run = async () => {
        if (running) return null;
        running = true;
        try {
            const result = await runFacebookContentSchedulerTick({
                database,
                limit,
                publish,
                workerId,
            });
            if (result.materialized || result.processed || result.recovered) {
                console.log('[ContentScheduler] Tick:', result);
            }
            return result;
        } catch (error) {
            console.error('[ContentScheduler] Tick failed:', error.message);
            return null;
        } finally {
            running = false;
        }
    };
    const startup = setTimeout(run, 5000);
    startup.unref();
    const interval = setInterval(run, intervalMs);
    interval.unref();
    return {
        interval,
        run,
        stop() {
            clearTimeout(startup);
            clearInterval(interval);
        },
    };
}
