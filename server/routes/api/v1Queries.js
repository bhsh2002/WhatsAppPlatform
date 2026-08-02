import express from 'express';

import db from '../../db/database.js';
import { parseListPagination } from '../../services/pagination.js';
import {
    InvalidWhatsAppMessageError,
    normalizeWhatsAppRecipient,
} from '../../services/whatsappMessageValidation.js';
import {
    listTenantWhatsAppNumbers,
    resolveTenantWhatsAppContext,
    selectedWhatsAppPhoneNumberId,
} from '../../services/whatsappNumbers.js';

const TEMPLATE_STATUSES = new Set(['draft', 'pending', 'approved', 'rejected']);

const tenantIdFromRequest = req => {
    const tenantId = Number(req.tenantId);
    return Number.isSafeInteger(tenantId) && tenantId > 0 ? tenantId : null;
};

const normalizeTemplateStatus = value => {
    const status = value == null || value === '' ? 'approved' : String(value).trim().toLowerCase();
    if (!TEMPLATE_STATUSES.has(status)) {
        throw new InvalidWhatsAppMessageError(
            'status must be one of: draft, pending, approved, rejected',
        );
    }
    return status;
};

const normalizeTemplateId = value => {
    const normalized = String(value ?? '').trim();
    if (!/^\d+$/.test(normalized)) {
        throw new InvalidWhatsAppMessageError('Template id is invalid');
    }
    const templateId = Number(normalized);
    if (!Number.isSafeInteger(templateId) || templateId <= 0) {
        throw new InvalidWhatsAppMessageError('Template id is invalid');
    }
    return templateId;
};

export function createApiV1QueriesRouter({ database = db, logger = console } = {}) {
    if (!database) throw new TypeError('API v1 queries router requires a database');
    const router = express.Router();

    const tenantContext = (req, res) => {
        const tenantId = tenantIdFromRequest(req);
        if (!tenantId) {
            res.status(401).json({ error: 'Invalid tenant context' });
            return null;
        }
        return tenantId;
    };

    const fail = (res, error, label, fallback) => {
        if (error instanceof InvalidWhatsAppMessageError) {
            return res.status(400).json({ error: error.message, ...(error.details || {}) });
        }
        logger.error(`[ApiV1Queries] ${label}:`, error);
        return res.status(500).json({ error: fallback });
    };

    const resolveOptionalNumber = (req, res, tenantId) => {
        const context = resolveTenantWhatsAppContext({
            database,
            tenantId,
            request: req,
            requireToken: false,
        });
        if (!context.error) return context;
        if (context.code === 'WHATSAPP_NUMBER_REQUIRED' && !selectedWhatsAppPhoneNumberId(req)) {
            return { phoneNumberId: null };
        }
        res.status(context.status).json({ error: context.error, code: context.code });
        return null;
    };

    router.get('/conversations', (req, res) => {
        try {
            const tenantId = tenantContext(req, res);
            if (!tenantId) return undefined;
            const context = resolveOptionalNumber(req, res, tenantId);
            if (!context) return undefined;
            const numberFilter = context.phoneNumberId
                ? {
                    unreadSql: ' AND unread.recipient = ?',
                    messageSql: `
                      AND ((direction = 'incoming' AND recipient = ?)
                        OR (direction = 'outgoing' AND sender = ?))`,
                    unreadArgs: [context.phoneNumberId],
                    messageArgs: [context.phoneNumberId, context.phoneNumberId],
                }
                : { unreadSql: '', messageSql: '', unreadArgs: [], messageArgs: [] };
            const { limit, offset } = parseListPagination(req.query, {
                defaultLimit: 100,
                maxLimit: 200,
            });
            const conversations = database.prepare(`
                SELECT
                    latest.contact,
                    latest.created_at AS last_interaction,
                    latest.content AS last_message,
                    latest.message_type AS last_message_type,
                    contact.profile_name,
                    (
                        SELECT COUNT(*)
                        FROM messages unread
                        WHERE unread.sender = latest.contact
                          AND unread.direction = 'incoming'
                          AND unread.status = 'received'
                          AND unread.tenant_id = latest.tenant_id
                          ${numberFilter.unreadSql}
                    ) AS unread_count
                FROM (
                    SELECT
                        id,
                        content,
                        created_at,
                        message_type,
                        tenant_id,
                        CASE WHEN direction = 'incoming' THEN sender ELSE recipient END AS contact,
                        ROW_NUMBER() OVER (
                            PARTITION BY CASE WHEN direction = 'incoming' THEN sender ELSE recipient END
                            ORDER BY created_at DESC, id DESC
                        ) AS row_number
                    FROM messages
                    WHERE tenant_id = ?
                      ${numberFilter.messageSql}
                ) latest
                LEFT JOIN contacts contact
                  ON contact.tenant_id = latest.tenant_id
                 AND contact.phone = latest.contact
                WHERE latest.row_number = 1
                ORDER BY latest.created_at DESC, latest.id DESC
                LIMIT ? OFFSET ?
            `).all(
                ...numberFilter.unreadArgs,
                tenantId,
                ...numberFilter.messageArgs,
                limit,
                offset,
            );
            return res.json(conversations);
        } catch (error) {
            return fail(res, error, 'Get conversations error', 'Failed to get conversations');
        }
    });

    router.get('/conversations/:phone/messages', (req, res) => {
        try {
            const tenantId = tenantContext(req, res);
            if (!tenantId) return undefined;
            const context = resolveOptionalNumber(req, res, tenantId);
            if (!context) return undefined;
            const numberPredicate = context.phoneNumberId
                ? `AND ((direction = 'incoming' AND recipient = ?)
                    OR (direction = 'outgoing' AND sender = ?))`
                : '';
            const numberArgs = context.phoneNumberId
                ? [context.phoneNumberId, context.phoneNumberId]
                : [];
            const phone = normalizeWhatsAppRecipient(req.params.phone);
            const { limit, offset } = parseListPagination(req.query, {
                defaultLimit: 100,
                maxLimit: 200,
            });
            const messages = database.prepare(`
                SELECT id, tenant_id, direction, recipient, sender, message_type,
                       content, status, wamid, error_message, media_id, media_url,
                       media_mime_type, referral_ctwa_clid, referral_source_id,
                       referral_source_type, referral_source_url, created_at
                FROM messages
                WHERE tenant_id = ? AND (sender = ? OR recipient = ?)
                  ${numberPredicate}
                ORDER BY created_at DESC, id DESC
                LIMIT ? OFFSET ?
            `).all(
                tenantId,
                phone,
                phone,
                ...numberArgs,
                limit,
                offset,
            );
            return res.json(messages.reverse());
        } catch (error) {
            return fail(res, error, 'Get messages error', 'Failed to get messages');
        }
    });

    router.get('/whatsapp/numbers', (req, res) => {
        try {
            const tenantId = tenantContext(req, res);
            if (!tenantId) return undefined;
            return res.json({ numbers: listTenantWhatsAppNumbers(database, tenantId) });
        } catch (error) {
            return fail(res, error, 'Get WhatsApp numbers error', 'Failed to get WhatsApp numbers');
        }
    });

    router.get('/templates', (req, res) => {
        try {
            const tenantId = tenantContext(req, res);
            if (!tenantId) return undefined;
            const status = normalizeTemplateStatus(req.query.status);
            const { limit, offset } = parseListPagination(req.query, {
                defaultLimit: 100,
                maxLimit: 200,
            });
            const templates = database.prepare(`
                SELECT id, tenant_id, name, language, category, header_type,
                       header_content, body, footer, buttons, variables, status,
                       meta_template_id, quality_score, parameter_format,
                       created_at, updated_at
                FROM templates
                WHERE tenant_id = ? AND status = ?
                ORDER BY created_at DESC, id DESC
                LIMIT ? OFFSET ?
            `).all(tenantId, status, limit, offset);
            return res.json(templates);
        } catch (error) {
            return fail(res, error, 'Get templates error', 'Failed to get templates');
        }
    });

    router.get('/templates/:id', (req, res) => {
        try {
            const tenantId = tenantContext(req, res);
            if (!tenantId) return undefined;
            const templateId = normalizeTemplateId(req.params.id);
            const template = database.prepare(`
                SELECT id, tenant_id, name, language, category, header_type,
                       header_content, body, footer, buttons, variables, status,
                       meta_template_id, quality_score, parameter_format,
                       created_at, updated_at
                FROM templates
                WHERE id = ? AND tenant_id = ?
            `).get(templateId, tenantId);
            if (!template) return res.status(404).json({ error: 'Template not found' });
            return res.json(template);
        } catch (error) {
            return fail(res, error, 'Get template error', 'Failed to get template');
        }
    });

    return router;
}

export default createApiV1QueriesRouter;
