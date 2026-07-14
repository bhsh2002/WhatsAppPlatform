import express from 'express';
import db from '../db/database.js';
import { META_API_BASE } from '../config/index.js';
import eventBus from '../services/eventBus.js';
import { resolveCredentials } from '../services/credentials.js';
import { readMetaResponse } from '../services/metaHttp.js';
import { parsePagePagination } from '../services/pagination.js';
import {
    InvalidContactError,
    normalizeAdminContactUpdate,
    normalizeContactCreate,
    normalizeContactFilters,
    parseContactId,
} from '../services/contactValidation.js';
import {
    BILLING_OPERATIONS,
    commit as commitBilling,
    handleBillingError,
    release as releaseBilling,
    reserve as reserveBilling,
} from '../services/billing.js';

const defaultBilling = {
    operations: BILLING_OPERATIONS,
    reserve: reserveBilling,
    commit: commitBilling,
    release: releaseBilling,
    handleError: handleBillingError,
};

const sendContactError = (res, error, fallbackMessage) => {
    if (error instanceof InvalidContactError) {
        return res.status(400).json({ error: error.message, code: error.code });
    }
    console.error(`[Messages] ${fallbackMessage}:`, error);
    return res.status(500).json({ error: fallbackMessage });
};

const isDuplicateContact = error => (
    error?.code === 'SQLITE_CONSTRAINT_UNIQUE'
    || (error?.code === 'SQLITE_CONSTRAINT' && /unique/i.test(error.message || ''))
);

export function createMessageContactsRouter({
    database = db,
    credentialResolver = resolveCredentials,
    fetchImpl = globalThis.fetch,
    parseMetaResponse = readMetaResponse,
    billing = defaultBilling,
    events = eventBus,
    apiBase = META_API_BASE,
} = {}) {
    const router = express.Router();

    router.get('/contacts', (req, res) => {
        try {
            const { search, label } = normalizeContactFilters(req.query);
            const tenantId = req.query.tenant_id === undefined || req.query.tenant_id === ''
                ? null
                : parseContactId(req.query.tenant_id);
            const { page, limit, offset } = parsePagePagination(req.query, {
                defaultLimit: 50,
                maxLimit: 200,
            });
            const where = [];
            const params = [];

            if (tenantId) {
                where.push('c.tenant_id = ?');
                params.push(tenantId);
            }
            if (search) {
                where.push('(c.phone LIKE ? OR c.profile_name LIKE ?)');
                params.push(`%${search}%`, `%${search}%`);
            }
            if (label) {
                where.push('c.label = ?');
                params.push(label);
            }

            const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
            const contacts = database.prepare(`
                SELECT c.*, t.name AS tenant_name,
                    (SELECT COUNT(*) FROM messages m WHERE
                        m.tenant_id = c.tenant_id AND (m.sender = c.phone OR m.recipient = c.phone)
                    ) AS message_count
                FROM contacts c
                LEFT JOIN tenants t ON c.tenant_id = t.id
                ${whereClause}
                ORDER BY c.updated_at DESC, c.id DESC
                LIMIT ? OFFSET ?
            `).all(...params, limit, offset);
            const total = database.prepare(
                `SELECT COUNT(*) AS count FROM contacts c ${whereClause}`,
            ).get(...params).count;

            res.json({ contacts, total, page, limit });
        } catch (error) {
            return sendContactError(res, error, 'Failed to list contacts');
        }
    });

    router.put('/contacts/:id', (req, res) => {
        try {
            const contactId = parseContactId(req.params.id);
            const update = normalizeAdminContactUpdate(req.body);
            const setClauses = [];
            const params = [];

            if (update.label !== undefined) {
                setClauses.push('label = ?');
                params.push(update.label);
            }
            if (update.notes !== undefined) {
                setClauses.push('notes = ?');
                params.push(update.notes);
            }
            if (update.profileName !== undefined) {
                setClauses.push('profile_name = ?');
                params.push(update.profileName);
            }
            setClauses.push("updated_at = datetime('now', 'localtime')");
            params.push(contactId);

            const result = database.prepare(`
                UPDATE contacts SET ${setClauses.join(', ')} WHERE id = ?
            `).run(...params);
            if (result.changes === 0) {
                return res.status(404).json({ error: 'جهة الاتصال غير موجودة' });
            }
            res.json(database.prepare('SELECT * FROM contacts WHERE id = ?').get(contactId));
        } catch (error) {
            return sendContactError(res, error, 'Failed to update contact');
        }
    });

    router.post('/contacts', async (req, res) => {
        let billingReservation = null;
        try {
            const contact = normalizeContactCreate(req.body);
            const tenantId = req.body.tenant_id === undefined
                || req.body.tenant_id === null
                || req.body.tenant_id === ''
                ? null
                : parseContactId(req.body.tenant_id);
            const existing = tenantId
                ? database.prepare('SELECT * FROM contacts WHERE tenant_id = ? AND phone = ?').get(tenantId, contact.phone)
                : database.prepare('SELECT * FROM contacts WHERE tenant_id IS NULL AND phone = ?').get(contact.phone);
            if (existing) {
                return res.status(409).json({ error: 'Contact already exists', contact: existing });
            }

            const tenant = tenantId
                ? database.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId)
                : null;
            if (tenantId && !tenant) return res.status(404).json({ error: 'Tenant not found' });

            if (!tenantId || !req.body.verify) {
                try {
                    const result = database.prepare(`
                        INSERT INTO contacts (tenant_id, phone, profile_name, label, notes, updated_at)
                        VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
                    `).run(
                        tenantId,
                        contact.phone,
                        contact.profileName,
                        contact.label,
                        contact.notes,
                    );
                    return res.status(201).json(
                        database.prepare('SELECT * FROM contacts WHERE id = ?').get(result.lastInsertRowid),
                    );
                } catch (error) {
                    if (isDuplicateContact(error)) {
                        return res.status(409).json({ error: 'Contact already exists' });
                    }
                    throw error;
                }
            }

            const credentials = await credentialResolver({ tenantId });
            if (credentials?.isSuspended) {
                return res.status(403).json({ error: 'Tenant is suspended' });
            }
            if (!credentials?.accessToken || !credentials?.phoneNumberId) {
                return res.status(400).json({ error: 'WhatsApp API credentials not configured for this tenant' });
            }

            const template = database.prepare(`
                SELECT * FROM templates
                WHERE tenant_id = ? AND status = 'approved'
                ORDER BY id ASC LIMIT 1
            `).get(tenantId);
            if (!template) {
                return res.status(400).json({
                    error: 'No approved template found. Add an approved template first to verify contacts.',
                });
            }

            const payload = {
                messaging_product: 'whatsapp',
                to: contact.phone,
                type: 'template',
                template: {
                    name: template.name,
                    language: { code: template.language || 'ar' },
                },
            };
            billingReservation = billing.reserve({
                tenantId,
                operationKey: billing.operations.WHATSAPP_CONTACT_VERIFICATION_TEMPLATE,
                quantity: 1,
                referenceType: 'contact_verification',
                metadata: {
                    phone: contact.phone,
                    recipient: contact.phone,
                    message_type: 'template',
                    template_name: template.name,
                    template_category: template.category || null,
                },
            });

            const response = await fetchImpl(`${apiBase}/${encodeURIComponent(credentials.phoneNumberId)}/messages`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${credentials.accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            });
            const metaResult = await parseMetaResponse(response);
            const data = metaResult.data || {};

            if (!metaResult.ok) {
                const errorMessage = metaResult.error?.message || 'Unknown error';
                const isNotFound = metaResult.error?.code === 131026
                    || errorMessage.includes('not found')
                    || errorMessage.includes('not a valid');
                billing.release(billingReservation, errorMessage);
                billingReservation = null;
                return res.status(400).json({
                    error: isNotFound ? 'Number not found on WhatsApp' : 'Failed to verify number',
                    details: errorMessage,
                    code: metaResult.error?.code,
                });
            }

            const waId = data.contacts?.[0]?.wa_id || contact.phone;
            const messageId = data.messages?.[0]?.id || null;
            billing.commit(billingReservation, {
                referenceId: messageId,
                description: `خصم قالب تحقق جهة اتصال WhatsApp: ${template.name}`,
            });
            billingReservation = null;

            let newContact;
            try {
                const result = database.prepare(`
                    INSERT INTO contacts (tenant_id, phone, profile_name, label, notes, updated_at)
                    VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
                `).run(
                    tenantId,
                    waId,
                    contact.profileName || contact.label,
                    contact.label,
                    contact.notes,
                );
                newContact = database.prepare('SELECT * FROM contacts WHERE id = ?').get(result.lastInsertRowid);
            } catch (error) {
                if (isDuplicateContact(error)) {
                    return res.status(409).json({ error: 'Contact already exists' });
                }
                throw error;
            }

            let storedContent = `[Greeting template: ${template.name}]`;
            try {
                storedContent = JSON.stringify({
                    header: template.header_content
                        ? { type: template.header_type, text: template.header_content }
                        : null,
                    body: template.body || '',
                    footer: template.footer,
                    buttons: template.buttons ? JSON.parse(template.buttons) : null,
                });
            } catch {
                // Keep the stable text fallback when a legacy template has malformed button JSON.
            }

            database.prepare(`
                INSERT INTO messages (tenant_id, direction, sender, recipient, message_type, content, status, wamid)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                tenantId,
                'outgoing',
                credentials.phoneNumberId,
                waId,
                'template',
                storedContent,
                'sent',
                messageId,
            );
            events.emitNewMessage({
                tenant_id: tenantId,
                direction: 'outgoing',
                sender: credentials.phoneNumberId,
                recipient: waId,
                message_type: 'template',
                content: storedContent,
                wamid: messageId,
                created_at: new Date().toISOString(),
            });
            events.emitConversationUpdate(tenantId);
            res.status(201).json({ contact: newContact, template_sent: true });
        } catch (error) {
            if (billingReservation) {
                try {
                    billing.release(billingReservation, error.message);
                } catch (releaseError) {
                    console.error('[Messages] Contact verification billing release error:', releaseError);
                }
            }
            if (billing.handleError(res, error)) return;
            return sendContactError(res, error, 'Failed to create contact');
        }
    });

    router.delete('/contacts/:id', (req, res) => {
        try {
            const contactId = parseContactId(req.params.id);
            const result = database.prepare('DELETE FROM contacts WHERE id = ?').run(contactId);
            if (result.changes === 0) return res.status(404).json({ error: 'Contact not found' });
            res.json({ success: true, message: 'Contact deleted' });
        } catch (error) {
            return sendContactError(res, error, 'Failed to delete contact');
        }
    });

    return router;
}

export default createMessageContactsRouter();
