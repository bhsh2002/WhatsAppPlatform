import express from 'express';
import FormData from 'form-data';
import fs from 'node:fs';

import { META_API_BASE } from '../../config/index.js';
import { cleanupFile, documentUpload } from '../../config/upload.js';
import db from '../../db/database.js';
import { mediaMessageTypeForMime } from '../../security/fileContent.js';
import {
    BILLING_OPERATIONS,
    commit as commitBilling,
    handleBillingError,
    release as releaseBilling,
    reserve as reserveBilling,
} from '../../services/billing.js';
import { getTenantCredentials } from '../../services/credentials.js';
import { normalizeFilename } from '../../services/filenames.js';
import { readMetaResponse, sendMetaFailure, summarizeMetaException } from '../../services/metaHttp.js';
import {
    buildInteractivePayload,
    buildRichTemplateContent,
    normalizeTemplateComponents,
    parseTemplateShortcut,
} from '../../services/messaging.js';
import { getWhatsAppConversationWindow } from '../../services/whatsappConversationWindow.js';
import {
    countTemplateBodyVariables,
    InvalidWhatsAppMessageError,
    normalizeInteractiveInput,
    normalizeMessageText,
    normalizeMessageType,
    normalizeTemplateLanguage,
    normalizeTemplateName,
    normalizeWhatsAppMediaCaption,
    normalizeWhatsAppMediaFilename,
    normalizeWhatsAppMediaType,
    normalizeWhatsAppMediaUrl,
    normalizeWhatsAppRecipient,
} from '../../services/whatsappMessageValidation.js';
import { selectedWhatsAppPhoneNumberId } from '../../services/whatsappNumbers.js';
import { createNativeWhatsAppMessageCommand, NativeWhatsAppMessageError } from '../../services/nativeWhatsAppMessage.js';

const MAX_TEMPLATE_COMPONENT_BYTES = 64 * 1024;
const defaultDocumentUpload = documentUpload.single('file');
const defaultCleanup = file => cleanupFile(file?.path);

const defaultBilling = {
    operations: BILLING_OPERATIONS,
    reserve: reserveBilling,
    commit: commitBilling,
    release: releaseBilling,
    handleError: handleBillingError,
};

const defaultCredentialResolver = (tenantId, phoneNumberId) => {
    const credentials = getTenantCredentials(tenantId, phoneNumberId);
    return {
        ...credentials,
        suspended: credentials.tenant?.status === 'Suspended',
    };
};

const validationFailure = (res, error) => res.status(400).json({
    error: error.message,
    ...(error.details || {}),
});

const normalizeTemplateParameters = raw => {
    if (raw != null && !Array.isArray(raw)) {
        throw new InvalidWhatsAppMessageError('template_params must be an array');
    }
    const components = normalizeTemplateComponents(raw || []);
    if (
        components.length > 20
        || Buffer.byteLength(JSON.stringify(components), 'utf8') > MAX_TEMPLATE_COMPONENT_BYTES
    ) {
        throw new InvalidWhatsAppMessageError('template_params are too large');
    }
    return components;
};

export function createApiV1MessagingRouter({
    database = db,
    credentialResolver = defaultCredentialResolver,
    billing = defaultBilling,
    fetchImpl = globalThis.fetch,
    parseMetaResponse = readMetaResponse,
    callbackSender = () => undefined,
    documentUploadMiddleware = defaultDocumentUpload,
    formDataFactory = () => new FormData(),
    readFile = fs.readFileSync,
    cleanup = defaultCleanup,
    logger = console,
    now = () => Date.now(),
    apiBase = META_API_BASE,
} = {}) {
    if (
        !database
        || typeof credentialResolver !== 'function'
        || !billing
        || typeof fetchImpl !== 'function'
        || typeof parseMetaResponse !== 'function'
    ) {
        throw new TypeError('API v1 messaging router requires database, credentials, billing and fetch');
    }

    const router = express.Router();

    const resolveContext = async req => {
        const tenantId = Number(req.tenantId);
        if (!Number.isSafeInteger(tenantId) || tenantId <= 0) {
            return { error: 'Invalid tenant context', status: 401 };
        }
        const credentials = await credentialResolver(
            tenantId,
            selectedWhatsAppPhoneNumberId(req),
        );
        if (credentials?.suspended || credentials?.tenant?.status === 'Suspended') {
            return { error: 'Tenant account is suspended', status: 403 };
        }
        if (credentials?.error) {
            return {
                error: credentials.error,
                status: credentials.status || 400,
                code: credentials.code,
            };
        }
        if (!credentials?.tenant || !credentials?.phoneNumberId || !credentials?.accessToken) {
            return { error: 'WhatsApp API credentials not configured', status: 400 };
        }
        return {
            tenantId,
            tenant: credentials.tenant,
            phoneNumberId: String(credentials.phoneNumberId),
            accessToken: String(credentials.accessToken),
        };
    };

    const rejectClosedWindow = (res, context, recipient) => {
        const window = getWhatsAppConversationWindow(
            database,
            context.tenantId,
            recipient,
            now(),
            context.phoneNumberId,
        );
        if (window.isOpen) return false;
        res.status(400).json({
            error: 'WhatsApp 24-hour conversation window is closed; use an approved template.',
            code: 'OUTSIDE_WINDOW',
            window_closed_at: window.closesAt,
        });
        return true;
    };

    const persistOutcome = ({
        context,
        recipient,
        messageType,
        content,
        metaResult,
        messageId,
        mediaUrl = null,
        mediaId = null,
        mediaMimeType = null,
        activityDescription,
    }) => {
        const warnings = [];
        try {
            database.prepare(`
                INSERT INTO messages (
                    tenant_id, direction, sender, recipient, message_type, content,
                    status, wamid, error_message, media_url, media_id, media_mime_type
                ) VALUES (?, 'outgoing', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                context.tenantId,
                context.phoneNumberId,
                recipient,
                messageType,
                content,
                metaResult.ok ? 'sent' : 'failed',
                messageId,
                metaResult.error?.message || null,
                mediaUrl,
                mediaId,
                mediaMimeType,
            );
        } catch (error) {
            warnings.push('local_message_store_failed');
            logger.error('[ApiV1Messaging] Local message store failed:', error);
        }
        try {
            database.prepare(`
                INSERT INTO activity_logs (
                    tenant_id, tenant_name, event_type, description, status
                ) VALUES (?, ?, 'api_message_sent', ?, ?)
            `).run(
                context.tenantId,
                context.tenant.name || 'Unknown',
                activityDescription,
                metaResult.ok ? 'success' : 'error',
            );
        } catch (error) {
            warnings.push('activity_log_store_failed');
            logger.error('[ApiV1Messaging] Activity log store failed:', error);
        }
        return warnings;
    };

    const settleBilling = ({
        reservation,
        metaResult,
        messageId,
        description,
        warnings,
    }) => {
        try {
            if (metaResult.ok) {
                billing.commit(reservation, { referenceId: messageId, description });
            } else {
                billing.release(reservation, metaResult.error?.message || 'Meta send failed');
            }
        } catch (error) {
            warnings.push(metaResult.ok ? 'billing_commit_failed' : 'billing_release_failed');
            logger.error('[ApiV1Messaging] Billing settlement failed:', error);
        }
    };

    const dispatch = async ({
        res,
        context,
        recipient,
        messageType,
        payload,
        storedContent,
        operationKey,
        billingMetadata,
        billingDescription,
        activityDescription,
        failureFallback,
        responseExtra = {},
        mediaUrl = null,
        mediaId = null,
        mediaMimeType = null,
        callback = false,
    }) => {
        let reservation = null;
        let billingSettled = false;
        try {
            reservation = billing.reserve({
                tenantId: context.tenantId,
                operationKey,
                quantity: 1,
                referenceType: 'api_message',
                metadata: { ...billingMetadata, api_version: 'v1' },
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
            const warnings = persistOutcome({
                context,
                recipient,
                messageType,
                content: storedContent,
                metaResult,
                messageId,
                mediaUrl,
                mediaId,
                mediaMimeType,
                activityDescription,
            });

            billingSettled = true;
            settleBilling({
                reservation,
                metaResult,
                messageId,
                description: billingDescription,
                warnings,
            });

            if (!metaResult.ok) {
                return sendMetaFailure(
                    res,
                    metaResult,
                    failureFallback,
                    warnings.length > 0 ? { warnings } : {},
                );
            }

            if (callback) {
                try {
                    await callbackSender(context.tenantId, 'message_sent', {
                        message_id: messageId,
                        phone_number_id: context.phoneNumberId,
                        recipient,
                        type: messageType,
                        status: 'sent',
                    });
                } catch (error) {
                    warnings.push('callback_failed');
                    logger.error('[ApiV1Messaging] Callback failed:', error);
                }
            }

            return res.json({
                success: true,
                message_id: messageId,
                ...responseExtra,
                recipient,
                ...(warnings.length > 0 ? { warnings } : {}),
            });
        } catch (error) {
            if (reservation && !billingSettled) {
                billingSettled = true;
                try {
                    billing.release(reservation, error.message);
                } catch (releaseError) {
                    logger.error('[ApiV1Messaging] Billing release failed:', releaseError);
                }
            }
            throw error;
        }
    };

    const handleRouteError = (res, error, label, fallback) => {
        if (error instanceof InvalidWhatsAppMessageError) {
            return validationFailure(res, error);
        }
        if (billing.handleError(res, error)) return undefined;
        logger.error(`[ApiV1Messaging] ${label}:`, summarizeMetaException(error));
        return res.status(500).json({ error: fallback });
    };

    const sendNativeMessage = createNativeWhatsAppMessageCommand({ database, credentialResolver, billing,
        fetchImpl, parseMetaResponse, apiBase, callbackSender, logger, now });
    router.post('/messages/send', async (req, res) => {
        try {
            const result = await sendNativeMessage({ tenantId: req.tenantId,
                phoneNumberId: selectedWhatsAppPhoneNumberId(req), body: req.body || {} });
            if (!result.metaResult.ok) return sendMetaFailure(res, result.metaResult, 'Failed to send message',
                result.warnings.length ? { warnings: result.warnings } : {});
            return res.json(result.response);
        } catch (error) {
            if (error instanceof NativeWhatsAppMessageError) {
                if (error.code === 'OUTSIDE_WINDOW') return res.status(400).json({
                    error: 'WhatsApp 24-hour conversation window is closed; use an approved template.',
                    code: 'OUTSIDE_WINDOW', window_closed_at: error.windowClosedAt,
                });
                return res.status(error.status).json({ error: error.message, code: error.code });
            }
            return handleRouteError(res, error, 'Send message error', 'Failed to send message');
        }
    });

    router.post('/messages/send-media', async (req, res) => {
        try {
            const body = req.body || {};
            const recipient = normalizeWhatsAppRecipient(body.recipient);
            const mediaType = normalizeWhatsAppMediaType(body.type);
            const mediaUrl = normalizeWhatsAppMediaUrl(body.media_url ?? body.mediaUrl);
            const caption = normalizeWhatsAppMediaCaption(body.caption, mediaType);
            const filename = normalizeWhatsAppMediaFilename(body.filename, mediaType);
            const context = await resolveContext(req);
            if (context.error) return res.status(context.status).json({ error: context.error, code: context.code });
            if (rejectClosedWindow(res, context, recipient)) return undefined;

            const media = { link: mediaUrl };
            if (caption) media.caption = caption;
            if (filename) media.filename = normalizeFilename(filename, 'document');
            const payload = {
                messaging_product: 'whatsapp',
                to: recipient,
                type: mediaType,
                [mediaType]: media,
            };
            return await dispatch({
                res,
                context,
                recipient,
                messageType: mediaType,
                payload,
                storedContent: caption || `[${mediaType}]`,
                operationKey: billing.operations.WHATSAPP_MEDIA,
                billingMetadata: {
                    recipient,
                    message_type: mediaType,
                    media_source: 'url',
                },
                billingDescription: `خصم إرسال وسائط WhatsApp عبر API: ${mediaType}`,
                activityDescription: `إرسال وسائط WhatsApp عبر API (${mediaType})`,
                failureFallback: 'Failed to send media',
                mediaUrl,
            });
        } catch (error) {
            return handleRouteError(res, error, 'Send media error', 'Failed to send media');
        }
    });

    router.post('/messages/send-document', documentUploadMiddleware, async (req, res) => {
        try {
            const file = req.file;
            if (!file) return res.status(400).json({ error: 'recipient and file are required' });
            const recipient = normalizeWhatsAppRecipient(req.body?.recipient);
            if (mediaMessageTypeForMime(file.mimetype) !== 'document') {
                throw new InvalidWhatsAppMessageError(
                    'Uploaded file is not a supported document',
                    { code: 'MEDIA_TYPE_MISMATCH' },
                );
            }
            const caption = normalizeWhatsAppMediaCaption(req.body?.caption, 'document');
            const requestedFilename = normalizeWhatsAppMediaFilename(req.body?.filename, 'document');
            const displayFilename = normalizeFilename(
                requestedFilename || file.originalname,
                'document',
            );
            const context = await resolveContext(req);
            if (context.error) return res.status(context.status).json({ error: context.error, code: context.code });
            if (rejectClosedWindow(res, context, recipient)) return undefined;

            const form = formDataFactory();
            form.append('messaging_product', 'whatsapp');
            form.append('type', file.mimetype);
            form.append('file', readFile(file.path), {
                filename: displayFilename,
                contentType: file.mimetype,
            });
            const uploadResponse = await fetchImpl(
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
            const uploadResult = await parseMetaResponse(uploadResponse);
            if (!uploadResult.ok) {
                return sendMetaFailure(res, uploadResult, 'Failed to upload file');
            }
            const mediaId = uploadResult.data?.id;
            if (!mediaId) {
                return res.status(502).json({
                    error: 'Meta API response did not include a media id',
                });
            }
            const payload = {
                messaging_product: 'whatsapp',
                to: recipient,
                type: 'document',
                document: {
                    id: mediaId,
                    filename: displayFilename,
                    ...(caption ? { caption } : {}),
                },
            };
            return await dispatch({
                res,
                context,
                recipient,
                messageType: 'document',
                payload,
                storedContent: caption ? `${displayFilename}\n\n${caption}` : displayFilename,
                operationKey: billing.operations.WHATSAPP_MEDIA,
                billingMetadata: {
                    recipient,
                    message_type: 'document',
                    media_source: 'file',
                },
                billingDescription: 'خصم إرسال مستند WhatsApp عبر API',
                activityDescription: 'إرسال مستند WhatsApp عبر API',
                failureFallback: 'Failed to send document',
                responseExtra: { media_id: mediaId },
                mediaId,
                mediaMimeType: file.mimetype,
            });
        } catch (error) {
            return handleRouteError(res, error, 'Send document error', 'Failed to send document');
        } finally {
            cleanup(req.file);
        }
    });

    router.post('/messages/send-interactive', async (req, res) => {
        try {
            const input = normalizeInteractiveInput(req.body || {});
            const context = await resolveContext(req);
            if (context.error) return res.status(context.status).json({ error: context.error, code: context.code });
            if (rejectClosedWindow(res, context, input.recipient)) return undefined;
            const interactive = buildInteractivePayload(input);
            const payload = {
                messaging_product: 'whatsapp',
                to: input.recipient,
                type: 'interactive',
                interactive,
            };
            const storedContent = JSON.stringify({
                type: input.interactiveType,
                body: input.bodyText,
                header: input.headerText,
                footer: input.footerText,
                ...(input.interactiveType === 'button'
                    ? { buttons: input.buttons }
                    : { sections: input.sections, list_button: input.listButtonText }),
            });
            return await dispatch({
                res,
                context,
                recipient: input.recipient,
                messageType: 'interactive',
                payload,
                storedContent,
                operationKey: billing.operations.WHATSAPP_INTERACTIVE,
                billingMetadata: {
                    recipient: input.recipient,
                    interactive_type: input.interactiveType,
                },
                billingDescription: `خصم إرسال رسالة WhatsApp تفاعلية عبر API (${input.interactiveType})`,
                activityDescription: `إرسال رسالة تفاعلية عبر API (${input.interactiveType})`,
                failureFallback: 'Failed to send interactive message',
            });
        } catch (error) {
            return handleRouteError(
                res,
                error,
                'Send interactive error',
                'Failed to send interactive message',
            );
        }
    });

    return router;
}

export default createApiV1MessagingRouter;
