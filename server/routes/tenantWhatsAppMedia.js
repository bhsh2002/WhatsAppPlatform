import express from 'express';
import FormData from 'form-data';
import fs from 'node:fs';

import { META_API_BASE } from '../config/index.js';
import { cleanupFile, documentUpload, mediaUpload } from '../config/upload.js';
import { mediaMessageTypeForMime } from '../security/fileContent.js';
import { normalizeFilename } from '../services/filenames.js';
import { MediaTooLargeError, pipeFetchResponse } from '../services/mediaStreaming.js';
import { readMetaResponse, sendMetaFailure } from '../services/metaHttp.js';
import { getWhatsAppConversationWindow } from '../services/whatsappConversationWindow.js';
import {
    InvalidWhatsAppMessageError,
    isAllowedMetaMediaUrl,
    normalizeWhatsAppMediaCaption,
    normalizeWhatsAppMediaFilename,
    normalizeWhatsAppMediaId,
    normalizeWhatsAppRecipient,
} from '../services/whatsappMessageValidation.js';

const defaultDocumentUpload = documentUpload.single('file');
const defaultMediaUpload = mediaUpload.single('file');
const defaultCleanup = file => cleanupFile(file?.path);

const validationFailure = (res, error) => res.status(400).json({
    error: error.message,
    ...(error.details || {}),
});

export function createTenantWhatsAppMediaRouter({
    database,
    accessTokenForTenant,
    billing,
    emitNewMessage = () => undefined,
    emitConversationUpdate = () => undefined,
    fetchImpl = globalThis.fetch,
    parseMetaResponse = readMetaResponse,
    streamMedia = pipeFetchResponse,
    documentUploadMiddleware = defaultDocumentUpload,
    mediaUploadMiddleware = defaultMediaUpload,
    formDataFactory = () => new FormData(),
    readFile = fs.readFileSync,
    cleanup = defaultCleanup,
    logger = console,
    now = () => Date.now(),
    apiBase = META_API_BASE,
} = {}) {
    if (
        !database
        || typeof accessTokenForTenant !== 'function'
        || !billing
        || typeof fetchImpl !== 'function'
    ) {
        throw new TypeError('Tenant WhatsApp media router requires database, credentials, billing and fetch');
    }
    const router = express.Router();

    const resolveTenantContext = (req, { requirePhoneNumber = true } = {}) => {
        const tenantId = Number(req.user?.tenant_id);
        if (!Number.isSafeInteger(tenantId) || tenantId <= 0) {
            return { error: 'جلسة المستأجر غير صالحة', status: 401 };
        }
        const tenant = database.prepare(`
            SELECT id, name, phone_number_id, status
            FROM tenants
            WHERE id = ?
        `).get(tenantId);
        if (!tenant) return { error: 'العميل غير موجود', status: 404 };
        if (tenant.status === 'Suspended') {
            return { error: 'حسابك معلّق ولا يمكنك استخدام وسائط WhatsApp', status: 403 };
        }
        const accessToken = accessTokenForTenant(tenantId);
        if (!accessToken || (requirePhoneNumber && !tenant.phone_number_id)) {
            return { error: 'إعدادات WhatsApp API غير مكتملة', status: 400 };
        }
        return {
            tenantId,
            tenant,
            phoneNumberId: tenant.phone_number_id == null
                ? null
                : String(tenant.phone_number_id),
            accessToken: String(accessToken),
        };
    };

    const rejectClosedWindow = (res, context, recipient) => {
        const window = getWhatsAppConversationWindow(
            database,
            context.tenantId,
            recipient,
            now(),
        );
        if (window.isOpen) return false;
        res.status(400).json({
            error: 'نافذة المحادثة (24 ساعة) مغلقة. يمكنك فقط إرسال قوالب معتمدة.',
            code: 'OUTSIDE_WINDOW',
            window_closed_at: window.closesAt,
        });
        return true;
    };

    const uploadToMeta = async (context, file, requestedFilename = null) => {
        const displayFilename = normalizeFilename(requestedFilename || file.originalname, 'upload');
        const form = formDataFactory();
        form.append('messaging_product', 'whatsapp');
        form.append('type', file.mimetype);
        form.append('file', readFile(file.path), {
            filename: displayFilename,
            contentType: file.mimetype,
        });
        const response = await fetchImpl(
            `${apiBase}/${encodeURIComponent(context.phoneNumberId)}/media`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${context.accessToken}`,
                    ...form.getHeaders(),
                },
                body: form.getBuffer(),
            },
        );
        return {
            displayFilename,
            result: await parseMetaResponse(response),
        };
    };

    const persistOutcome = ({
        context,
        recipient,
        mediaType,
        content,
        metaResult,
        messageId,
        mediaId,
        mimeType,
        activityType,
    }) => {
        const warnings = [];
        try {
            database.prepare(`
                INSERT INTO messages (
                    tenant_id, direction, sender, recipient, message_type, content,
                    status, wamid, error_message, media_id, media_mime_type
                ) VALUES (?, 'outgoing', ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                context.tenantId,
                context.phoneNumberId,
                recipient,
                mediaType,
                content,
                metaResult.ok ? 'sent' : 'failed',
                messageId,
                metaResult.error?.message || null,
                mediaId,
                mimeType,
            );
        } catch (error) {
            warnings.push('local_message_store_failed');
            logger.error('[TenantWhatsAppMedia] Local message store failed:', error);
        }
        try {
            database.prepare(`
                INSERT INTO activity_logs (
                    tenant_id, tenant_name, event_type, description, status
                ) VALUES (?, ?, ?, ?, ?)
            `).run(
                context.tenantId,
                context.tenant.name,
                activityType,
                mediaType === 'document' ? 'إرسال مستند' : `إرسال وسائط WhatsApp (${mediaType})`,
                metaResult.ok ? 'success' : 'error',
            );
        } catch (error) {
            warnings.push('activity_log_store_failed');
            logger.error('[TenantWhatsAppMedia] Activity log store failed:', error);
        }
        return warnings;
    };

    const emitSuccess = ({ context, recipient, mediaType, content, messageId, warnings }) => {
        try {
            emitNewMessage({
                tenant_id: context.tenantId,
                direction: 'outgoing',
                sender: context.phoneNumberId,
                recipient,
                message_type: mediaType,
                content,
                wamid: messageId,
                created_at: new Date(now()).toISOString(),
            });
            emitConversationUpdate(context.tenantId);
        } catch (error) {
            warnings.push('realtime_event_failed');
            logger.error('[TenantWhatsAppMedia] Realtime event failed:', error);
        }
    };

    const sendUploadedMedia = ({ forceDocument = false } = {}) => async (req, res) => {
        let reservation = null;
        let billingSettled = false;
        try {
            const file = req.file;
            if (!file) return res.status(400).json({ error: 'الملف مطلوب' });
            const recipient = normalizeWhatsAppRecipient(req.body?.recipient);
            const detectedMediaType = mediaMessageTypeForMime(file.mimetype);
            if (!detectedMediaType || (forceDocument && detectedMediaType !== 'document')) {
                throw new InvalidWhatsAppMessageError(
                    'نوع الملف لا يطابق مسار وسائط WhatsApp',
                    { code: 'MEDIA_TYPE_MISMATCH' },
                );
            }
            const mediaType = forceDocument ? 'document' : detectedMediaType;
            const caption = normalizeWhatsAppMediaCaption(req.body?.caption, mediaType);
            const requestedFilename = normalizeWhatsAppMediaFilename(
                req.body?.filename,
                mediaType,
            );
            const context = resolveTenantContext(req);
            if (context.error) return res.status(context.status).json({ error: context.error });
            if (rejectClosedWindow(res, context, recipient)) return undefined;

            const upload = await uploadToMeta(context, file, requestedFilename);
            const uploadResult = upload.result;
            if (!uploadResult.ok) {
                return sendMetaFailure(res, uploadResult, 'فشل رفع الملف إلى WhatsApp');
            }
            const mediaId = uploadResult.data?.id;
            if (!mediaId) {
                return res.status(502).json({
                    error: 'استجابة Meta لا تحتوي على معرّف الوسائط',
                });
            }
            const displayFilename = mediaType === 'document'
                ? normalizeFilename(requestedFilename || upload.displayFilename, 'مستند')
                : upload.displayFilename;
            const payload = {
                messaging_product: 'whatsapp',
                to: recipient,
                type: mediaType,
                [mediaType]: { id: mediaId },
            };
            if (caption) payload[mediaType].caption = caption;
            if (mediaType === 'document') payload.document.filename = displayFilename;

            reservation = billing.reserve({
                tenantId: context.tenantId,
                operationKey: billing.operations.WHATSAPP_MEDIA,
                quantity: 1,
                referenceType: 'message',
                metadata: { recipient, message_type: mediaType, media_source: 'file' },
            });
            const response = await fetchImpl(
                `${apiBase}/${encodeURIComponent(context.phoneNumberId)}/messages`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${context.accessToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(payload),
                },
            );
            const metaResult = await parseMetaResponse(response);
            const messageId = metaResult.data?.messages?.[0]?.id || null;
            const content = mediaType === 'document'
                ? (caption ? `${displayFilename}\n\n${caption}` : displayFilename)
                : (caption || `[${mediaType}]`);
            const warnings = persistOutcome({
                context,
                recipient,
                mediaType,
                content,
                metaResult,
                messageId,
                mediaId,
                mimeType: file.mimetype,
                activityType: forceDocument ? 'document_sent' : 'media_sent',
            });

            billingSettled = true;
            if (metaResult.ok) {
                billing.commit(reservation, {
                    referenceId: messageId,
                    description: mediaType === 'document'
                        ? 'خصم إرسال مستند WhatsApp'
                        : `خصم إرسال وسائط WhatsApp: ${mediaType}`,
                });
                emitSuccess({ context, recipient, mediaType, content, messageId, warnings });
                return res.json({
                    success: true,
                    message_id: messageId,
                    media_id: mediaId,
                    ...(warnings.length > 0 ? { warnings } : {}),
                });
            }
            billing.release(reservation, metaResult.error?.message || 'Meta media send failed');
            return sendMetaFailure(
                res,
                metaResult,
                'فشل إرسال الملف',
                warnings.length > 0 ? { warnings } : {},
            );
        } catch (error) {
            if (reservation && !billingSettled) {
                try {
                    billing.release(reservation, error.message);
                } catch (releaseError) {
                    logger.error('[TenantWhatsAppMedia] Billing release error:', releaseError);
                }
            }
            if (error instanceof InvalidWhatsAppMessageError) return validationFailure(res, error);
            if (billing.handleError(res, error)) return undefined;
            logger.error('[TenantWhatsAppMedia] Send error:', error);
            return res.status(500).json({ error: 'فشل إرسال الملف' });
        } finally {
            cleanup(req.file);
        }
    };

    router.post('/media/upload-to-meta', mediaUploadMiddleware, async (req, res) => {
        try {
            const file = req.file;
            if (!file) return res.status(400).json({ error: 'الملف مطلوب' });
            const context = resolveTenantContext(req);
            if (context.error) return res.status(context.status).json({ error: context.error });
            const upload = await uploadToMeta(context, file);
            if (!upload.result.ok) {
                return sendMetaFailure(res, upload.result, 'فشل رفع الملف إلى WhatsApp');
            }
            const mediaId = upload.result.data?.id;
            if (!mediaId) {
                return res.status(502).json({
                    error: 'استجابة Meta لا تحتوي على معرّف الوسائط',
                });
            }
            return res.json({
                id: mediaId,
                filename: upload.displayFilename,
                mime_type: file.mimetype,
            });
        } catch (error) {
            logger.error('[TenantWhatsAppMedia] Upload error:', error);
            return res.status(500).json({ error: 'حدث خطأ أثناء رفع الملف' });
        } finally {
            cleanup(req.file);
        }
    });

    router.post(
        '/messages/send-document',
        documentUploadMiddleware,
        sendUploadedMedia({ forceDocument: true }),
    );
    router.post('/messages/send-image', mediaUploadMiddleware, sendUploadedMedia());

    router.get('/media/:mediaId/download', async (req, res) => {
        try {
            const mediaId = normalizeWhatsAppMediaId(req.params.mediaId);
            const context = resolveTenantContext(req, { requirePhoneNumber: false });
            if (context.error) return res.status(context.status).json({ error: context.error });
            const urlResponse = await fetchImpl(`${apiBase}/${encodeURIComponent(mediaId)}`, {
                headers: { Authorization: `Bearer ${context.accessToken}` },
            });
            const urlResult = await parseMetaResponse(urlResponse);
            if (!urlResult.ok) {
                return sendMetaFailure(res, urlResult, 'فشل جلب رابط الوسائط');
            }
            const urlData = urlResult.data || {};
            if (!urlData.url || !isAllowedMetaMediaUrl(urlData.url)) {
                return res.status(502).json({
                    error: 'استجابة Meta لا تحتوي على رابط وسائط موثوق',
                });
            }
            const mediaResponse = await fetchImpl(urlData.url, {
                headers: { Authorization: `Bearer ${context.accessToken}` },
            });
            if (!mediaResponse.ok) {
                return res.status(mediaResponse.status).json({ error: 'فشل تحميل الوسائط' });
            }
            await streamMedia(mediaResponse, res, {
                contentType: urlData.mime_type || 'application/octet-stream',
            });
            return undefined;
        } catch (error) {
            logger.error('[TenantWhatsAppMedia] Download error:', error);
            if (res.headersSent) return res.destroy(error);
            if (error instanceof InvalidWhatsAppMessageError) return validationFailure(res, error);
            if (error instanceof MediaTooLargeError) {
                return res.status(413).json({ error: 'حجم ملف الوسائط يتجاوز الحد المسموح' });
            }
            return res.status(500).json({ error: 'فشل تحميل الوسائط' });
        }
    });

    return router;
}

export default createTenantWhatsAppMediaRouter;
