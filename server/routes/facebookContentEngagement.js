import express from 'express';

import { parseListPagination } from '../services/pagination.js';
import {
    booleanValue,
    boundedText,
    contentError,
    requireContentPage,
    requireContentTenant,
    sendContentError,
} from './facebookContentStudioShared.js';

const FOLLOWUP_STATUSES = new Set(['open', 'resolved']);

const presentTemplate = row => ({
    ...row,
    is_active: Boolean(row.is_active),
});

const requireOwnedTemplate = (database, tenantId, templateId) => {
    const template = database.prepare(`
        SELECT *
        FROM facebook_comment_reply_templates
        WHERE id = ? AND tenant_id = ?
        LIMIT 1
    `).get(templateId, tenantId);
    if (!template) {
        throw contentError('قالب الرد غير موجود', 404, 'COMMENT_TEMPLATE_NOT_FOUND');
    }
    return template;
};

export function createFacebookContentEngagementRouter({ database } = {}) {
    if (!database) throw new TypeError('database is required');
    const router = express.Router();

    router.get('/comment-templates', (req, res) => {
        try {
            const tenant = requireContentTenant(database, req, res);
            if (!tenant) return;
            const page = req.query.linked_page_id
                ? requireContentPage(database, tenant.id, req.query.linked_page_id)
                : null;
            const rows = page
                ? database.prepare(`
                    SELECT *
                    FROM facebook_comment_reply_templates
                    WHERE tenant_id = ? AND is_active = 1
                      AND (linked_page_id IS NULL OR linked_page_id = ?)
                    ORDER BY linked_page_id IS NULL, updated_at DESC, id DESC
                `).all(tenant.id, page.id)
                : database.prepare(`
                    SELECT *
                    FROM facebook_comment_reply_templates
                    WHERE tenant_id = ? AND is_active = 1 AND linked_page_id IS NULL
                    ORDER BY updated_at DESC, id DESC
                `).all(tenant.id);
            res.json(rows.map(presentTemplate));
        } catch (error) {
            sendContentError(res, error, 'فشل جلب قوالب الرد');
        }
    });

    router.post('/comment-templates', (req, res) => {
        try {
            const tenant = requireContentTenant(database, req, res);
            if (!tenant) return;
            const page = req.body.linked_page_id
                ? requireContentPage(database, tenant.id, req.body.linked_page_id)
                : null;
            const name = boundedText(req.body.name, {
                field: 'اسم القالب',
                max: 120,
                required: true,
            });
            const body = boundedText(req.body.body, {
                field: 'نص الرد',
                max: 2000,
                required: true,
            });
            const existing = page
                ? database.prepare(`
                    SELECT id
                    FROM facebook_comment_reply_templates
                    WHERE tenant_id = ? AND linked_page_id = ? AND name = ?
                `).get(tenant.id, page.id, name)
                : database.prepare(`
                    SELECT id
                    FROM facebook_comment_reply_templates
                    WHERE tenant_id = ? AND linked_page_id IS NULL AND name = ?
                `).get(tenant.id, name);
            if (existing) {
                throw contentError('يوجد قالب رد بهذا الاسم في النطاق نفسه', 409, 'COMMENT_TEMPLATE_EXISTS');
            }
            const result = database.prepare(`
                INSERT INTO facebook_comment_reply_templates (
                    tenant_id, linked_page_id, name, body, is_active, created_by
                ) VALUES (?, ?, ?, ?, 1, ?)
            `).run(tenant.id, page?.id || null, name, body, req.user?.id || null);
            res.status(201).json(presentTemplate(
                database.prepare(`
                    SELECT *
                    FROM facebook_comment_reply_templates
                    WHERE id = ? AND tenant_id = ?
                `).get(result.lastInsertRowid, tenant.id)
            ));
        } catch (error) {
            sendContentError(res, error, 'فشل إنشاء قالب الرد');
        }
    });

    router.patch('/comment-templates/:id', (req, res) => {
        try {
            const tenant = requireContentTenant(database, req, res);
            if (!tenant) return;
            const existing = requireOwnedTemplate(database, tenant.id, req.params.id);
            const page = Object.hasOwn(req.body, 'linked_page_id')
                ? (req.body.linked_page_id
                    ? requireContentPage(database, tenant.id, req.body.linked_page_id)
                    : null)
                : { id: existing.linked_page_id };
            const name = boundedText(req.body.name ?? existing.name, {
                field: 'اسم القالب',
                max: 120,
                required: true,
            });
            const body = boundedText(req.body.body ?? existing.body, {
                field: 'نص الرد',
                max: 2000,
                required: true,
            });
            database.prepare(`
                UPDATE facebook_comment_reply_templates
                SET linked_page_id = ?, name = ?, body = ?, is_active = ?,
                    updated_at = datetime('now')
                WHERE id = ? AND tenant_id = ?
            `).run(
                page?.id || null,
                name,
                body,
                booleanValue(req.body.is_active, Boolean(existing.is_active)) ? 1 : 0,
                existing.id,
                tenant.id,
            );
            res.json(presentTemplate(requireOwnedTemplate(database, tenant.id, existing.id)));
        } catch (error) {
            if (String(error?.message || '').includes('UNIQUE constraint failed')) {
                return sendContentError(
                    res,
                    contentError('يوجد قالب رد بهذا الاسم في النطاق نفسه', 409, 'COMMENT_TEMPLATE_EXISTS'),
                    'فشل تحديث قالب الرد',
                );
            }
            sendContentError(res, error, 'فشل تحديث قالب الرد');
        }
    });

    router.delete('/comment-templates/:id', (req, res) => {
        try {
            const tenant = requireContentTenant(database, req, res);
            if (!tenant) return;
            const result = database.prepare(`
                DELETE FROM facebook_comment_reply_templates
                WHERE id = ? AND tenant_id = ?
            `).run(req.params.id, tenant.id);
            if (!result.changes) {
                throw contentError('قالب الرد غير موجود', 404, 'COMMENT_TEMPLATE_NOT_FOUND');
            }
            res.json({ success: true });
        } catch (error) {
            sendContentError(res, error, 'فشل حذف قالب الرد');
        }
    });

    router.get('/comment-followups', (req, res) => {
        try {
            const tenant = requireContentTenant(database, req, res);
            if (!tenant) return;
            const page = requireContentPage(database, tenant.id, req.query.linked_page_id);
            const status = req.query.status || 'open';
            if (!FOLLOWUP_STATUSES.has(status)) {
                throw contentError('حالة المتابعة غير صالحة');
            }
            const { limit, offset } = parseListPagination(req.query, {
                defaultLimit: 100,
                maxLimit: 200,
            });
            const clauses = [
                'tenant_id = ?',
                'linked_page_id = ?',
                'status = ?',
            ];
            const params = [tenant.id, page.id, status];
            if (req.query.post_id) {
                clauses.push('post_id = ?');
                params.push(boundedText(req.query.post_id, {
                    field: 'معرف المنشور',
                    max: 512,
                    required: true,
                }));
            }
            const rows = database.prepare(`
                SELECT *
                FROM facebook_comment_followups
                WHERE ${clauses.join(' AND ')}
                ORDER BY updated_at DESC, id DESC
                LIMIT ? OFFSET ?
            `).all(...params, limit, offset);
            res.json({ followups: rows, limit, offset });
        } catch (error) {
            sendContentError(res, error, 'فشل جلب متابعات التعليقات');
        }
    });

    router.put('/comment-followups/:commentId', (req, res) => {
        try {
            const tenant = requireContentTenant(database, req, res);
            if (!tenant) return;
            const page = requireContentPage(database, tenant.id, req.body.linked_page_id);
            const commentId = boundedText(req.params.commentId, {
                field: 'معرف التعليق',
                max: 512,
                required: true,
            });
            const postId = boundedText(req.body.post_id, {
                field: 'معرف المنشور',
                max: 512,
                required: true,
            });
            const status = req.body.status || 'open';
            if (!FOLLOWUP_STATUSES.has(status)) {
                throw contentError('حالة المتابعة غير صالحة');
            }
            const note = boundedText(req.body.note, {
                field: 'ملاحظة المتابعة',
                max: 1000,
                fallback: null,
            });
            const resolved = status === 'resolved';
            database.prepare(`
                INSERT INTO facebook_comment_followups (
                    tenant_id, linked_page_id, post_id, comment_id, status,
                    note, created_by, resolved_by, resolved_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(tenant_id, linked_page_id, comment_id) DO UPDATE SET
                    post_id = excluded.post_id,
                    status = excluded.status,
                    note = excluded.note,
                    resolved_by = excluded.resolved_by,
                    resolved_at = excluded.resolved_at,
                    updated_at = datetime('now')
            `).run(
                tenant.id,
                page.id,
                postId,
                commentId,
                status,
                note,
                req.user?.id || null,
                resolved ? (req.user?.id || null) : null,
                resolved ? new Date().toISOString() : null,
            );
            res.json(database.prepare(`
                SELECT *
                FROM facebook_comment_followups
                WHERE tenant_id = ? AND linked_page_id = ? AND comment_id = ?
            `).get(tenant.id, page.id, commentId));
        } catch (error) {
            sendContentError(res, error, 'فشل تحديث متابعة التعليق');
        }
    });

    return router;
}
