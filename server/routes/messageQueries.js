import express from 'express';

import db from '../db/database.js';
import { normalizeContactPhone } from '../services/contactValidation.js';
import { enrichTemplateFallbackMessages } from '../services/messaging.js';
import { parseListPagination } from '../services/pagination.js';
import { getWhatsAppConversationWindow } from '../services/whatsappConversationWindow.js';

const WINDOW_MS = 24 * 60 * 60 * 1000;
const DIRECTIONS = new Set(['incoming', 'outgoing']);
const NULL_TENANT_TOKENS = new Set(['', 'null', 'undefined']);

const MESSAGE_COLUMNS = `
    m.id, m.tenant_id, m.direction, m.recipient, m.sender,
    m.message_type, m.content, m.status, m.wamid, m.error_message,
    m.media_id, m.media_url, m.media_mime_type,
    m.referral_ctwa_clid, m.referral_source_id,
    m.referral_source_type, m.referral_source_url, m.created_at
`;

const THREAD_MESSAGE_COLUMNS = `
    id, tenant_id, direction, recipient, sender,
    message_type, content, status, wamid, error_message,
    media_id, media_url, media_mime_type,
    referral_ctwa_clid, referral_source_id,
    referral_source_type, referral_source_url, created_at
`;

class InvalidMessageQueryError extends Error {}

const parseTenantId = (value, { allowNullTokens = false } = {}) => {
    if (value == null) return null;
    const normalized = String(value).trim();
    if (allowNullTokens && NULL_TENANT_TOKENS.has(normalized.toLowerCase())) return null;
    if (!/^\d+$/.test(normalized)) throw new InvalidMessageQueryError('tenant_id is invalid');
    const tenantId = Number(normalized);
    if (!Number.isSafeInteger(tenantId) || tenantId <= 0) {
        throw new InvalidMessageQueryError('tenant_id is invalid');
    }
    return tenantId;
};

const parsePhone = value => {
    try {
        return normalizeContactPhone(value);
    } catch {
        throw new InvalidMessageQueryError('phone number is invalid');
    }
};

const parsePhoneNumberId = value => {
    if (value == null || value === '') return null;
    const normalized = String(value).trim();
    if (!normalized || normalized.length > 256 || /[\u0000-\u001f\u007f]/.test(normalized)) {
        throw new InvalidMessageQueryError('phone_number_id is invalid');
    }
    return normalized;
};

const sendQueryError = (res, error, fallbackMessage, logLabel) => {
    if (error instanceof InvalidMessageQueryError) {
        return res.status(400).json({ error: error.message });
    }
    console.error(`[MessageQueries] ${logLabel}:`, error);
    return res.status(500).json({ error: fallbackMessage });
};

export function createMessageQueriesRouter({
    database = db,
    now = () => Date.now(),
    enrichMessages = (messages, contentField = 'content') => (
        enrichTemplateFallbackMessages(messages, contentField, database)
    ),
} = {}) {
    const router = express.Router();

    router.get('/window-status/:phone', (req, res) => {
        try {
            const phone = parsePhone(req.params.phone);
            const tenantId = parseTenantId(req.query?.tenant_id, { allowNullTokens: true });
            const phoneNumberId = parsePhoneNumberId(req.query?.phone_number_id);
            if (tenantId && phoneNumberId) {
                const window = getWhatsAppConversationWindow(
                    database,
                    tenantId,
                    phone,
                    now(),
                    phoneNumberId,
                );
                return res.json({
                    is_open: window.isOpen,
                    last_customer_message_at: window.lastCustomerMessageAt,
                    window_closes_at: window.closesAt,
                });
            }
            const contact = tenantId
                ? database.prepare(`
                    SELECT last_customer_message_at
                    FROM contacts
                    WHERE tenant_id = ? AND phone = ?
                `).get(tenantId, phone)
                : database.prepare(`
                    SELECT last_customer_message_at
                    FROM contacts
                    WHERE tenant_id IS NULL AND phone = ?
                    ORDER BY last_customer_message_at DESC
                    LIMIT 1
                `).get(phone);
            const timestamp = Date.parse(contact?.last_customer_message_at || '');
            const validTimestamp = Number.isFinite(timestamp) ? timestamp : null;
            return res.json({
                is_open: validTimestamp !== null && now() - validTimestamp <= WINDOW_MS,
                last_customer_message_at: validTimestamp === null
                    ? null
                    : new Date(validTimestamp).toISOString(),
                window_closes_at: validTimestamp === null
                    ? null
                    : new Date(validTimestamp + WINDOW_MS).toISOString(),
            });
        } catch (error) {
            return sendQueryError(res, error, 'Failed to fetch window status', 'Window status error');
        }
    });

    router.get('/logs', (req, res) => {
        try {
            const { limit, offset } = parseListPagination(req.query, {
                defaultLimit: 50,
                maxLimit: 200,
            });
            const tenantId = parseTenantId(req.query?.tenant_id);
            const phoneNumberId = parsePhoneNumberId(req.query?.phone_number_id);
            const direction = req.query?.direction == null || req.query.direction === ''
                ? null
                : String(req.query.direction).trim().toLowerCase();
            if (direction && !DIRECTIONS.has(direction)) {
                throw new InvalidMessageQueryError('direction is invalid');
            }

            const conditions = [];
            const filterParams = [];
            if (tenantId) {
                conditions.push('m.tenant_id = ?');
                filterParams.push(tenantId);
            }
            if (direction) {
                conditions.push('m.direction = ?');
                filterParams.push(direction);
            }
            if (phoneNumberId) {
                conditions.push("((m.direction = 'incoming' AND m.recipient = ?) OR (m.direction = 'outgoing' AND m.sender = ?))");
                filterParams.push(phoneNumberId, phoneNumberId);
            }
            const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
            const messages = enrichMessages(database.prepare(`
                SELECT ${MESSAGE_COLUMNS}, tenant.name AS tenant_name
                FROM messages m
                LEFT JOIN tenants tenant ON tenant.id = m.tenant_id
                ${whereClause}
                ORDER BY m.created_at DESC, m.id DESC
                LIMIT ? OFFSET ?
            `).all(...filterParams, limit, offset));
            const total = database.prepare(`
                SELECT COUNT(*) AS total
                FROM messages m
                ${whereClause}
            `).get(...filterParams).total;
            return res.json({ messages, total, limit, offset });
        } catch (error) {
            return sendQueryError(res, error, 'Failed to fetch message logs', 'Logs fetch error');
        }
    });

    router.get('/webhook-logs', (req, res) => {
        try {
            const { limit, offset } = parseListPagination(req.query, {
                defaultLimit: 50,
                maxLimit: 200,
            });
            const logs = database.prepare(`
                SELECT id, tenant_id, event_type, payload, processed, created_at
                FROM webhook_logs
                ORDER BY created_at DESC, id DESC
                LIMIT ? OFFSET ?
            `).all(limit, offset);
            return res.json(logs);
        } catch (error) {
            return sendQueryError(res, error, 'Failed to fetch webhook logs', 'Webhook logs fetch error');
        }
    });

    router.get('/conversations', (req, res) => {
        try {
            const { limit, offset } = parseListPagination(req.query, {
                defaultLimit: 100,
                maxLimit: 200,
            });
            const tenantId = parseTenantId(req.query?.tenant_id);
            const phoneNumberId = parsePhoneNumberId(req.query?.phone_number_id);
            const scopeConditions = [];
            const scopeParams = [];
            if (tenantId) {
                scopeConditions.push('tenant_id = ?');
                scopeParams.push(tenantId);
            }
            if (phoneNumberId) {
                scopeConditions.push("((direction = 'incoming' AND recipient = ?) OR (direction = 'outgoing' AND sender = ?))");
                scopeParams.push(phoneNumberId, phoneNumberId);
            }
            const scopeSql = scopeConditions.length ? `WHERE ${scopeConditions.join(' AND ')}` : '';
            const unreadNumberSql = phoneNumberId ? 'AND unread.recipient = ?' : '';
            const params = [
                ...(phoneNumberId ? [phoneNumberId] : []),
                ...scopeParams,
                limit,
                offset,
            ];
            const conversations = enrichMessages(database.prepare(`
                SELECT
                    latest.contact,
                    latest.tenant_id,
                    tenant.name AS tenant_name,
                    latest.created_at AS last_interaction,
                    latest.content AS last_message,
                    latest.message_type AS last_message_type,
                    contact.profile_name,
                    contact.profile_picture_url,
                    contact.last_ctwa_clid,
                    contact.last_ctwa_source_id,
                    contact.last_ctwa_source_type,
                    contact.last_ctwa_source_url,
                    contact.last_ctwa_received_at,
                    (
                        SELECT COUNT(*)
                        FROM messages unread
                        WHERE unread.sender = latest.contact
                          AND unread.direction = 'incoming'
                          AND unread.status = 'received'
                          AND unread.tenant_id IS latest.tenant_id
                          ${unreadNumberSql}
                    ) AS unread_count
                FROM (
                    SELECT
                        id, content, created_at, message_type, tenant_id,
                        CASE WHEN direction = 'incoming' THEN sender ELSE recipient END AS contact,
                        ROW_NUMBER() OVER (
                            PARTITION BY
                                CASE WHEN direction = 'incoming' THEN sender ELSE recipient END,
                                tenant_id
                            ORDER BY created_at DESC, id DESC
                        ) AS row_number
                    FROM messages
                    ${scopeSql}
                ) latest
                LEFT JOIN contacts contact
                  ON contact.phone = latest.contact
                 AND contact.tenant_id IS latest.tenant_id
                LEFT JOIN tenants tenant ON tenant.id = latest.tenant_id
                WHERE latest.row_number = 1
                ORDER BY last_interaction DESC, latest.id DESC
                LIMIT ? OFFSET ?
            `).all(...params), 'last_message');
            return res.json(conversations);
        } catch (error) {
            return sendQueryError(res, error, 'Failed to fetch conversations', 'Conversations fetch error');
        }
    });

    router.get('/conversations/:number/messages', (req, res) => {
        try {
            const phone = parsePhone(req.params.number);
            const tenantId = parseTenantId(req.query?.tenant_id, { allowNullTokens: true });
            const phoneNumberId = parsePhoneNumberId(req.query?.phone_number_id);
            const { limit, offset } = parseListPagination(req.query, {
                defaultLimit: 50,
                maxLimit: 200,
            });
            const scopeSql = tenantId ? 'tenant_id = ?' : 'tenant_id IS NULL';
            const scopeParams = tenantId ? [tenantId] : [];
            const numberSql = phoneNumberId
                ? "AND ((direction = 'incoming' AND recipient = ?) OR (direction = 'outgoing' AND sender = ?))"
                : '';
            const numberParams = phoneNumberId ? [phoneNumberId, phoneNumberId] : [];
            const messages = enrichMessages(database.prepare(`
                SELECT * FROM (
                    SELECT ${THREAD_MESSAGE_COLUMNS}
                    FROM messages
                    WHERE (sender = ? OR recipient = ?) AND ${scopeSql} ${numberSql}
                    ORDER BY created_at DESC, id DESC
                    LIMIT ? OFFSET ?
                ) page
                ORDER BY created_at ASC, id ASC
            `).all(phone, phone, ...scopeParams, ...numberParams, limit, offset));
            database.prepare(`
                UPDATE messages
                SET status = 'read'
                WHERE sender = ?
                  AND direction = 'incoming'
                  AND status = 'received'
                  AND ${scopeSql}
                  ${phoneNumberId ? 'AND recipient = ?' : ''}
            `).run(phone, ...scopeParams, ...(phoneNumberId ? [phoneNumberId] : []));
            return res.json(messages);
        } catch (error) {
            return sendQueryError(res, error, 'Failed to fetch thread messages', 'Thread fetch error');
        }
    });

    return router;
}

export default createMessageQueriesRouter();
