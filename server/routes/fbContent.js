import express from 'express';
import fs from 'fs';
import { Blob } from 'buffer';
import db from '../db/database.js';
import { META_API_BASE } from '../config/index.js';
import { decrypt } from '../services/encryption.js';
import { readMetaResponse, sendMetaFailure } from '../services/metaHttp.js';
import { imageUpload, cleanupFile } from '../config/upload.js';
import {
    BILLING_OPERATIONS,
    commit as commitBilling,
    handleBillingError,
    release as releaseBilling,
    reserve as reserveBilling,
} from '../services/billing.js';

const router = express.Router();

const resolvePageCredentials = (linkedPageId, tenantId = null) => {
    const page = tenantId
        ? db.prepare('SELECT * FROM tenant_pages WHERE id = ? AND tenant_id = ? AND is_active = 1')
            .get(linkedPageId, tenantId)
        : db.prepare('SELECT * FROM tenant_pages WHERE id = ? AND is_active = 1').get(linkedPageId);
    if (!page) return { error: 'الصفحة غير موجودة أو غير مفعلة', status: 404 };
    const accessToken = decrypt(page.page_access_token_encrypted);
    if (!accessToken) return { error: 'رمز الوصول غير صالح', status: 400 };
    return { page, accessToken };
};

const logFacebookActivity = (page, eventType, description, status = 'success') => {
    const tenant = db.prepare('SELECT name FROM tenants WHERE id = ?').get(page.tenant_id);
    db.prepare(`
        INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
        VALUES (?, ?, ?, ?, ?)
    `).run(page.tenant_id, tenant?.name || '', eventType, description, status);
};

const graphUrl = (path, params = {}) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
            search.set(key, String(value));
        }
    }
    return `${META_API_BASE}/${path}${search.toString() ? `?${search.toString()}` : ''}`;
};

const graphPostForm = async (path, accessToken, params = {}) => {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
            body.set(key, String(value));
        }
    }

    return fetch(`${META_API_BASE}/${path}`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
    });
};

const buildNativeFileForm = (file, caption) => {
    const form = new globalThis.FormData();
    const buffer = fs.readFileSync(file.path);
    const blob = new Blob([buffer], { type: file.mimetype || 'application/octet-stream' });
    form.append('source', blob, file.originalname || 'photo.jpg');
    if (caption) form.append('caption', caption);
    return form;
};

const normalizeLimit = (value, fallback = 25, max = 100) => {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(parsed, max);
};

const normalizeScheduledPublishTime = (value) => {
    if (!value) return null;
    if (Number.isFinite(Number(value))) return Math.floor(Number(value));

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        const error = new Error('وقت الجدولة غير صالح');
        error.status = 400;
        throw error;
    }

    return Math.floor(parsed.getTime() / 1000);
};

const normalizePostDateBoundary = (value, field) => {
    if (value === undefined || value === null || value === '') return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        const error = new Error(`${field} غير صالح`);
        error.status = 400;
        error.code = 'INVALID_DATE_RANGE';
        throw error;
    }
    return Math.floor(parsed.getTime() / 1000);
};

const POST_FIELDS = [
    'id',
    'message',
    'created_time',
    'full_picture',
    'permalink_url',
    'is_published',
    'scheduled_publish_time',
    'attachments{title,url,description,media,type}',
    'likes.limit(0).summary(true)',
    'comments.limit(0).summary(true)',
    'reactions.limit(0).summary(true)',
    'shares',
].join(',');

const COMMENT_FIELDS = [
    'id',
    'message',
    'created_time',
    'from{name,id,picture{url}}',
    'like_count',
    'can_like',
    'user_likes',
    'is_hidden',
    'attachment',
    'comment_count',
    'parent{id}',
    'comments.limit(0).summary(true)',
].join(',');

// ============================================
// List posts for a linked page
// ============================================
router.get('/:linkedPageId/posts', async (req, res) => {
    try {
        const { linkedPageId } = req.params;
        const { page, accessToken, error, status } = resolvePageCredentials(linkedPageId, req.user?.tenant_id);
        if (error) return res.status(status).json({ error });

        const { after } = req.query;
        const since = normalizePostDateBoundary(req.query.since, 'بداية الفترة');
        const until = normalizePostDateBoundary(req.query.until, 'نهاية الفترة');
        if (since !== null && until !== null && since > until) {
            const rangeError = new Error('بداية الفترة يجب أن تسبق نهايتها');
            rangeError.status = 400;
            rangeError.code = 'INVALID_DATE_RANGE';
            throw rangeError;
        }
        const limit = normalizeLimit(req.query.limit, 25, 50);
        const url = graphUrl(`${page.page_id}/posts`, {
            fields: POST_FIELDS,
            limit,
            after,
            since,
            until,
        });

        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${accessToken}` },
        });
        const metaResult = await readMetaResponse(response);
        const data = metaResult.data || {};

        if (!metaResult.ok) {
            return sendMetaFailure(res, metaResult, 'فشل جلب المنشورات');
        }

        res.json({ posts: data.data || [], paging: data.paging || null });
    } catch (error) {
        if (error.status) {
            return res.status(error.status).json({ error: error.message, code: error.code });
        }
        console.error('[FBContent] List posts error:', error);
        res.status(500).json({ error: 'فشل جلب المنشورات' });
    }
});

// ============================================
// Create a text/link post
// ============================================
router.post('/:linkedPageId/posts', async (req, res) => {
    let billingReservation = null;
    try {
        const { linkedPageId } = req.params;
        const { page, accessToken, error, status } = resolvePageCredentials(linkedPageId, req.user?.tenant_id);
        if (error) return res.status(status).json({ error });

        const { message, link, published, scheduled_publish_time } = req.body;
        if (!message && !link) {
            return res.status(400).json({ error: 'نص المنشور أو الرابط مطلوب' });
        }

        const body = {};
        if (message) body.message = message;
        if (link) body.link = link;
        if (published === false) {
            body.published = false;
            if (scheduled_publish_time) {
                body.scheduled_publish_time = normalizeScheduledPublishTime(scheduled_publish_time);
            }
        }

        billingReservation = reserveBilling({
            tenantId: page.tenant_id,
            operationKey: BILLING_OPERATIONS.FACEBOOK_POST_CREATE,
            quantity: 1,
            referenceType: 'facebook_content',
            metadata: { linked_page_id: linkedPageId, page_id: page.page_id, type: 'post' },
        });

        const response = await graphPostForm(`${page.page_id}/feed`, accessToken, body);
        const metaResult = await readMetaResponse(response);
        const data = metaResult.data || {};

        if (!metaResult.ok) {
            releaseBilling(billingReservation, metaResult.error?.message || 'Meta post create failed');
            return sendMetaFailure(res, metaResult, 'فشل إنشاء المنشور');
        }

        commitBilling(billingReservation, {
            referenceId: data.id || null,
            description: `خصم إنشاء منشور Facebook على ${page.page_name || page.page_id}`,
        });

        logFacebookActivity(page, 'fb_post_created', `إنشاء منشور على صفحة ${page.page_name || page.page_id}`);

        res.status(201).json({ id: data.id });
    } catch (error) {
        if (billingReservation) {
            try {
                releaseBilling(billingReservation, error.message);
            } catch (releaseError) {
                console.error('[FBContent] Create post billing release error:', releaseError);
            }
        }
        if (handleBillingError(res, error)) return;
        if (error.status) return res.status(error.status).json({ error: error.message });
        console.error('[FBContent] Create post error:', error);
        res.status(500).json({ error: 'فشل إنشاء المنشور' });
    }
});

// ============================================
// Create a photo post (URL-based or file upload)
// ============================================
router.post('/:linkedPageId/posts/photo', imageUpload.single('source'), async (req, res) => {
    let filePath = null;
    let billingReservation = null;
    try {
        const { linkedPageId } = req.params;
        const { page, accessToken, error, status } = resolvePageCredentials(linkedPageId, req.user?.tenant_id);
        if (error) {
            if (req.file) cleanupFile(req.file.path);
            return res.status(status).json({ error });
        }

        const isFileUpload = !!req.file;
        const { caption, url } = req.body;

        if (!isFileUpload && !url) {
            return res.status(400).json({ error: 'رابط الصورة أو ملف الصورة مطلوب' });
        }

        billingReservation = reserveBilling({
            tenantId: page.tenant_id,
            operationKey: BILLING_OPERATIONS.FACEBOOK_PHOTO_POST_CREATE,
            quantity: 1,
            referenceType: 'facebook_content',
            metadata: { linked_page_id: linkedPageId, page_id: page.page_id, type: 'photo', source: isFileUpload ? 'file' : 'url' },
        });

        let apiResponse;
        if (isFileUpload) {
            filePath = req.file.path;
            const form = buildNativeFileForm(req.file, caption);

            apiResponse = await fetch(`${META_API_BASE}/${page.page_id}/photos`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                },
                body: form,
            });
        } else {
            apiResponse = await graphPostForm(`${page.page_id}/photos`, accessToken, {
                url,
                caption: caption || undefined,
            });
        }

        const metaResult = await readMetaResponse(apiResponse);
        const data = metaResult.data || {};

        if (!metaResult.ok) {
            releaseBilling(billingReservation, metaResult.error?.message || 'Meta photo post failed');
            return sendMetaFailure(res, metaResult, 'فشل إنشاء منشور الصورة');
        }

        commitBilling(billingReservation, {
            referenceId: data.post_id || data.id || null,
            description: `خصم نشر صورة Facebook على ${page.page_name || page.page_id}`,
        });

        logFacebookActivity(page, 'fb_post_created', `إنشاء منشور صورة على صفحة ${page.page_name || page.page_id}`);

        res.status(201).json({ id: data.id, post_id: data.post_id || null });
    } catch (error) {
        if (billingReservation) {
            try {
                releaseBilling(billingReservation, error.message);
            } catch (releaseError) {
                console.error('[FBContent] Photo post billing release error:', releaseError);
            }
        }
        if (handleBillingError(res, error)) return;
        console.error('[FBContent] Photo post error:', error);
        res.status(500).json({ error: 'فشل إنشاء منشور الصورة' });
    } finally {
        if (filePath) cleanupFile(filePath);
    }
});

// ============================================
// Edit a post (message text only)
// ============================================
router.put('/:linkedPageId/posts/:postId', async (req, res) => {
    let billingReservation = null;
    try {
        const { linkedPageId, postId } = req.params;
        const { page, accessToken, error, status } = resolvePageCredentials(linkedPageId, req.user?.tenant_id);
        if (error) return res.status(status).json({ error });

        const { message } = req.body;
        if (!message) {
            return res.status(400).json({ error: 'نص المنشور مطلوب' });
        }

        billingReservation = reserveBilling({
            tenantId: page.tenant_id,
            operationKey: BILLING_OPERATIONS.FACEBOOK_POST_EDIT,
            quantity: 1,
            referenceType: 'facebook_content',
            metadata: { linked_page_id: linkedPageId, page_id: page.page_id, post_id: postId },
        });

        const response = await fetch(`${META_API_BASE}/${postId}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message }),
        });
        const metaResult = await readMetaResponse(response);

        if (!metaResult.ok) {
            releaseBilling(billingReservation, metaResult.error?.message || 'Meta post edit failed');
            return sendMetaFailure(res, metaResult, 'فشل تعديل المنشور');
        }

        commitBilling(billingReservation, {
            referenceId: postId,
            description: `خصم تعديل منشور Facebook على ${page.page_name || page.page_id}`,
        });

        logFacebookActivity(page, 'fb_post_edited', `تعديل منشور على صفحة ${page.page_name || page.page_id}`);

        res.json({ success: true });
    } catch (error) {
        if (billingReservation) {
            try {
                releaseBilling(billingReservation, error.message);
            } catch (releaseError) {
                console.error('[FBContent] Edit post billing release error:', releaseError);
            }
        }
        if (handleBillingError(res, error)) return;
        console.error('[FBContent] Edit post error:', error);
        res.status(500).json({ error: 'فشل تعديل المنشور' });
    }
});

// ============================================
// Delete a post
// ============================================
router.delete('/:linkedPageId/posts/:postId', async (req, res) => {
    let billingReservation = null;
    try {
        const { linkedPageId, postId } = req.params;
        const { page, accessToken, error, status } = resolvePageCredentials(linkedPageId, req.user?.tenant_id);
        if (error) return res.status(status).json({ error });

        billingReservation = reserveBilling({
            tenantId: page.tenant_id,
            operationKey: BILLING_OPERATIONS.FACEBOOK_POST_DELETE,
            quantity: 1,
            referenceType: 'facebook_content',
            metadata: { linked_page_id: linkedPageId, page_id: page.page_id, post_id: postId },
        });

        const response = await fetch(`${META_API_BASE}/${postId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${accessToken}` },
        });
        const metaResult = await readMetaResponse(response);

        if (!metaResult.ok) {
            releaseBilling(billingReservation, metaResult.error?.message || 'Meta post delete failed');
            return sendMetaFailure(res, metaResult, 'فشل حذف المنشور');
        }

        commitBilling(billingReservation, {
            referenceId: postId,
            description: `خصم حذف منشور Facebook من ${page.page_name || page.page_id}`,
        });

        logFacebookActivity(page, 'fb_post_deleted', `حذف منشور من صفحة ${page.page_name || page.page_id}`);

        res.json({ success: true });
    } catch (error) {
        if (billingReservation) {
            try {
                releaseBilling(billingReservation, error.message);
            } catch (releaseError) {
                console.error('[FBContent] Delete post billing release error:', releaseError);
            }
        }
        if (handleBillingError(res, error)) return;
        console.error('[FBContent] Delete post error:', error);
        res.status(500).json({ error: 'فشل حذف المنشور' });
    }
});

// ============================================
// Like a post
// ============================================
router.post('/:linkedPageId/posts/:postId/like', async (req, res) => {
    let billingReservation = null;
    try {
        const { linkedPageId, postId } = req.params;
        const { page, accessToken, error, status } = resolvePageCredentials(linkedPageId, req.user?.tenant_id);
        if (error) return res.status(status).json({ error });

        billingReservation = reserveBilling({
            tenantId: page.tenant_id,
            operationKey: BILLING_OPERATIONS.FACEBOOK_POST_LIKE,
            quantity: 1,
            referenceType: 'facebook_content',
            metadata: { linked_page_id: linkedPageId, page_id: page.page_id, post_id: postId },
        });

        const response = await graphPostForm(`${postId}/likes`, accessToken);
        const metaResult = await readMetaResponse(response);
        const data = metaResult.data || {};

        if (!metaResult.ok) {
            releaseBilling(billingReservation, metaResult.error?.message || 'Meta post like failed');
            return sendMetaFailure(res, metaResult, 'فشل الإعجاب بالمنشور');
        }

        commitBilling(billingReservation, {
            referenceId: postId,
            description: `خصم إعجاب منشور Facebook في ${page.page_name || page.page_id}`,
        });

        logFacebookActivity(page, 'fb_post_liked', `إعجاب بمنشور في صفحة ${page.page_name || page.page_id}`);
        res.json({ success: true, data });
    } catch (error) {
        if (billingReservation) {
            try {
                releaseBilling(billingReservation, error.message);
            } catch (releaseError) {
                console.error('[FBContent] Like post billing release error:', releaseError);
            }
        }
        if (handleBillingError(res, error)) return;
        console.error('[FBContent] Like post error:', error);
        res.status(500).json({ error: 'فشل الإعجاب بالمنشور' });
    }
});

// ============================================
// Unlike a post
// ============================================
router.delete('/:linkedPageId/posts/:postId/like', async (req, res) => {
    let billingReservation = null;
    try {
        const { linkedPageId, postId } = req.params;
        const { page, accessToken, error, status } = resolvePageCredentials(linkedPageId, req.user?.tenant_id);
        if (error) return res.status(status).json({ error });

        billingReservation = reserveBilling({
            tenantId: page.tenant_id,
            operationKey: BILLING_OPERATIONS.FACEBOOK_POST_UNLIKE,
            quantity: 1,
            referenceType: 'facebook_content',
            metadata: { linked_page_id: linkedPageId, page_id: page.page_id, post_id: postId },
        });

        const response = await fetch(`${META_API_BASE}/${postId}/likes`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${accessToken}` },
        });
        const metaResult = await readMetaResponse(response);
        const data = metaResult.data || {};

        if (!metaResult.ok) {
            releaseBilling(billingReservation, metaResult.error?.message || 'Meta post unlike failed');
            return sendMetaFailure(res, metaResult, 'فشل إزالة الإعجاب من المنشور');
        }

        commitBilling(billingReservation, {
            referenceId: postId,
            description: `خصم إزالة إعجاب منشور Facebook في ${page.page_name || page.page_id}`,
        });

        logFacebookActivity(page, 'fb_post_unliked', `إزالة إعجاب من منشور في صفحة ${page.page_name || page.page_id}`);
        res.json({ success: true, data });
    } catch (error) {
        if (billingReservation) {
            try {
                releaseBilling(billingReservation, error.message);
            } catch (releaseError) {
                console.error('[FBContent] Unlike post billing release error:', releaseError);
            }
        }
        if (handleBillingError(res, error)) return;
        console.error('[FBContent] Unlike post error:', error);
        res.status(500).json({ error: 'فشل إزالة الإعجاب من المنشور' });
    }
});

// ============================================
// Comment on a post
// ============================================
router.post('/:linkedPageId/posts/:postId/comments', async (req, res) => {
    let billingReservation = null;
    try {
        const { linkedPageId, postId } = req.params;
        const { page, accessToken, error, status } = resolvePageCredentials(linkedPageId, req.user?.tenant_id);
        if (error) return res.status(status).json({ error });

        const { message } = req.body;
        if (!message) {
            return res.status(400).json({ error: 'نص التعليق مطلوب' });
        }

        billingReservation = reserveBilling({
            tenantId: page.tenant_id,
            operationKey: BILLING_OPERATIONS.FACEBOOK_POST_COMMENT,
            quantity: 1,
            referenceType: 'facebook_content',
            metadata: { linked_page_id: linkedPageId, page_id: page.page_id, post_id: postId },
        });

        const response = await fetch(`${META_API_BASE}/${postId}/comments`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message }),
        });
        const metaResult = await readMetaResponse(response);
        const data = metaResult.data || {};

        if (!metaResult.ok) {
            releaseBilling(billingReservation, metaResult.error?.message || 'Meta post comment failed');
            return sendMetaFailure(res, metaResult, 'فشل إضافة التعليق');
        }

        commitBilling(billingReservation, {
            referenceId: data.id || null,
            description: `خصم تعليق على منشور Facebook في ${page.page_name || page.page_id}`,
        });

        logFacebookActivity(page, 'fb_post_commented', `تعليق على منشور في صفحة ${page.page_name || page.page_id}`);

        res.status(201).json({ id: data.id, message: data.message });
    } catch (error) {
        if (billingReservation) {
            try {
                releaseBilling(billingReservation, error.message);
            } catch (releaseError) {
                console.error('[FBContent] Comment on post billing release error:', releaseError);
            }
        }
        if (handleBillingError(res, error)) return;
        console.error('[FBContent] Comment on post error:', error);
        res.status(500).json({ error: 'فشل إضافة التعليق' });
    }
});

// ============================================
// List comments on a post
// ============================================
router.get('/:linkedPageId/posts/:postId/comments', async (req, res) => {
    try {
        const { linkedPageId, postId } = req.params;
        const { page, accessToken, error, status } = resolvePageCredentials(linkedPageId, req.user?.tenant_id);
        if (error) return res.status(status).json({ error });

        const { after } = req.query;
        const limit = normalizeLimit(req.query.limit, 25, 100);
        const url = graphUrl(`${postId}/comments`, {
            fields: COMMENT_FIELDS,
            limit,
            after,
            filter: req.query.filter || 'toplevel',
            summary: true,
        });

        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${accessToken}` },
        });
        const metaResult = await readMetaResponse(response);
        const data = metaResult.data || {};

        if (!metaResult.ok) {
            return sendMetaFailure(res, metaResult, 'فشل جلب التعليقات');
        }

        res.json({
            comments: data.data || [],
            paging: data.paging || null,
            summary: data.summary || null,
        });
    } catch (error) {
        console.error('[FBContent] List comments error:', error);
        res.status(500).json({ error: 'فشل جلب التعليقات' });
    }
});

// ============================================
// List replies on a comment
// ============================================
router.get('/:linkedPageId/comments/:commentId/replies', async (req, res) => {
    try {
        const { linkedPageId, commentId } = req.params;
        const { accessToken, error, status } = resolvePageCredentials(linkedPageId, req.user?.tenant_id);
        if (error) return res.status(status).json({ error });

        const { after } = req.query;
        const limit = normalizeLimit(req.query.limit, 10, 50);
        const url = graphUrl(`${commentId}/comments`, {
            fields: COMMENT_FIELDS,
            limit,
            after,
            summary: true,
        });

        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${accessToken}` },
        });
        const metaResult = await readMetaResponse(response);
        const data = metaResult.data || {};

        if (!metaResult.ok) {
            return sendMetaFailure(res, metaResult, 'فشل جلب الردود');
        }

        res.json({
            replies: data.data || [],
            paging: data.paging || null,
            summary: data.summary || null,
        });
    } catch (error) {
        console.error('[FBContent] List replies error:', error);
        res.status(500).json({ error: 'فشل جلب الردود' });
    }
});

// ============================================
// Reply to a comment
// ============================================
router.post('/:linkedPageId/comments/:commentId/reply', async (req, res) => {
    let billingReservation = null;
    try {
        const { linkedPageId, commentId } = req.params;
        const { page, accessToken, error, status } = resolvePageCredentials(linkedPageId, req.user?.tenant_id);
        if (error) return res.status(status).json({ error });

        const { message } = req.body;
        if (!message) {
            return res.status(400).json({ error: 'نص الرد مطلوب' });
        }

        billingReservation = reserveBilling({
            tenantId: page.tenant_id,
            operationKey: BILLING_OPERATIONS.FACEBOOK_COMMENT_REPLY,
            quantity: 1,
            referenceType: 'facebook_content',
            metadata: { linked_page_id: linkedPageId, page_id: page.page_id, comment_id: commentId },
        });

        const response = await fetch(`${META_API_BASE}/${commentId}/comments`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message }),
        });
        const metaResult = await readMetaResponse(response);
        const data = metaResult.data || {};

        if (!metaResult.ok) {
            releaseBilling(billingReservation, metaResult.error?.message || 'Meta comment reply failed');
            return sendMetaFailure(res, metaResult, 'فشل إرسال الرد');
        }

        commitBilling(billingReservation, {
            referenceId: data.id || null,
            description: `خصم رد على تعليق Facebook في ${page.page_name || page.page_id}`,
        });

        logFacebookActivity(page, 'fb_comment_replied', `الرد على تعليق في صفحة ${page.page_name || page.page_id}`);

        res.status(201).json({ id: data.id, message: data.message });
    } catch (error) {
        if (billingReservation) {
            try {
                releaseBilling(billingReservation, error.message);
            } catch (releaseError) {
                console.error('[FBContent] Reply billing release error:', releaseError);
            }
        }
        if (handleBillingError(res, error)) return;
        console.error('[FBContent] Reply error:', error);
        res.status(500).json({ error: 'فشل إرسال الرد' });
    }
});

// ============================================
// Hide/unhide a comment
// ============================================
router.post('/:linkedPageId/comments/:commentId/hide', async (req, res) => {
    let billingReservation = null;
    try {
        const { linkedPageId, commentId } = req.params;
        const { page, accessToken, error, status } = resolvePageCredentials(linkedPageId, req.user?.tenant_id);
        if (error) return res.status(status).json({ error });

        const { is_hidden } = req.body;
        if (is_hidden === undefined) {
            return res.status(400).json({ error: 'is_hidden مطلوب' });
        }

        billingReservation = reserveBilling({
            tenantId: page.tenant_id,
            operationKey: BILLING_OPERATIONS.FACEBOOK_COMMENT_HIDE,
            quantity: 1,
            referenceType: 'facebook_content',
            metadata: { linked_page_id: linkedPageId, page_id: page.page_id, comment_id: commentId, is_hidden: !!is_hidden },
        });

        const response = await fetch(`${META_API_BASE}/${commentId}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ is_hidden: !!is_hidden }),
        });
        const metaResult = await readMetaResponse(response);

        if (!metaResult.ok) {
            releaseBilling(billingReservation, metaResult.error?.message || 'Meta comment hide failed');
            return sendMetaFailure(res, metaResult, 'فشل تحديث حالة التعليق');
        }

        commitBilling(billingReservation, {
            referenceId: commentId,
            description: `خصم ${is_hidden ? 'إخفاء' : 'إظهار'} تعليق Facebook في ${page.page_name || page.page_id}`,
        });

        logFacebookActivity(page, 'fb_comment_hidden', `${is_hidden ? 'إخفاء' : 'إظهار'} تعليق في صفحة ${page.page_name || page.page_id}`);

        res.json({ success: true, is_hidden: !!is_hidden });
    } catch (error) {
        if (billingReservation) {
            try {
                releaseBilling(billingReservation, error.message);
            } catch (releaseError) {
                console.error('[FBContent] Hide comment billing release error:', releaseError);
            }
        }
        if (handleBillingError(res, error)) return;
        console.error('[FBContent] Hide comment error:', error);
        res.status(500).json({ error: 'فشل تحديث حالة التعليق' });
    }
});

// ============================================
// Like/unlike a comment
// ============================================
router.post('/:linkedPageId/comments/:commentId/like', async (req, res) => {
    let billingReservation = null;
    try {
        const { linkedPageId, commentId } = req.params;
        const { page, accessToken, error, status } = resolvePageCredentials(linkedPageId, req.user?.tenant_id);
        if (error) return res.status(status).json({ error });

        billingReservation = reserveBilling({
            tenantId: page.tenant_id,
            operationKey: BILLING_OPERATIONS.FACEBOOK_COMMENT_LIKE,
            quantity: 1,
            referenceType: 'facebook_content',
            metadata: { linked_page_id: linkedPageId, page_id: page.page_id, comment_id: commentId },
        });

        const response = await graphPostForm(`${commentId}/likes`, accessToken);
        const metaResult = await readMetaResponse(response);
        const data = metaResult.data || {};

        if (!metaResult.ok) {
            releaseBilling(billingReservation, metaResult.error?.message || 'Meta comment like failed');
            return sendMetaFailure(res, metaResult, 'فشل الإعجاب بالتعليق');
        }

        commitBilling(billingReservation, {
            referenceId: commentId,
            description: `خصم إعجاب تعليق Facebook في ${page.page_name || page.page_id}`,
        });

        logFacebookActivity(page, 'fb_comment_liked', `إعجاب بتعليق في صفحة ${page.page_name || page.page_id}`);
        res.json({ success: true, data });
    } catch (error) {
        if (billingReservation) {
            try {
                releaseBilling(billingReservation, error.message);
            } catch (releaseError) {
                console.error('[FBContent] Like comment billing release error:', releaseError);
            }
        }
        if (handleBillingError(res, error)) return;
        console.error('[FBContent] Like comment error:', error);
        res.status(500).json({ error: 'فشل الإعجاب بالتعليق' });
    }
});

router.delete('/:linkedPageId/comments/:commentId/like', async (req, res) => {
    let billingReservation = null;
    try {
        const { linkedPageId, commentId } = req.params;
        const { page, accessToken, error, status } = resolvePageCredentials(linkedPageId, req.user?.tenant_id);
        if (error) return res.status(status).json({ error });

        billingReservation = reserveBilling({
            tenantId: page.tenant_id,
            operationKey: BILLING_OPERATIONS.FACEBOOK_COMMENT_UNLIKE,
            quantity: 1,
            referenceType: 'facebook_content',
            metadata: { linked_page_id: linkedPageId, page_id: page.page_id, comment_id: commentId },
        });

        const response = await fetch(`${META_API_BASE}/${commentId}/likes`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${accessToken}` },
        });
        const metaResult = await readMetaResponse(response);
        const data = metaResult.data || {};

        if (!metaResult.ok) {
            releaseBilling(billingReservation, metaResult.error?.message || 'Meta comment unlike failed');
            return sendMetaFailure(res, metaResult, 'فشل إزالة الإعجاب');
        }

        commitBilling(billingReservation, {
            referenceId: commentId,
            description: `خصم إزالة إعجاب تعليق Facebook في ${page.page_name || page.page_id}`,
        });

        logFacebookActivity(page, 'fb_comment_unliked', `إزالة إعجاب من تعليق في صفحة ${page.page_name || page.page_id}`);
        res.json({ success: true, data });
    } catch (error) {
        if (billingReservation) {
            try {
                releaseBilling(billingReservation, error.message);
            } catch (releaseError) {
                console.error('[FBContent] Unlike comment billing release error:', releaseError);
            }
        }
        if (handleBillingError(res, error)) return;
        console.error('[FBContent] Unlike comment error:', error);
        res.status(500).json({ error: 'فشل إزالة الإعجاب' });
    }
});

// ============================================
// Delete a comment
// ============================================
router.delete('/:linkedPageId/comments/:commentId', async (req, res) => {
    let billingReservation = null;
    try {
        const { linkedPageId, commentId } = req.params;
        const { page, accessToken, error, status } = resolvePageCredentials(linkedPageId, req.user?.tenant_id);
        if (error) return res.status(status).json({ error });

        billingReservation = reserveBilling({
            tenantId: page.tenant_id,
            operationKey: BILLING_OPERATIONS.FACEBOOK_COMMENT_DELETE,
            quantity: 1,
            referenceType: 'facebook_content',
            metadata: { linked_page_id: linkedPageId, page_id: page.page_id, comment_id: commentId },
        });

        const response = await fetch(`${META_API_BASE}/${commentId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${accessToken}` },
        });
        const metaResult = await readMetaResponse(response);

        if (!metaResult.ok) {
            releaseBilling(billingReservation, metaResult.error?.message || 'Meta comment delete failed');
            return sendMetaFailure(res, metaResult, 'فشل حذف التعليق');
        }

        commitBilling(billingReservation, {
            referenceId: commentId,
            description: `خصم حذف تعليق Facebook من ${page.page_name || page.page_id}`,
        });

        logFacebookActivity(page, 'fb_comment_deleted', `حذف تعليق من صفحة ${page.page_name || page.page_id}`);

        res.json({ success: true });
    } catch (error) {
        if (billingReservation) {
            try {
                releaseBilling(billingReservation, error.message);
            } catch (releaseError) {
                console.error('[FBContent] Delete comment billing release error:', releaseError);
            }
        }
        if (handleBillingError(res, error)) return;
        console.error('[FBContent] Delete comment error:', error);
        res.status(500).json({ error: 'فشل حذف التعليق' });
    }
});

export default router;
