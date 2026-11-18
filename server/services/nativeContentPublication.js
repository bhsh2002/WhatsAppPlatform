import crypto from 'node:crypto';

const iso = value => (value instanceof Date ? value : new Date(value)).toISOString();

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
