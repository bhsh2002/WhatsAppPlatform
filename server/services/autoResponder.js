import db from '../db/database.js';
import { META_API_BASE } from '../config/index.js';
import { resolveCredentials } from './credentials.js';
import { decryptIfEncrypted } from './encryption.js';
import eventBus from './eventBus.js';

// ============================================
// Auto-Responder Service
// ============================================
// Evaluates automation rules against incoming messages
// and sends auto-replies via WhatsApp or Messenger APIs.

/**
 * Process an incoming message against automation rules.
 * Returns whether an auto-reply was sent.
 *
 * @param {object} params
 * @returns {Promise<{ replied: boolean, rule_id?: number }>}
 */
export async function processIncomingMessage({
    channel,
    tenant_id,
    contact_id,
    message_text,
    message_type,
    is_new_contact,
    // WhatsApp
    phone_number_id,
    access_token,
    // Messenger
    page_id,
    page_access_token,
    linked_page_id,
}) {
    try {
        // Only process text messages for keyword matching
        // Welcome and away rules fire on any message type
        const rules = getMatchingRules(tenant_id, channel);

        if (!rules || rules.length === 0) {
            return { replied: false };
        }

        for (const rule of rules) {
            // Check cooldown first (fast check, avoids expensive matching)
            if (isOnCooldown(rule.id, contact_id, channel, rule.cooldown_seconds)) {
                continue;
            }

            // Evaluate rule
            const matches = evaluateRule(rule, {
                message_text,
                message_type,
                is_new_contact,
            });

            if (!matches) continue;

            // Rule matched — send response
            const sent = await sendAutoReply(rule, {
                channel,
                tenant_id,
                contact_id,
                phone_number_id,
                access_token,
                page_id,
                page_access_token,
                linked_page_id,
            });

            if (sent) {
                // Update cooldown
                updateCooldown(rule.id, contact_id, channel);

                // Update stats
                db.prepare(`
                    UPDATE automation_rules
                    SET trigger_count = trigger_count + 1,
                        last_triggered_at = datetime('now')
                    WHERE id = ?
                `).run(rule.id);

                console.log(`[AutoResponder] Rule "${rule.name}" (id=${rule.id}) fired for ${channel}:${contact_id}`);
                return { replied: true, rule_id: rule.id };
            }
        }

        return { replied: false };
    } catch (error) {
        console.error('[AutoResponder] Processing error:', error);
        return { replied: false };
    }
}

/**
 * Dry-run test: evaluate rules without sending.
 */
export function testRules({ channel, tenant_id, contact_id, message_text, is_new_contact }) {
    const rules = getMatchingRules(tenant_id, channel);

    for (const rule of rules) {
        const matches = evaluateRule(rule, {
            message_text,
            message_type: 'text',
            is_new_contact,
        });

        if (matches) {
            return {
                would_match: true,
                rule: {
                    id: rule.id,
                    name: rule.name,
                    rule_type: rule.rule_type,
                    priority: rule.priority,
                    channel: rule.channel,
                },
                response_text: rule.response_text,
                response_type: rule.response_type,
            };
        }
    }

    return { would_match: false, rule: null, response_text: null };
}

// ============================================
// Internal helpers
// ============================================

/**
 * Get all active rules for a tenant+channel, sorted by priority ASC.
 */
function getMatchingRules(tenantId, channel) {
    return db.prepare(`
        SELECT * FROM automation_rules
        WHERE is_active = 1
          AND (tenant_id IS NULL OR tenant_id = ?)
          AND (channel = 'all' OR channel = ?)
        ORDER BY priority ASC, id ASC
    `).all(tenantId, channel);
}

/**
 * Check if a contact is still on cooldown for a rule.
 */
function isOnCooldown(ruleId, contactId, channel, cooldownSeconds) {
    if (!cooldownSeconds || cooldownSeconds <= 0) return false;

    const row = db.prepare(`
        SELECT last_triggered_at FROM automation_cooldowns
        WHERE rule_id = ? AND contact_id = ? AND channel = ?
    `).get(ruleId, contactId, channel);

    if (!row) return false;

    const lastTriggered = new Date(row.last_triggered_at);
    const elapsed = (Date.now() - lastTriggered.getTime()) / 1000;
    return elapsed < cooldownSeconds;
}

/**
 * Update or insert cooldown record.
 */
function updateCooldown(ruleId, contactId, channel) {
    db.prepare(`
        INSERT INTO automation_cooldowns (rule_id, contact_id, channel, last_triggered_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(rule_id, contact_id, channel) DO UPDATE SET
            last_triggered_at = datetime('now')
    `).run(ruleId, contactId, channel);
}

/**
 * Evaluate whether a rule matches the incoming message.
 */
function evaluateRule(rule, { message_text, message_type, is_new_contact }) {
    switch (rule.rule_type) {
        case 'welcome':
            return is_new_contact;

        case 'away':
            return isWithinAwaySchedule(rule);

        case 'keyword':
            return matchesKeyword(rule, message_text);

        default:
            return false;
    }
}

/**
 * Check if current time falls within the away schedule.
 */
function isWithinAwaySchedule(rule) {
    if (!rule.schedule_days || !rule.schedule_start_time || !rule.schedule_end_time) {
        return false;
    }

    let days;
    try {
        days = JSON.parse(rule.schedule_days);
    } catch {
        return false;
    }

    // Get current time in the configured timezone
    const tz = rule.schedule_timezone || 'Africa/Tripoli';
    const now = new Date();

    let localTimeStr;
    try {
        localTimeStr = now.toLocaleString('en-US', { timeZone: tz });
    } catch {
        localTimeStr = now.toLocaleString('en-US');
    }
    const localDate = new Date(localTimeStr);

    // Check day of week
    const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const currentDay = dayNames[localDate.getDay()];

    if (!days.includes(currentDay)) {
        return false;
    }

    // Check time range
    const currentMinutes = localDate.getHours() * 60 + localDate.getMinutes();
    const [startH, startM] = rule.schedule_start_time.split(':').map(Number);
    const [endH, endM] = rule.schedule_end_time.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    // Handle overnight ranges (e.g., 20:00 - 08:00)
    if (startMinutes <= endMinutes) {
        // Same-day range: 08:00 - 17:00
        return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    } else {
        // Overnight range: 20:00 - 08:00
        return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }
}

/**
 * Check if message text matches a keyword rule pattern.
 */
function matchesKeyword(rule, messageText) {
    if (!messageText || !rule.match_pattern) return false;

    const text = rule.match_case_sensitive ? messageText : messageText.toLowerCase();
    const pattern = rule.match_case_sensitive ? rule.match_pattern : rule.match_pattern.toLowerCase();

    switch (rule.match_type) {
        case 'exact':
            return text.trim() === pattern.trim();

        case 'contains': {
            // Support comma-separated patterns: "سعر,أسعار,كم"
            const patterns = pattern.split(',').map(p => p.trim()).filter(Boolean);
            return patterns.some(p => text.includes(p));
        }

        case 'regex':
            try {
                const flags = rule.match_case_sensitive ? '' : 'i';
                const regex = new RegExp(rule.match_pattern, flags);
                return regex.test(messageText);
            } catch {
                console.warn(`[AutoResponder] Invalid regex pattern for rule ${rule.id}: ${rule.match_pattern}`);
                return false;
            }

        default:
            return false;
    }
}

/**
 * Send auto-reply message via the appropriate channel API.
 */
async function sendAutoReply(rule, {
    channel,
    tenant_id,
    contact_id,
    phone_number_id,
    access_token,
    page_id,
    page_access_token,
    linked_page_id,
}) {
    const responseText = rule.response_text;
    if (!responseText && rule.response_type === 'text') return false;

    try {
        if (channel === 'whatsapp') {
            return await sendWhatsAppReply(rule, {
                tenant_id,
                contact_id,
                phone_number_id,
                access_token,
                responseText,
            });
        } else if (channel === 'messenger') {
            return await sendMessengerReply(rule, {
                tenant_id,
                contact_id,
                page_id,
                page_access_token,
                linked_page_id,
                responseText,
            });
        }
    } catch (error) {
        console.error(`[AutoResponder] Send failed for rule ${rule.id}:`, error.message);
        return false;
    }

    return false;
}

/**
 * Send reply via WhatsApp Meta API.
 */
async function sendWhatsAppReply(rule, { tenant_id, contact_id, phone_number_id, access_token, responseText }) {
    // Resolve credentials
    let resolvedPhoneId = phone_number_id;
    let resolvedToken = access_token;

    if (tenant_id) {
        const creds = resolveCredentials({ tenantId: tenant_id });
        if (creds.isSuspended) return false;
        resolvedPhoneId = resolvedPhoneId || creds.phoneNumberId;
        resolvedToken = resolvedToken || creds.accessToken;
    }

    if (!resolvedPhoneId || !resolvedToken) {
        console.warn(`[AutoResponder] Missing WA credentials for tenant ${tenant_id}`);
        return false;
    }

    let payload;
    if (rule.response_type === 'template' && rule.response_template_name) {
        payload = {
            messaging_product: 'whatsapp',
            to: contact_id,
            type: 'template',
            template: {
                name: rule.response_template_name,
                language: { code: rule.response_template_language || 'ar' },
            },
        };
    } else {
        payload = {
            messaging_product: 'whatsapp',
            to: contact_id,
            type: 'text',
            text: { body: responseText },
        };
    }

    const response = await fetch(`${META_API_BASE}/${resolvedPhoneId}/messages`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${resolvedToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (response.ok) {
        const wamid = data.messages?.[0]?.id;

        // Store outgoing message
        db.prepare(`
            INSERT INTO messages (tenant_id, direction, sender, recipient, message_type, content, status, wamid)
            VALUES (?, 'outgoing', ?, ?, ?, ?, 'sent', ?)
        `).run(
            tenant_id || null,
            resolvedPhoneId,
            contact_id,
            rule.response_type === 'template' ? 'template' : 'text',
            responseText,
            wamid
        );

        // SSE update
        eventBus.emitNewMessage({
            tenant_id,
            direction: 'outgoing',
            sender: resolvedPhoneId,
            recipient: contact_id,
            content: responseText,
            wamid,
            auto_reply: true,
        });
        eventBus.emitConversationUpdate(tenant_id);

        return true;
    } else {
        console.error(`[AutoResponder] WA API error:`, data.error?.message || JSON.stringify(data));
        return false;
    }
}

/**
 * Send reply via Messenger Send API.
 */
async function sendMessengerReply(rule, { tenant_id, contact_id, page_id, page_access_token, linked_page_id, responseText }) {
    let token = page_access_token;

    // If no token provided, try to resolve from tenant_pages
    if (!token && linked_page_id) {
        const page = db.prepare('SELECT * FROM tenant_pages WHERE id = ? AND is_active = 1').get(linked_page_id);
        if (page?.page_access_token_encrypted) {
            token = decryptIfEncrypted(page.page_access_token_encrypted);
            page_id = page_id || page.page_id;
        }
    }

    if (!token || !page_id) {
        console.warn(`[AutoResponder] Missing Messenger credentials for page ${page_id}`);
        return false;
    }

    const response = await fetch(`${META_API_BASE}/${page_id}/messages`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            recipient: { id: contact_id },
            messaging_type: 'RESPONSE',
            message: { text: responseText },
        }),
    });

    const data = await response.json();

    if (response.ok) {
        const mid = data.message_id;

        // Find conversation
        const conv = db.prepare(
            'SELECT * FROM fb_conversations WHERE user_psid = ? AND linked_page_id = ? AND is_active = 1 LIMIT 1'
        ).get(contact_id, linked_page_id);

        if (conv) {
            // Store outgoing message
            const linkedPageRow = db.prepare('SELECT page_name FROM tenant_pages WHERE id = ?').get(linked_page_id);
            db.prepare(`
                INSERT INTO fb_messages (conversation_id, tenant_id, mid, direction, sender_id, sender_name, message_text)
                VALUES (?, ?, ?, 'outgoing', ?, ?, ?)
            `).run(conv.id, tenant_id, mid, page_id, linkedPageRow?.page_name || page_id, responseText);

            // Update conversation
            db.prepare(`
                UPDATE fb_conversations
                SET last_message = ?, last_message_time = datetime('now')
                WHERE id = ?
            `).run(responseText.substring(0, 100), conv.id);

            // SSE update
            eventBus.broadcast('admin', 'fb_message:new', {
                tenant_id,
                page_id,
                conversation_id: conv.id,
                direction: 'outgoing',
                message: responseText,
                auto_reply: true,
            });
            eventBus.broadcast(`tenant:${tenant_id}`, 'fb_message:new', {
                tenant_id,
                page_id,
                conversation_id: conv.id,
                direction: 'outgoing',
                message: responseText,
                auto_reply: true,
            });
        }

        return true;
    } else {
        console.error(`[AutoResponder] Messenger API error:`, data.error?.message || JSON.stringify(data));
        return false;
    }
}
