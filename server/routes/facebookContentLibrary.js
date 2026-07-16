import express from 'express';

import { parseListPagination } from '../services/pagination.js';
import {
    CONTENT_ITEM_KINDS,
    CONTENT_ITEM_STATUSES,
    boundedText,
    contentError,
    getEffectiveContentSettings,
    normalizeOptionalUrl,
    normalizeStringList,
    renderProductPost,
    requireContentPage,
    requireContentTenant,
    requireSharedProduct,
    sendContentError,
} from './facebookContentStudioShared.js';

const presentItem = row => ({
    ...row,
    tags: normalizeStringList(row.tags_json),
    tags_json: undefined,
});

const approvalFields = (status, userId) => (
    status === 'approved'
        ? { approvedBy: userId || null, approvedAt: new Date().toISOString() }
        : { approvedBy: null, approvedAt: null }
);

const FACEBOOK_POST_IMPORT_VERSION = 'facebook-post-import-v1';

export function createFacebookContentLibraryRouter({ database } = {}) {
    if (!database) throw new TypeError('database is required');
    const router = express.Router();

    router.get('/products', (req, res) => {
        try {
            const tenant = requireContentTenant(database, req, res);
            if (!tenant) return;
            const { limit, offset } = parseListPagination(req.query, {
                defaultLimit: 50,
                maxLimit: 200,
            });
            const clauses = ['p.tenant_id = ?'];
            const params = [tenant.id];
            if (req.query.search) {
                clauses.push('(p.name LIKE ? OR p.sku LIKE ? OR p.description LIKE ? OR p.category LIKE ?)');
                const search = `%${String(req.query.search).trim()}%`;
                params.push(search, search, search, search);
            }
            if (req.query.category) {
                clauses.push('LOWER(p.category) = LOWER(?)');
                params.push(String(req.query.category).trim());
            }
            if (req.query.available !== 'false') {
                clauses.push("p.is_active = 1 AND p.availability = 'available'");
            }
            const where = clauses.join(' AND ');
            const products = database.prepare(`
                SELECT p.*,
                       (
                           SELECT image_url
                           FROM bot_product_images
                           WHERE product_id = p.id AND tenant_id = p.tenant_id
                           ORDER BY is_primary DESC, sort_order ASC, id ASC
                           LIMIT 1
                       ) AS primary_image_url
                FROM bot_products p
                WHERE ${where}
                ORDER BY p.updated_at DESC, p.id DESC
                LIMIT ? OFFSET ?
            `).all(...params, limit, offset).map(product => ({
                ...product,
                image_url: product.primary_image_url || product.image_url || null,
                primary_image_url: undefined,
            }));
            const total = database.prepare(`
                SELECT COUNT(*) AS count
                FROM bot_products p
                WHERE ${where}
            `).get(...params).count;
            const categories = database.prepare(`
                SELECT DISTINCT category
                FROM bot_products
                WHERE tenant_id = ? AND is_active = 1 AND category IS NOT NULL AND category != ''
                ORDER BY category
            `).all(tenant.id).map(row => row.category);
            res.json({ products, categories, total, limit, offset });
        } catch (error) {
            sendContentError(res, error, 'فشل جلب المنتجات المشتركة');
        }
    });

    router.get('/items', (req, res) => {
        try {
            const tenant = requireContentTenant(database, req, res);
            if (!tenant) return;
            const { limit, offset } = parseListPagination(req.query, {
                defaultLimit: 30,
                maxLimit: 100,
            });
            const clauses = ['i.tenant_id = ?'];
            const params = [tenant.id];
            if (req.query.status) {
                if (!CONTENT_ITEM_STATUSES.has(req.query.status)) throw contentError('حالة المحتوى غير صالحة');
                clauses.push('i.status = ?');
                params.push(req.query.status);
            } else {
                clauses.push("i.status != 'archived'");
            }
            if (req.query.kind) {
                if (!CONTENT_ITEM_KINDS.has(req.query.kind)) throw contentError('نوع المحتوى غير صالح');
                clauses.push('i.kind = ?');
                params.push(req.query.kind);
            }
            if (req.query.linked_page_id) {
                const page = requireContentPage(database, tenant.id, req.query.linked_page_id);
                clauses.push('(i.linked_page_id IS NULL OR i.linked_page_id = ?)');
                params.push(page.id);
            }
            if (req.query.search) {
                clauses.push('(i.title LIKE ? OR i.body LIKE ?)');
                const search = `%${String(req.query.search).trim()}%`;
                params.push(search, search);
            }
            if (req.query.source_post_id) {
                clauses.push('i.source_post_id = ?');
                params.push(boundedText(req.query.source_post_id, {
                    field: 'معرف المنشور المصدر',
                    max: 512,
                    required: true,
                }));
            }
            const where = clauses.join(' AND ');
            const items = database.prepare(`
                SELECT i.*,
                       p.name AS product_name,
                       p.sku AS product_sku,
                       tp.page_name
                FROM facebook_content_items i
                LEFT JOIN bot_products p ON p.id = i.product_id AND p.tenant_id = i.tenant_id
                LEFT JOIN tenant_pages tp ON tp.id = i.linked_page_id AND tp.tenant_id = i.tenant_id
                WHERE ${where}
                ORDER BY i.updated_at DESC, i.id DESC
                LIMIT ? OFFSET ?
            `).all(...params, limit, offset).map(presentItem);
            const total = database.prepare(`
                SELECT COUNT(*) AS count
                FROM facebook_content_items i
                WHERE ${where}
            `).get(...params).count;
            res.json({ items, total, limit, offset });
        } catch (error) {
            sendContentError(res, error, 'فشل جلب مكتبة المحتوى');
        }
    });

    router.post('/items/from-post', (req, res) => {
        try {
            const tenant = requireContentTenant(database, req, res);
            if (!tenant) return;
            const page = requireContentPage(database, tenant.id, req.body.linked_page_id);
            const sourcePostId = boundedText(req.body.source_post_id, {
                field: 'معرف المنشور المصدر',
                max: 512,
                required: true,
            });
            const body = boundedText(req.body.body, {
                field: 'نص المنشور',
                max: 5000,
                required: true,
            });
            const sourcePostUrl = normalizeOptionalUrl(req.body.source_post_url, 'رابط المنشور المصدر');
            const duplicate = req.body.duplicate === true;
            if (!duplicate) {
                const existing = database.prepare(`
                    SELECT i.*, tp.page_name
                    FROM facebook_content_items i
                    LEFT JOIN tenant_pages tp ON tp.id = i.linked_page_id
                    WHERE i.tenant_id = ? AND i.linked_page_id = ?
                      AND i.source_post_id = ?
                      AND i.prompt_version = ?
                      AND i.status != 'archived'
                    ORDER BY i.id DESC
                    LIMIT 1
                `).get(tenant.id, page.id, sourcePostId, FACEBOOK_POST_IMPORT_VERSION);
                if (existing) {
                    return res.json({ ...presentItem(existing), reused: true });
                }
            }
            const fallbackTitle = body.split(/\r?\n/).map(line => line.trim()).find(Boolean) || 'منشور Facebook';
            const result = database.prepare(`
                INSERT INTO facebook_content_items (
                    tenant_id, linked_page_id, kind, title, body, link_url,
                    media_url, tags_json, status, source_text, prompt_version,
                    source_post_id, source_post_url, created_by
                ) VALUES (?, ?, 'manual', ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)
            `).run(
                tenant.id,
                page.id,
                boundedText(req.body.title || fallbackTitle, {
                    field: 'العنوان',
                    max: 160,
                    required: true,
                }),
                body,
                normalizeOptionalUrl(req.body.link_url, 'الرابط'),
                normalizeOptionalUrl(req.body.media_url, 'رابط الوسائط'),
                JSON.stringify(normalizeStringList(req.body.tags)),
                body,
                FACEBOOK_POST_IMPORT_VERSION,
                sourcePostId,
                sourcePostUrl,
                req.user?.id || null,
            );
            const item = database.prepare(`
                SELECT i.*, tp.page_name
                FROM facebook_content_items i
                LEFT JOIN tenant_pages tp ON tp.id = i.linked_page_id
                WHERE i.id = ? AND i.tenant_id = ?
            `).get(result.lastInsertRowid, tenant.id);
            res.status(201).json({ ...presentItem(item), reused: false });
        } catch (error) {
            sendContentError(res, error, 'فشل استيراد المنشور إلى المكتبة');
        }
    });

    router.post('/items/from-product/:productId', (req, res) => {
        try {
            const tenant = requireContentTenant(database, req, res);
            if (!tenant) return;
            const product = requireSharedProduct(database, tenant.id, req.params.productId, { activeOnly: true });
            const linkedPageId = req.body.linked_page_id
                ? requireContentPage(database, tenant.id, req.body.linked_page_id).id
                : null;
            const settings = getEffectiveContentSettings(database, tenant.id, linkedPageId);
            const body = renderProductPost(req.body.template, product);
            const title = boundedText(req.body.title || product.name, {
                field: 'العنوان',
                max: 160,
                required: true,
            });
            const status = settings.approval_mode === 'automatic' ? 'approved' : 'draft';
            const approval = approvalFields(status, req.user?.id);
            const result = database.prepare(`
                INSERT INTO facebook_content_items (
                    tenant_id, linked_page_id, product_id, kind, title, body,
                    link_url, media_url, tags_json, status, approved_by,
                    approved_at, created_by
                ) VALUES (?, ?, ?, 'product', ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                tenant.id,
                linkedPageId,
                product.id,
                title,
                body,
                normalizeOptionalUrl(req.body.link_url || product.product_url, 'رابط المنتج'),
                normalizeOptionalUrl(req.body.media_url || product.image_url, 'رابط الصورة'),
                JSON.stringify(normalizeStringList(req.body.tags)),
                status,
                approval.approvedBy,
                approval.approvedAt,
                req.user?.id || null,
            );
            const item = database.prepare(`
                SELECT i.*, p.name AS product_name, p.sku AS product_sku, tp.page_name
                FROM facebook_content_items i
                LEFT JOIN bot_products p ON p.id = i.product_id
                LEFT JOIN tenant_pages tp ON tp.id = i.linked_page_id
                WHERE i.id = ? AND i.tenant_id = ?
            `).get(result.lastInsertRowid, tenant.id);
            res.status(201).json(presentItem(item));
        } catch (error) {
            sendContentError(res, error, 'فشل إنشاء محتوى المنتج');
        }
    });

    router.post('/items', (req, res) => {
        try {
            const tenant = requireContentTenant(database, req, res);
            if (!tenant) return;
            const linkedPageId = req.body.linked_page_id
                ? requireContentPage(database, tenant.id, req.body.linked_page_id).id
                : null;
            const product = req.body.product_id
                ? requireSharedProduct(database, tenant.id, req.body.product_id)
                : null;
            const kind = CONTENT_ITEM_KINDS.has(req.body.kind) ? req.body.kind : (product ? 'product' : 'manual');
            const status = CONTENT_ITEM_STATUSES.has(req.body.status) ? req.body.status : 'draft';
            const approval = approvalFields(status, req.user?.id);
            const result = database.prepare(`
                INSERT INTO facebook_content_items (
                    tenant_id, linked_page_id, product_id, kind, title, body,
                    link_url, media_url, tags_json, status, source_text,
                    prompt_version, source_post_id, source_post_url,
                    approved_by, approved_at, created_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                tenant.id,
                linkedPageId,
                product?.id || null,
                kind,
                boundedText(req.body.title, { field: 'العنوان', max: 160, required: true }),
                boundedText(req.body.body, { field: 'المحتوى', max: 5000, required: true }),
                normalizeOptionalUrl(req.body.link_url, 'الرابط'),
                normalizeOptionalUrl(req.body.media_url, 'رابط الوسائط'),
                JSON.stringify(normalizeStringList(req.body.tags)),
                status,
                boundedText(req.body.source_text, { field: 'النص المصدر', max: 5000, fallback: null }),
                boundedText(req.body.prompt_version, { field: 'نسخة الموجه', max: 80, fallback: null }),
                boundedText(req.body.source_post_id, {
                    field: 'معرف المنشور المصدر',
                    max: 512,
                    fallback: null,
                }),
                normalizeOptionalUrl(req.body.source_post_url, 'رابط المنشور المصدر'),
                approval.approvedBy,
                approval.approvedAt,
                req.user?.id || null,
            );
            const item = database.prepare('SELECT * FROM facebook_content_items WHERE id = ? AND tenant_id = ?')
                .get(result.lastInsertRowid, tenant.id);
            res.status(201).json(presentItem(item));
        } catch (error) {
            sendContentError(res, error, 'فشل إنشاء عنصر المحتوى');
        }
    });

    router.patch('/items/:id', (req, res) => {
        try {
            const tenant = requireContentTenant(database, req, res);
            if (!tenant) return;
            const existing = database.prepare(`
                SELECT * FROM facebook_content_items WHERE id = ? AND tenant_id = ?
            `).get(req.params.id, tenant.id);
            if (!existing) throw contentError('عنصر المحتوى غير موجود', 404, 'CONTENT_ITEM_NOT_FOUND');
            const linkedPageId = Object.hasOwn(req.body, 'linked_page_id')
                ? (req.body.linked_page_id
                    ? requireContentPage(database, tenant.id, req.body.linked_page_id).id
                    : null)
                : existing.linked_page_id;
            const productId = Object.hasOwn(req.body, 'product_id')
                ? (req.body.product_id
                    ? requireSharedProduct(database, tenant.id, req.body.product_id).id
                    : null)
                : existing.product_id;
            const contentChanged = ['title', 'body', 'link_url', 'media_url']
                .some(field => Object.hasOwn(req.body, field));
            const requestedStatus = req.body.status;
            if (requestedStatus && !CONTENT_ITEM_STATUSES.has(requestedStatus)) {
                throw contentError('حالة المحتوى غير صالحة');
            }
            const status = requestedStatus || (contentChanged && existing.status === 'approved' ? 'draft' : existing.status);
            const approval = approvalFields(status, req.user?.id);
            database.prepare(`
                UPDATE facebook_content_items
                SET linked_page_id = ?, product_id = ?, kind = ?, title = ?, body = ?,
                    link_url = ?, media_url = ?, tags_json = ?, status = ?,
                    approved_by = ?, approved_at = ?, updated_at = datetime('now')
                WHERE id = ? AND tenant_id = ?
            `).run(
                linkedPageId,
                productId,
                CONTENT_ITEM_KINDS.has(req.body.kind) ? req.body.kind : existing.kind,
                boundedText(req.body.title ?? existing.title, { field: 'العنوان', max: 160, required: true }),
                boundedText(req.body.body ?? existing.body, { field: 'المحتوى', max: 5000, required: true }),
                normalizeOptionalUrl(req.body.link_url ?? existing.link_url, 'الرابط'),
                normalizeOptionalUrl(req.body.media_url ?? existing.media_url, 'رابط الوسائط'),
                JSON.stringify(normalizeStringList(req.body.tags ?? existing.tags_json)),
                status,
                approval.approvedBy,
                approval.approvedAt,
                existing.id,
                tenant.id,
            );
            res.json(presentItem(database.prepare(`
                SELECT * FROM facebook_content_items WHERE id = ? AND tenant_id = ?
            `).get(existing.id, tenant.id)));
        } catch (error) {
            sendContentError(res, error, 'فشل تحديث عنصر المحتوى');
        }
    });

    router.post('/items/:id/approve', (req, res) => {
        try {
            const tenant = requireContentTenant(database, req, res);
            if (!tenant) return;
            const result = database.prepare(`
                UPDATE facebook_content_items
                SET status = 'approved', approved_by = ?, approved_at = datetime('now'),
                    updated_at = datetime('now')
                WHERE id = ? AND tenant_id = ? AND status != 'archived'
            `).run(req.user?.id || null, req.params.id, tenant.id);
            if (!result.changes) throw contentError('عنصر المحتوى غير موجود', 404, 'CONTENT_ITEM_NOT_FOUND');
            res.json(presentItem(database.prepare(`
                SELECT * FROM facebook_content_items WHERE id = ? AND tenant_id = ?
            `).get(req.params.id, tenant.id)));
        } catch (error) {
            sendContentError(res, error, 'فشل اعتماد المحتوى');
        }
    });

    router.delete('/items/:id', (req, res) => {
        try {
            const tenant = requireContentTenant(database, req, res);
            if (!tenant) return;
            const result = database.prepare(`
                UPDATE facebook_content_items
                SET status = 'archived', updated_at = datetime('now')
                WHERE id = ? AND tenant_id = ?
            `).run(req.params.id, tenant.id);
            if (!result.changes) throw contentError('عنصر المحتوى غير موجود', 404, 'CONTENT_ITEM_NOT_FOUND');
            res.json({ success: true });
        } catch (error) {
            sendContentError(res, error, 'فشل أرشفة المحتوى');
        }
    });

    return router;
}
