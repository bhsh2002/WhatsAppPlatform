import crypto from 'node:crypto';
import express from 'express';

import { createContentPublication } from '../services/facebookContentScheduler.js';
import { parseListPagination } from '../services/pagination.js';
import {
    boundedText,
    contentError,
    getEffectiveContentSettings,
    renderProductPost,
    requireContentPage,
    requireContentTenant,
    requireSharedProduct,
    sendContentError,
} from './facebookContentStudioShared.js';

const PUBLICATION_STATUSES = new Set(['pending', 'processing', 'published', 'failed', 'skipped', 'cancelled']);

const parseDate = (value, { fallback = null, field = 'التاريخ' } = {}) => {
    if (!value) return fallback;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw contentError(`${field} غير صالح`, 400, 'INVALID_DATE');
    return parsed;
};

export function createFacebookContentPublicationsRouter({ database } = {}) {
    if (!database) throw new TypeError('database is required');
    const router = express.Router();

    router.get('/publications', (req, res) => {
        try {
            const tenant = requireContentTenant(database, req, res);
            if (!tenant) return;
            const { limit, offset } = parseListPagination(req.query, {
                defaultLimit: 50,
                maxLimit: 200,
            });
            const clauses = ['publication.tenant_id = ?'];
            const params = [tenant.id];
            if (req.query.status) {
                if (!PUBLICATION_STATUSES.has(req.query.status)) throw contentError('حالة النشر غير صالحة');
                clauses.push('publication.status = ?');
                params.push(req.query.status);
            }
            if (req.query.linked_page_id) {
                const page = requireContentPage(database, tenant.id, req.query.linked_page_id);
                clauses.push('publication.linked_page_id = ?');
                params.push(page.id);
            }
            const start = parseDate(req.query.start, { field: 'بداية الفترة' });
            const end = parseDate(req.query.end, { field: 'نهاية الفترة' });
            if (start) {
                clauses.push('publication.scheduled_for >= ?');
                params.push(start.toISOString());
            }
            if (end) {
                clauses.push('publication.scheduled_for <= ?');
                params.push(end.toISOString());
            }
            const where = clauses.join(' AND ');
            const publications = database.prepare(`
                SELECT publication.*, tp.page_name, c.name AS campaign_name,
                       i.title AS content_title, p.name AS product_name, p.sku AS product_sku
                FROM facebook_content_publications publication
                JOIN tenant_pages tp
                  ON tp.id = publication.linked_page_id
                 AND tp.tenant_id = publication.tenant_id
                LEFT JOIN facebook_content_campaigns c ON c.id = publication.campaign_id
                LEFT JOIN facebook_content_items i ON i.id = publication.content_item_id
                LEFT JOIN bot_products p ON p.id = publication.product_id
                WHERE ${where}
                ORDER BY publication.scheduled_for DESC, publication.id DESC
                LIMIT ? OFFSET ?
            `).all(...params, limit, offset);
            const total = database.prepare(`
                SELECT COUNT(*) AS count
                FROM facebook_content_publications publication
                WHERE ${where}
            `).get(...params).count;
            const summary = database.prepare(`
                SELECT status, COUNT(*) AS count
                FROM facebook_content_publications
                WHERE tenant_id = ?
                GROUP BY status
            `).all(tenant.id).reduce((result, row) => {
                result[row.status] = row.count;
                return result;
            }, {});
            res.json({ publications, summary, total, limit, offset });
        } catch (error) {
            sendContentError(res, error, 'فشل جلب تقويم النشر');
        }
    });

    router.post('/publications', (req, res) => {
        try {
            const tenant = requireContentTenant(database, req, res);
            if (!tenant) return;
            const page = requireContentPage(database, tenant.id, req.body.linked_page_id);
            const settings = getEffectiveContentSettings(database, tenant.id, page.id);
            const requestedDate = parseDate(req.body.scheduled_for, {
                fallback: new Date(),
                field: 'موعد النشر',
            });
            const scheduledFor = requestedDate.getTime() < Date.now() ? new Date() : requestedDate;
            let item = null;
            let product = null;
            if (req.body.content_item_id) {
                item = database.prepare(`
                    SELECT *
                    FROM facebook_content_items
                    WHERE id = ? AND tenant_id = ? AND status != 'archived'
                `).get(req.body.content_item_id, tenant.id);
                if (!item) throw contentError('عنصر المحتوى غير موجود', 404, 'CONTENT_ITEM_NOT_FOUND');
                if (item.linked_page_id && item.linked_page_id !== page.id) {
                    throw contentError('عنصر المحتوى مخصص لصفحة أخرى', 409, 'CONTENT_PAGE_MISMATCH');
                }
                if (settings.approval_mode !== 'automatic' && item.status !== 'approved') {
                    throw contentError('يجب اعتماد المحتوى قبل جدولته', 409, 'CONTENT_APPROVAL_REQUIRED');
                }
            } else if (req.body.product_id) {
                product = requireSharedProduct(database, tenant.id, req.body.product_id, { activeOnly: true });
            } else {
                throw contentError('اختر عنصراً من المكتبة أو منتجاً', 400, 'PUBLICATION_SOURCE_REQUIRED');
            }
            const renderedMessage = item
                ? item.body
                : renderProductPost(req.body.product_template, product);
            const publication = createContentPublication(database, {
                tenantId: tenant.id,
                linkedPageId: page.id,
                contentItemId: item?.id || null,
                productId: product?.id || null,
                scheduledFor,
                renderedMessage: boundedText(req.body.message_override || renderedMessage, {
                    field: 'محتوى المنشور',
                    max: 5000,
                    required: true,
                }),
                linkUrl: item?.link_url || product?.product_url || null,
                mediaUrl: item?.media_url || product?.image_url || null,
                createdBy: req.user?.id || null,
                idempotencyKey: boundedText(req.body.idempotency_key, {
                    field: 'مفتاح العملية',
                    max: 160,
                    fallback: `facebook-manual:${crypto.randomUUID()}`,
                }),
            });
            res.status(201).json(publication);
        } catch (error) {
            sendContentError(res, error, 'فشل جدولة المنشور');
        }
    });

    router.post('/publications/:id/retry', (req, res) => {
        try {
            const tenant = requireContentTenant(database, req, res);
            if (!tenant) return;
            const result = database.prepare(`
                UPDATE facebook_content_publications
                SET status = 'pending', scheduled_for = ?, next_attempt_at = ?,
                    attempts = 0, error_code = NULL, error_message = NULL,
                    claimed_at = NULL, claimed_by = NULL, updated_at = datetime('now')
                WHERE id = ? AND tenant_id = ? AND status = 'failed'
            `).run(new Date().toISOString(), new Date().toISOString(), req.params.id, tenant.id);
            if (!result.changes) {
                throw contentError('لا يوجد نشر فاشل قابل لإعادة المحاولة', 409, 'PUBLICATION_NOT_RETRYABLE');
            }
            res.json(database.prepare(`
                SELECT * FROM facebook_content_publications WHERE id = ? AND tenant_id = ?
            `).get(req.params.id, tenant.id));
        } catch (error) {
            sendContentError(res, error, 'فشلت إعادة محاولة النشر');
        }
    });

    router.post('/publications/:id/publish-now', (req, res) => {
        try {
            const tenant = requireContentTenant(database, req, res);
            if (!tenant) return;
            const now = new Date().toISOString();
            const result = database.prepare(`
                UPDATE facebook_content_publications
                SET scheduled_for = ?, next_attempt_at = ?, updated_at = datetime('now')
                WHERE id = ? AND tenant_id = ? AND status = 'pending'
            `).run(now, now, req.params.id, tenant.id);
            if (!result.changes) {
                throw contentError('المنشور غير موجود أو ليس في الانتظار', 409, 'PUBLICATION_NOT_PENDING');
            }
            res.json(database.prepare(`
                SELECT * FROM facebook_content_publications WHERE id = ? AND tenant_id = ?
            `).get(req.params.id, tenant.id));
        } catch (error) {
            sendContentError(res, error, 'فشل تقديم موعد النشر');
        }
    });

    router.delete('/publications/:id', (req, res) => {
        try {
            const tenant = requireContentTenant(database, req, res);
            if (!tenant) return;
            const result = database.prepare(`
                UPDATE facebook_content_publications
                SET status = 'cancelled', claimed_at = NULL, claimed_by = NULL,
                    updated_at = datetime('now')
                WHERE id = ? AND tenant_id = ? AND status IN ('pending', 'failed')
            `).run(req.params.id, tenant.id);
            if (!result.changes) throw contentError('عملية النشر غير قابلة للإلغاء', 409, 'PUBLICATION_NOT_CANCELLABLE');
            res.json({ success: true });
        } catch (error) {
            sendContentError(res, error, 'فشل إلغاء النشر');
        }
    });

    return router;
}
