import express from 'express';

import { META_API_BASE } from '../config/index.js';
import {
    getTimestampMs,
    insertMessengerMessage,
    normalizeMessengerTimestamp,
} from '../services/messengerMessages.js';
import { requestMetaJson } from '../services/metaHttp.js';

const normalizeMetaNextUrl = (value, apiBase) => {
    if (!value) return null;
    try {
        const next = new URL(value);
        const base = new URL(apiBase);
        return next.protocol === 'https:' && next.origin === base.origin ? next.toString() : null;
    } catch {
        return null;
    }
};

export function createTenantMessengerSyncRouter({
    database,
    decryptToken,
    requestMeta = requestMetaJson,
    apiBase = META_API_BASE,
} = {}) {
    if (!database || typeof decryptToken !== 'function') {
        throw new TypeError('Tenant Messenger sync router requires database and token decryption');
    }
    const router = express.Router();

    router.post('/unified/messenger/sync', async (req, res) => {
        try {
            const tenantId = req.user.tenant_id;
            const pages = database.prepare(`
                SELECT id, tenant_id, page_id, page_name, page_access_token_encrypted
                FROM tenant_pages
                WHERE tenant_id = ? AND is_active = 1
                ORDER BY id ASC
                LIMIT 100
            `).all(tenantId);
            if (pages.length === 0) {
                return res.json({
                    success: true,
                    synced_conversations: 0,
                    synced_messages: 0,
                    failed_pages: 0,
                    message: 'لا توجد صفحات مرتبطة',
                });
            }

            let totalConversations = 0;
            let totalMessages = 0;
            let failedPages = 0;
            for (const page of pages) {
                const accessToken = decryptToken(page.page_access_token_encrypted);
                if (!accessToken) {
                    failedPages += 1;
                    continue;
                }
                try {
                    let url = `${apiBase}/${encodeURIComponent(page.page_id)}/conversations?fields=participants,messages.limit(10){message,from,created_time,mid,attachments},updated_time&limit=25`;
                    for (let pageNumber = 0; url && pageNumber < 20; pageNumber += 1) {
                        const result = await requestMeta(url, {
                            headers: { Authorization: `Bearer ${accessToken}` },
                        });
                        if (!result.ok) {
                            failedPages += 1;
                            break;
                        }
                        const conversations = Array.isArray(result.data?.data) ? result.data.data : [];
                        for (const conversation of conversations) {
                            const participants = Array.isArray(conversation.participants?.data)
                                ? conversation.participants.data
                                : [];
                            const userParticipant = participants.find(
                                participant => String(participant.id) !== String(page.page_id)
                            );
                            const userPsid = userParticipant?.id ? String(userParticipant.id) : null;
                            if (!userPsid) continue;

                            let userName = userParticipant.name || null;
                            let userProfilePic = null;
                            try {
                                const profileResult = await requestMeta(
                                    `${apiBase}/${encodeURIComponent(userPsid)}?fields=name,first_name,last_name,profile_pic`,
                                    { headers: { Authorization: `Bearer ${accessToken}` } }
                                );
                                if (profileResult.ok) {
                                    const profile = profileResult.data || {};
                                    userName = profile.name
                                        || [profile.first_name, profile.last_name].filter(Boolean).join(' ')
                                        || userName;
                                    userProfilePic = profile.profile_pic || null;
                                }
                            } catch (error) {
                                console.warn(
                                    `[TenantMessengerSync] Profile fetch failed for ${userPsid}:`,
                                    error.message
                                );
                            }

                            const messages = Array.isArray(conversation.messages?.data)
                                ? conversation.messages.data
                                : [];
                            const lastMessage = messages.length > 0
                                ? messages.reduce((left, right) => (
                                    getTimestampMs(left.created_time) > getTimestampMs(right.created_time)
                                        ? left
                                        : right
                                ))
                                : null;
                            const lastMessageText = lastMessage
                                ? String(lastMessage.message || '[مرفق]').slice(0, 100)
                                : '';
                            const lastMessageTime = normalizeMessengerTimestamp(
                                conversation.updated_time || lastMessage?.created_time
                            );

                            database.transaction(() => {
                                let storedConversation = database.prepare(`
                                    SELECT id, tenant_id, linked_page_id, page_id, user_psid,
                                           last_message_time, user_name, user_profile_pic
                                    FROM fb_conversations
                                    WHERE linked_page_id = ? AND user_psid = ? AND tenant_id = ?
                                `).get(page.id, userPsid, tenantId);
                                if (!storedConversation) {
                                    const insertResult = database.prepare(`
                                        INSERT INTO fb_conversations (
                                            tenant_id, linked_page_id, page_id, user_psid,
                                            user_name, user_profile_pic, last_message,
                                            last_message_time, unread_count
                                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
                                    `).run(
                                        tenantId,
                                        page.id,
                                        page.page_id,
                                        userPsid,
                                        userName,
                                        userProfilePic,
                                        lastMessageText,
                                        lastMessageTime
                                    );
                                    storedConversation = {
                                        id: insertResult.lastInsertRowid,
                                        last_message_time: null,
                                    };
                                    totalConversations += 1;
                                } else {
                                    const existingTime = storedConversation.last_message_time
                                        ? getTimestampMs(storedConversation.last_message_time)
                                        : 0;
                                    const incomingTime = getTimestampMs(lastMessageTime);
                                    if (incomingTime > existingTime) {
                                        database.prepare(`
                                            UPDATE fb_conversations
                                            SET last_message = ?, last_message_time = ?,
                                                user_name = COALESCE(?, user_name),
                                                user_profile_pic = COALESCE(?, user_profile_pic),
                                                updated_at = datetime('now', 'localtime')
                                            WHERE id = ? AND tenant_id = ?
                                        `).run(
                                            lastMessageText,
                                            lastMessageTime,
                                            userName,
                                            userProfilePic,
                                            storedConversation.id,
                                            tenantId
                                        );
                                    } else if (userName || userProfilePic) {
                                        database.prepare(`
                                            UPDATE fb_conversations
                                            SET user_name = COALESCE(?, user_name),
                                                user_profile_pic = COALESCE(?, user_profile_pic),
                                                updated_at = datetime('now', 'localtime')
                                            WHERE id = ? AND tenant_id = ?
                                        `).run(
                                            userName,
                                            userProfilePic,
                                            storedConversation.id,
                                            tenantId
                                        );
                                    }
                                }

                                for (const message of messages) {
                                    const direction = String(message.from?.id) === String(page.page_id)
                                        ? 'outgoing'
                                        : 'incoming';
                                    const inserted = insertMessengerMessage(database, {
                                        conversationId: storedConversation.id,
                                        tenantId,
                                        mid: message.mid,
                                        direction,
                                        senderId: message.from?.id,
                                        senderName: message.from?.name,
                                        messageText: message.message || '',
                                        attachmentType: message.attachments?.data?.[0]?.type || null,
                                        attachmentUrl: message.attachments?.data?.[0]?.payload?.url || null,
                                        createdAt: message.created_time,
                                    });
                                    if (inserted.inserted) totalMessages += 1;
                                }
                            })();
                        }

                        const nextValue = result.data?.paging?.next;
                        const next = normalizeMetaNextUrl(nextValue, apiBase);
                        if (nextValue && !next) {
                            failedPages += 1;
                            break;
                        }
                        url = next;
                    }
                } catch (error) {
                    failedPages += 1;
                    console.error(`[TenantMessengerSync] Page ${page.page_id} sync failed:`, error);
                }
            }

            return res.json({
                success: failedPages === 0,
                synced_conversations: totalConversations,
                synced_messages: totalMessages,
                failed_pages: failedPages,
            });
        } catch (error) {
            console.error('[TenantMessengerSync] Sync error:', error);
            return res.status(500).json({ error: 'فشل مزامنة المحادثات' });
        }
    });

    return router;
}

export default createTenantMessengerSyncRouter;
