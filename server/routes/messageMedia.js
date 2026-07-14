import express from 'express';
import FormData from 'form-data';
import fs from 'node:fs';

import { META_API_BASE } from '../config/index.js';
import { cleanupFile, mediaUpload } from '../config/upload.js';
import db from '../db/database.js';
import { mediaMessageTypeForMime } from '../security/fileContent.js';
import {
    BILLING_OPERATIONS,
    commit as commitBilling,
    handleBillingError,
    release as releaseBilling,
    reserve as reserveBilling,
} from '../services/billing.js';
import { resolveCredentials } from '../services/credentials.js';
import { normalizeFilename } from '../services/filenames.js';
import { getWhatsAppConversationWindow } from '../services/whatsappConversationWindow.js';
import { MediaTooLargeError, pipeFetchResponse } from '../services/mediaStreaming.js';
import { readMetaResponse, sendMetaFailure } from '../services/metaHttp.js';
import {
    InvalidWhatsAppMessageError,
    isAllowedMetaMediaUrl,
    normalizeWhatsAppMediaCaption,
    normalizeWhatsAppMediaFilename,
    normalizeWhatsAppMediaId,
    normalizeWhatsAppMediaType,
    normalizeWhatsAppMediaUrl,
    normalizeWhatsAppRecipient,
    parseAdminTenantId,
} from '../services/whatsappMessageValidation.js';

const defaultMediaUpload = mediaUpload.single('file');
const defaultBilling = {
    operations: BILLING_OPERATIONS,
    reserve: reserveBilling,
    commit: commitBilling,
    release: releaseBilling,
    handleError: handleBillingError,
};

const validationFailure = (res, error) => res.status(400).json({
    error: error.message,
    ...(error.details || {}),
});

export function createMessageMediaRouter({
    database = db,
    credentialResolver = resolveCredentials,
    fetchImpl = globalThis.fetch,
    parseMetaResponse = readMetaResponse,
    streamMedia = pipeFetchResponse,
    uploadMiddleware = defaultMediaUpload,
    formDataFactory = () => new FormData(),
    readFile = fs.readFileSync,
    cleanup = cleanupFile,
    billing = defaultBilling,
    logger = console,
    now = () => Date.now(),
    apiBase = META_API_BASE,
} = {}) {
    const router = express.Router();

    const resolveContext = async (source = {}, {
        requirePhoneNumber = true,
        requireTenant = false,
        allowOverrides = false,
    } = {}) => {
        const requestedTenantId = parseAdminTenantId(source.tenant_id);
        if (requireTenant && !requestedTenantId) {
            return { error: 'tenant_id is required', status: 400 };
        }
        const credentials = await credentialResolver({
            tenantId: requestedTenantId,
            phoneNumberIdOverride: allowOverrides ? source.phone_number_id : undefined,
            accessTokenOverride: allowOverrides ? source.access_token : undefined,
        });
        if (requestedTenantId && !credentials?.tenant) {
            return { error: 'Tenant not found', status: 404 };
        }
        if (credentials?.isSuspended) {
            return { error: 'Tenant account is suspended', status: 403 };
        }
        if (!credentials?.accessToken || (requirePhoneNumber && !credentials?.phoneNumberId)) {
            return { error: 'Missing API credentials', status: 400 };
        }
        return {
            tenantId: credentials.tenant?.id || requestedTenantId || null,
            tenant: credentials.tenant || null,
            phoneNumberId: credentials.phoneNumberId == null
                ? null
                : String(credentials.phoneNumberId),
            accessToken: String(credentials.accessToken),
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

    const uploadToMeta = async (context, file) => {
        const displayFilename = normalizeFilename(file.originalname, 'upload');
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
        mediaId = null,
        mediaUrl = null,
        mimeType = null,
        source,
    }) => {
        const warnings = [];
        try {
            database.prepare(`
                INSERT INTO messages (
                    tenant_id, direction, sender, recipient, message_type, content,
                    status, wamid, error_message, media_id, media_url, media_mime_type
                ) VALUES (?, 'outgoing', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                mediaUrl,
                mimeType,
            );
        } catch (error) {
            warnings.push('local_message_store_failed');
            logger.error('[MessageMedia] Local message store failed:', error);
        }
        if (context.tenant) {
            try {
                database.prepare(`
                    INSERT INTO activity_logs (
                        tenant_id, tenant_name, event_type, description, status
                    ) VALUES (?, ?, 'media_sent', ?, ?)
                `).run(
                    context.tenantId,
                    context.tenant.name,
                    `إرسال وسائط WhatsApp (${mediaType}/${source})`,
                    metaResult.ok ? 'success' : 'error',
                );
            } catch (error) {
                warnings.push('activity_log_store_failed');
                logger.error('[MessageMedia] Activity log store failed:', error);
            }
        }
        return warnings;
    };

    const settleSend = ({
        res,
        context,
        reservation,
        metaResult,
        messageId,
        mediaType,
        warnings,
        failureMessage,
        successExtra = {},
    }) => {
        if (metaResult.ok) {
            if (context.tenantId) {
                billing.commit(reservation, {
                    referenceId: messageId,
                    description: `خصم إرسال وسائط WhatsApp: ${mediaType}`,
                });
            }
            res.json({
                success: true,
                message_id: messageId,
                data: metaResult.data || {},
                ...successExtra,
                ...(warnings.length > 0 ? { warnings } : {}),
            });
            return true;
        }
        billing.release(reservation, metaResult.error?.message || failureMessage);
        sendMetaFailure(
            res,
            metaResult,
            failureMessage,
            warnings.length > 0 ? { warnings } : {},
        );
        return true;
    };

    router.get('/media/:mediaId', async (req, res) => {
        try {
            const mediaId = normalizeWhatsAppMediaId(req.params.mediaId);
            const context = await resolveContext(req.query, { requirePhoneNumber: false });
            if (context.error) return res.status(context.status).json({ error: context.error });
            const response = await fetchImpl(`${apiBase}/${encodeURIComponent(mediaId)}`, {
                headers: { Authorization: `Bearer ${context.accessToken}` },
            });
            const metaResult = await parseMetaResponse(response);
            if (!metaResult.ok) {
                return sendMetaFailure(res, metaResult, 'Failed to get media URL');
            }
            const data = metaResult.data || {};
            if (!data.url || !isAllowedMetaMediaUrl(data.url)) {
                return res.status(502).json({
                    error: 'Meta API response did not include a trusted media URL',
                });
            }
            return res.json({ url: data.url, mime_type: data.mime_type });
        } catch (error) {
            if (error instanceof InvalidWhatsAppMessageError) return validationFailure(res, error);
            logger.error('[MessageMedia] Media fetch error:', error);
            return res.status(500).json({ error: 'Failed to fetch media' });
        }
    });

    router.get('/media/:mediaId/download', async (req, res) => {
        try {
            const mediaId = normalizeWhatsAppMediaId(req.params.mediaId);
            const context = await resolveContext(req.query, { requirePhoneNumber: false });
            if (context.error) return res.status(context.status).json({ error: context.error });
            const urlResponse = await fetchImpl(`${apiBase}/${encodeURIComponent(mediaId)}`, {
                headers: { Authorization: `Bearer ${context.accessToken}` },
            });
            const urlResult = await parseMetaResponse(urlResponse);
            if (!urlResult.ok) {
                return sendMetaFailure(res, urlResult, 'Failed to get media URL');
            }
            const urlData = urlResult.data || {};
            if (!urlData.url || !isAllowedMetaMediaUrl(urlData.url)) {
                return res.status(502).json({
                    error: 'Meta API response did not include a trusted media URL',
                });
            }
            const mediaResponse = await fetchImpl(urlData.url, {
                headers: { Authorization: `Bearer ${context.accessToken}` },
            });
            if (!mediaResponse.ok) {
                return res.status(mediaResponse.status).json({ error: 'Failed to download media' });
            }
            await streamMedia(mediaResponse, res, {
                contentType: urlData.mime_type || 'application/octet-stream',
            });
            return undefined;
        } catch (error) {
            logger.error('[MessageMedia] Media download error:', error);
            if (res.headersSent) return res.destroy(error);
            if (error instanceof InvalidWhatsAppMessageError) return validationFailure(res, error);
            if (error instanceof MediaTooLargeError) {
                return res.status(413).json({ error: 'Media file exceeds the download limit' });
            }
            return res.status(500).json({ error: 'Failed to download media' });
        }
    });

    router.post('/media/upload-to-meta', uploadMiddleware, async (req, res) => {
        try {
            const file = req.file;
            if (!file) return res.status(400).json({ error: 'file is required' });
            const context = await resolveContext(req.body, { requireTenant: true });
            if (context.error) return res.status(context.status).json({ error: context.error });
            const { displayFilename, result } = await uploadToMeta(context, file);
            if (!result.ok) {
                return sendMetaFailure(res, result, 'Failed to upload media to Meta');
            }
            const mediaId = result.data?.id;
            if (!mediaId) {
                return res.status(502).json({
                    error: 'Meta API response did not include a media id',
                });
            }
            return res.json({
                id: mediaId,
                filename: displayFilename,
                mime_type: file.mimetype,
            });
        } catch (error) {
            if (error instanceof InvalidWhatsAppMessageError) return validationFailure(res, error);
            logger.error('[MessageMedia] Media upload error:', error);
            return res.status(500).json({ error: 'Failed to upload media to Meta' });
        } finally {
            cleanup(req.file?.path);
        }
    });

    router.post('/send-media', async (req, res) => {
        let reservation = null;
        let billingSettled = false;
        try {
            const body = req.body || {};
            const recipient = normalizeWhatsAppRecipient(body.recipient);
            const mediaType = normalizeWhatsAppMediaType(body.type);
            const mediaUrl = normalizeWhatsAppMediaUrl(body.mediaUrl);
            const caption = normalizeWhatsAppMediaCaption(body.caption, mediaType);
            const rawFilename = normalizeWhatsAppMediaFilename(body.filename, mediaType);
            const displayFilename = mediaType === 'document'
                ? normalizeFilename(rawFilename, 'مستند')
                : null;
            const context = await resolveContext(body, { allowOverrides: true });
            if (context.error) return res.status(context.status).json({ error: context.error });
            if (rejectClosedWindow(res, context, recipient)) return undefined;

            const payload = {
                messaging_product: 'whatsapp',
                to: recipient,
                type: mediaType,
                [mediaType]: { link: mediaUrl },
            };
            if (caption) payload[mediaType].caption = caption;
            if (mediaType === 'document' && rawFilename) {
                payload.document.filename = displayFilename;
            }

            reservation = billing.reserve({
                tenantId: context.tenantId,
                operationKey: billing.operations.WHATSAPP_MEDIA,
                quantity: 1,
                referenceType: 'message',
                metadata: { recipient, message_type: mediaType, media_source: 'url' },
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
                mediaUrl,
                source: 'url',
            });
            billingSettled = true;
            settleSend({
                res,
                context,
                reservation,
                metaResult,
                messageId,
                mediaType,
                warnings,
                failureMessage: 'Failed to send media',
            });
            return undefined;
        } catch (error) {
            if (reservation && !billingSettled) {
                try {
                    billing.release(reservation, error.message);
                } catch (releaseError) {
                    logger.error('[MessageMedia] Media billing release error:', releaseError);
                }
            }
            if (error instanceof InvalidWhatsAppMessageError) return validationFailure(res, error);
            if (billing.handleError(res, error)) return undefined;
            logger.error('[MessageMedia] Send media error:', error);
            return res.status(500).json({ error: 'Failed to send media message' });
        }
    });

    router.post('/send-media-file', uploadMiddleware, async (req, res) => {
        let reservation = null;
        let billingSettled = false;
        try {
            const body = req.body || {};
            const file = req.file;
            if (!file) return res.status(400).json({ error: 'file is required' });
            const recipient = normalizeWhatsAppRecipient(body.recipient);
            const detectedMediaType = mediaMessageTypeForMime(file.mimetype);
            const requestedMediaType = body.type == null || body.type === ''
                ? detectedMediaType
                : normalizeWhatsAppMediaType(body.type);
            if (!detectedMediaType || requestedMediaType !== detectedMediaType) {
                throw new InvalidWhatsAppMessageError(
                    'Media message type does not match the uploaded file',
                    { code: 'MEDIA_TYPE_MISMATCH' },
                );
            }
            const mediaType = detectedMediaType;
            const caption = normalizeWhatsAppMediaCaption(body.caption, mediaType);
            const rawFilename = normalizeWhatsAppMediaFilename(body.filename, mediaType);
            const context = await resolveContext(body, { allowOverrides: true });
            if (context.error) return res.status(context.status).json({ error: context.error });
            if (rejectClosedWindow(res, context, recipient)) return undefined;

            const upload = await uploadToMeta(context, file);
            const uploadResult = upload.result;
            if (!uploadResult.ok) {
                return sendMetaFailure(res, uploadResult, 'Failed to upload media to Meta');
            }
            const mediaId = uploadResult.data?.id;
            if (!mediaId) {
                return res.status(502).json({
                    error: 'Meta API response did not include a media id',
                });
            }
            const displayFilename = mediaType === 'document'
                ? normalizeFilename(rawFilename || upload.displayFilename, 'مستند')
                : upload.displayFilename;
            const payload = {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
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
                source: 'file',
            });
            billingSettled = true;
            settleSend({
                res,
                context,
                reservation,
                metaResult,
                messageId,
                mediaType,
                warnings,
                failureMessage: 'Failed to send media file',
                successExtra: { media_id: mediaId },
            });
            return undefined;
        } catch (error) {
            if (reservation && !billingSettled) {
                try {
                    billing.release(reservation, error.message);
                } catch (releaseError) {
                    logger.error('[MessageMedia] Media file billing release error:', releaseError);
                }
            }
            if (error instanceof InvalidWhatsAppMessageError) return validationFailure(res, error);
            if (billing.handleError(res, error)) return undefined;
            logger.error('[MessageMedia] Send media file error:', error);
            return res.status(500).json({ error: 'Failed to process media file' });
        } finally {
            cleanup(req.file?.path);
        }
    });

    return router;
}

export default createMessageMediaRouter();
