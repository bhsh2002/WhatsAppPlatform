import express from 'express';

import {
    createContentPublication,
    selectCampaignSource,
} from '../services/facebookContentScheduler.js';
import {
    isValidTimeZone,
    nextCampaignRun,
    normalizeScheduleDays,
    normalizeScheduleTimes,
    parseStoredList,
} from '../services/facebookContentSchedule.js';
import { parseListPagination } from '../services/pagination.js';
import {
    booleanValue,
    boundedInteger,
    boundedText,
    contentError,
    normalizeStringList,
    requireContentPage,
    requireContentTenant,
    sendContentError,
} from './facebookContentStudioShared.js';

const SOURCE_MODES = new Set(['library', 'products', 'mixed']);
const ROTATION_MODES = new Set(['sequential', 'random']);
const CAMPAIGN_STATUSES = new Set(['draft', 'active', 'paused', 'completed']);

const presentCampaign = row => ({
    ...row,
    allowed_days: normalizeScheduleDays(parseStoredList(row.allowed_days_json, [])),
    schedule_times: normalizeScheduleTimes(parseStoredList(row.schedule_times_json, [])),
    approval_required: Boolean(row.approval_required),
    content_item_ids: normalizeStringList(row.content_item_ids_json)
        .map(value => Number(value))
        .filter(Number.isInteger),
    allowed_days_json: undefined,
    schedule_times_json: undefined,
    content_item_ids_json: undefined,
});

const validateContentItems = (database, tenantId, values = []) => {
    const ids = [...new Set((Array.isArray(values) ? values : [])
        .map(value => Number.parseInt(value, 10))
        .filter(Number.isInteger))]
        .slice(0, 500);
    if (!ids.length) return [];
    const placeholders = ids.map(() => '?').join(', ');
    const owned = database.prepare(`
        SELECT id
        FROM facebook_content_items
        WHERE tenant_id = ? AND status != 'archived'
          AND id IN (${placeholders})
    `).all(tenantId, ...ids).map(row => row.id);
    if (owned.length !== ids.length) {
        throw contentError('بعض عناصر المحتوى غير موجودة أو لا تتبع العميل', 404, 'CONTENT_ITEM_NOT_FOUND');
    }
    return ids;
};

const replaceCampaignItems = (database, campaignId, tenantId, itemIds) => {
    const ids = validateContentItems(database, tenantId, itemIds);
    const transaction = database.transaction(() => {
        database.prepare('DELETE FROM facebook_content_campaign_items WHERE campaign_id = ?').run(campaignId);
        const insert = database.prepare(`
            INSERT INTO facebook_content_campaign_items (
                campaign_id, content_item_id, sort_order, weight, is_active
            ) VALUES (?, ?, ?, 1, 1)
        `);
        ids.forEach((itemId, index) => insert.run(campaignId, itemId, index));
    });
    transaction();
    return ids;
};

const loadCampaign = (database, tenantId, campaignId) => {
    const campaign = database.prepare(`
        SELECT c.*, tp.page_name,
               (
                   SELECT json_group_array(content_item_id)
                   FROM facebook_content_campaign_items
                   WHERE campaign_id = c.id AND is_active = 1
                   ORDER BY sort_order, id
               ) AS content_item_ids_json
        FROM facebook_content_campaigns c
        JOIN tenant_pages tp ON tp.id = c.linked_page_id AND tp.tenant_id = c.tenant_id
        WHERE c.id = ? AND c.tenant_id = ?
        LIMIT 1
    `).get(campaignId, tenantId);
    if (!campaign) throw contentError('الحملة غير موجودة', 404, 'CAMPAIGN_NOT_FOUND');
    return campaign;
};

const normalizeCampaign = (body, current = {}) => {
    const sourceMode = body.source_mode ?? current.source_mode ?? 'library';
    const rotationMode = body.rotation_mode ?? current.rotation_mode ?? 'sequential';
    const status = body.status ?? current.status ?? 'draft';
    const timezone = boundedText(body.timezone ?? current.timezone ?? 'Africa/Tripoli', {
        field: 'المنطقة الزمنية',
        max: 100,
        required: true,
    });
    if (!SOURCE_MODES.has(sourceMode)) throw contentError('مصدر الحملة غير صالح');
    if (!ROTATION_MODES.has(rotationMode)) throw contentError('طريقة التدوير غير صالحة');
    if (!CAMPAIGN_STATUSES.has(status)) throw contentError('حالة الحملة غير صالحة');
    if (!isValidTimeZone(timezone)) throw contentError('المنطقة الزمنية غير صالحة');
    return {
        name: boundedText(body.name ?? current.name, { field: 'اسم الحملة', max: 160, required: true }),
        description: boundedText(body.description ?? current.description, {
            field: 'وصف الحملة',
            max: 1000,
            fallback: null,
        }),
        source_mode: sourceMode,
        rotation_mode: rotationMode,
        product_category: boundedText(body.product_category ?? current.product_category, {
            field: 'تصنيف المنتجات',
            max: 160,
            fallback: null,
        }),
        product_template: boundedText(body.product_template ?? current.product_template, {
            field: 'قالب المنتج',
            max: 5000,
            fallback: null,
        }),
        timezone,
        allowed_days: normalizeScheduleDays(body.allowed_days ?? parseStoredList(current.allowed_days_json, [])),
        schedule_times: normalizeScheduleTimes(body.schedule_times ?? parseStoredList(current.schedule_times_json, [])),
        no_repeat_days: boundedInteger(body.no_repeat_days ?? current.no_repeat_days, {
            field: 'فترة منع التكرار',
            min: 0,
            max: 365,
            fallback: 14,
        }),
        max_posts_per_day: boundedInteger(body.max_posts_per_day ?? current.max_posts_per_day, {
            field: 'الحد اليومي للحملة',
            min: 1,
            max: 24,
            fallback: 2,
        }),
        approval_required: booleanValue(body.approval_required, current.approval_required !== 0),
        status,
    };
};

export function createFacebookContentCampaignsRouter({ database } = {}) {
    if (!database) throw new TypeError('database is required');
    const router = express.Router();

    router.get('/campaigns', (req, res) => {
        try {
            const tenant = requireContentTenant(database, req, res);
            if (!tenant) return;
            const { limit, offset } = parseListPagination(req.query, {
                defaultLimit: 30,
                maxLimit: 100,
            });
            const clauses = ['c.tenant_id = ?'];
            const params = [tenant.id];
            if (req.query.status) {
                if (!CAMPAIGN_STATUSES.has(req.query.status)) throw contentError('حالة الحملة غير صالحة');
                clauses.push('c.status = ?');
                params.push(req.query.status);
            }
            if (req.query.linked_page_id) {
                const page = requireContentPage(database, tenant.id, req.query.linked_page_id);
                clauses.push('c.linked_page_id = ?');
                params.push(page.id);
            }
            const where = clauses.join(' AND ');
            const campaigns = database.prepare(`
                SELECT c.*, tp.page_name,
                       (
                           SELECT json_group_array(content_item_id)
                           FROM facebook_content_campaign_items
                           WHERE campaign_id = c.id AND is_active = 1
                           ORDER BY sort_order, id
                       ) AS content_item_ids_json,
                       (
                           SELECT COUNT(*)
                           FROM facebook_content_publications publication
                           WHERE publication.campaign_id = c.id AND publication.status = 'published'
                       ) AS published_count,
                       (
                           SELECT COUNT(*)
                           FROM facebook_content_publications publication
                           WHERE publication.campaign_id = c.id AND publication.status = 'failed'
                       ) AS failed_count
                FROM facebook_content_campaigns c
                JOIN tenant_pages tp ON tp.id = c.linked_page_id AND tp.tenant_id = c.tenant_id
                WHERE ${where}
                ORDER BY c.updated_at DESC, c.id DESC
                LIMIT ? OFFSET ?
            `).all(...params, limit, offset).map(presentCampaign);
            const total = database.prepare(`
                SELECT COUNT(*) AS count
                FROM facebook_content_campaigns c
                WHERE ${where}
            `).get(...params).count;
            res.json({ campaigns, total, limit, offset });
        } catch (error) {
            sendContentError(res, error, 'فشل جلب حملات المحتوى');
        }
    });

    router.post('/campaigns', (req, res) => {
        try {
            const tenant = requireContentTenant(database, req, res);
            if (!tenant) return;
            const page = requireContentPage(database, tenant.id, req.body.linked_page_id);
            const campaign = normalizeCampaign(req.body);
            const nextRun = campaign.status === 'active'
                ? nextCampaignRun({
                    from: new Date(),
                    timeZone: campaign.timezone,
                    days: campaign.allowed_days,
                    times: campaign.schedule_times,
                })
                : null;
            const result = database.prepare(`
                INSERT INTO facebook_content_campaigns (
                    tenant_id, linked_page_id, name, description, source_mode,
                    rotation_mode, product_category, product_template, timezone,
                    allowed_days_json, schedule_times_json, no_repeat_days,
                    max_posts_per_day, approval_required, status, next_run_at,
                    created_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                tenant.id,
                page.id,
                campaign.name,
                campaign.description,
                campaign.source_mode,
                campaign.rotation_mode,
                campaign.product_category,
                campaign.product_template,
                campaign.timezone,
                JSON.stringify(campaign.allowed_days),
                JSON.stringify(campaign.schedule_times),
                campaign.no_repeat_days,
                campaign.max_posts_per_day,
                campaign.approval_required ? 1 : 0,
                campaign.status,
                nextRun?.toISOString() || null,
                req.user?.id || null,
            );
            replaceCampaignItems(database, result.lastInsertRowid, tenant.id, req.body.content_item_ids);
            res.status(201).json(presentCampaign(loadCampaign(database, tenant.id, result.lastInsertRowid)));
        } catch (error) {
            sendContentError(res, error, 'فشل إنشاء حملة المحتوى');
        }
    });

    router.patch('/campaigns/:id', (req, res) => {
        try {
            const tenant = requireContentTenant(database, req, res);
            if (!tenant) return;
            const existing = loadCampaign(database, tenant.id, req.params.id);
            const page = Object.hasOwn(req.body, 'linked_page_id')
                ? requireContentPage(database, tenant.id, req.body.linked_page_id)
                : { id: existing.linked_page_id };
            const campaign = normalizeCampaign(req.body, existing);
            const nextRun = campaign.status === 'active'
                ? nextCampaignRun({
                    from: new Date(),
                    timeZone: campaign.timezone,
                    days: campaign.allowed_days,
                    times: campaign.schedule_times,
                })
                : null;
            database.prepare(`
                UPDATE facebook_content_campaigns
                SET linked_page_id = ?, name = ?, description = ?, source_mode = ?,
                    rotation_mode = ?, product_category = ?, product_template = ?,
                    timezone = ?, allowed_days_json = ?, schedule_times_json = ?,
                    no_repeat_days = ?, max_posts_per_day = ?, approval_required = ?,
                    status = ?, next_run_at = ?, consecutive_failures = 0,
                    last_error = NULL, updated_at = datetime('now')
                WHERE id = ? AND tenant_id = ?
            `).run(
                page.id,
                campaign.name,
                campaign.description,
                campaign.source_mode,
                campaign.rotation_mode,
                campaign.product_category,
                campaign.product_template,
                campaign.timezone,
                JSON.stringify(campaign.allowed_days),
                JSON.stringify(campaign.schedule_times),
                campaign.no_repeat_days,
                campaign.max_posts_per_day,
                campaign.approval_required ? 1 : 0,
                campaign.status,
                nextRun?.toISOString() || null,
                existing.id,
                tenant.id,
            );
            if (Object.hasOwn(req.body, 'content_item_ids')) {
                replaceCampaignItems(database, existing.id, tenant.id, req.body.content_item_ids);
            }
            res.json(presentCampaign(loadCampaign(database, tenant.id, existing.id)));
        } catch (error) {
            sendContentError(res, error, 'فشل تحديث حملة المحتوى');
        }
    });

    router.post('/campaigns/:id/toggle', (req, res) => {
        try {
            const tenant = requireContentTenant(database, req, res);
            if (!tenant) return;
            const existing = loadCampaign(database, tenant.id, req.params.id);
            if (existing.status === 'completed') throw contentError('الحملة المكتملة لا يمكن تفعيلها');
            const activate = existing.status !== 'active';
            const nextRun = activate
                ? nextCampaignRun({
                    from: new Date(),
                    timeZone: existing.timezone,
                    days: parseStoredList(existing.allowed_days_json, []),
                    times: parseStoredList(existing.schedule_times_json, []),
                })
                : null;
            database.prepare(`
                UPDATE facebook_content_campaigns
                SET status = ?, next_run_at = ?, consecutive_failures = 0,
                    last_error = NULL, updated_at = datetime('now')
                WHERE id = ? AND tenant_id = ?
            `).run(activate ? 'active' : 'paused', nextRun?.toISOString() || null, existing.id, tenant.id);
            res.json(presentCampaign(loadCampaign(database, tenant.id, existing.id)));
        } catch (error) {
            sendContentError(res, error, 'فشل تغيير حالة الحملة');
        }
    });

    router.post('/campaigns/:id/run-now', (req, res) => {
        try {
            const tenant = requireContentTenant(database, req, res);
            if (!tenant) return;
            const campaign = loadCampaign(database, tenant.id, req.params.id);
            const source = selectCampaignSource(database, campaign, { now: new Date() });
            if (!source) throw contentError('لا يوجد محتوى مؤهل وغير مكرر للنشر', 409, 'NO_ELIGIBLE_CONTENT');
            const publication = createContentPublication(database, {
                tenantId: tenant.id,
                linkedPageId: campaign.linked_page_id,
                campaignId: campaign.id,
                contentItemId: source.content_item_id,
                productId: source.product_id,
                scheduledFor: new Date(),
                renderedMessage: source.rendered_message,
                linkUrl: source.link_url,
                mediaUrl: source.media_url,
                createdBy: req.user?.id || null,
                idempotencyKey: `facebook-campaign-manual:${campaign.id}:${Date.now()}`,
            });
            database.prepare(`
                UPDATE facebook_content_campaigns
                SET cursor_position = cursor_position + 1, updated_at = datetime('now')
                WHERE id = ? AND tenant_id = ?
            `).run(campaign.id, tenant.id);
            res.status(201).json(publication);
        } catch (error) {
            sendContentError(res, error, 'فشل تشغيل الحملة الآن');
        }
    });

    router.delete('/campaigns/:id', (req, res) => {
        try {
            const tenant = requireContentTenant(database, req, res);
            if (!tenant) return;
            const result = database.prepare(`
                UPDATE facebook_content_campaigns
                SET status = 'completed', next_run_at = NULL,
                    updated_at = datetime('now')
                WHERE id = ? AND tenant_id = ?
            `).run(req.params.id, tenant.id);
            if (!result.changes) throw contentError('الحملة غير موجودة', 404, 'CAMPAIGN_NOT_FOUND');
            res.json({ success: true });
        } catch (error) {
            sendContentError(res, error, 'فشل إنهاء الحملة');
        }
    });

    return router;
}
