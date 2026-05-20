import db from '../db/database.js';
import { META_API_BASE } from '../config/index.js';
import { decryptIfEncrypted } from './encryption.js';
import eventBus from './eventBus.js';
import {
    BILLING_OPERATIONS,
    commit as commitBilling,
    release as releaseBilling,
    reserve as reserveBilling,
} from './billing.js';
import { insertMessengerMessage, normalizeMessengerTimestamp } from './messengerMessages.js';

const MAX_GENERIC_ELEMENTS = 10;
const MAX_QUICK_REPLIES = 13;

function parseJson(value, fallback = {}) {
    if (!value) return fallback;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

function serializeJson(value) {
    try {
        return JSON.stringify(value ?? {});
    } catch {
        return JSON.stringify({ unparseable: true });
    }
}

function safeText(value, fallback = '') {
    const text = String(value || '').trim();
    return text || fallback;
}

function isHttpUrl(value) {
    return /^https?:\/\//i.test(String(value || '').trim());
}

function trimForMeta(value, max) {
    const text = String(value || '').trim();
    return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

function recordBotEvent({
    tenantId,
    linkedPageId = null,
    conversationId = null,
    sessionId = null,
    eventType,
    direction = null,
    payload = null,
    status = 'info',
    errorMessage = null,
}) {
    try {
        db.prepare(`
            INSERT INTO bot_events (
                tenant_id, linked_page_id, conversation_id, session_id,
                event_type, direction, payload_json, status, error_message
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            tenantId,
            linkedPageId,
            conversationId,
            sessionId,
            eventType,
            direction,
            payload ? serializeJson(payload) : null,
            status,
            errorMessage
        );
    } catch (err) {
        console.error('[MessengerBot] Failed to record event:', err.message);
    }
}

function getOrCreateSession({ tenantId, linkedPageId, conversationId, userPsid }) {
    let session = db.prepare(`
        SELECT *
        FROM bot_sessions
        WHERE linked_page_id = ? AND user_psid = ?
        LIMIT 1
    `).get(linkedPageId, userPsid);

    if (!session) {
        const result = db.prepare(`
            INSERT INTO bot_sessions (
                tenant_id, linked_page_id, conversation_id, user_psid,
                status, last_user_message_at
            ) VALUES (?, ?, ?, ?, 'active', datetime('now', 'localtime'))
        `).run(tenantId, linkedPageId, conversationId || null, userPsid);

        session = db.prepare('SELECT * FROM bot_sessions WHERE id = ?').get(result.lastInsertRowid);
    } else {
        db.prepare(`
            UPDATE bot_sessions
            SET conversation_id = COALESCE(?, conversation_id),
                last_user_message_at = datetime('now', 'localtime'),
                updated_at = datetime('now', 'localtime')
            WHERE id = ?
        `).run(conversationId || null, session.id);
        session = db.prepare('SELECT * FROM bot_sessions WHERE id = ?').get(session.id);
    }

    return session;
}

function updateSession(sessionId, data = {}) {
    const allowed = {
        active_flow_id: Object.prototype.hasOwnProperty.call(data, 'active_flow_id') ? data.active_flow_id : undefined,
        current_node_key: Object.prototype.hasOwnProperty.call(data, 'current_node_key') ? data.current_node_key : undefined,
        status: Object.prototype.hasOwnProperty.call(data, 'status') ? data.status : undefined,
        context_json: Object.prototype.hasOwnProperty.call(data, 'context_json') ? serializeJson(data.context_json) : undefined,
        last_bot_message_at: Object.prototype.hasOwnProperty.call(data, 'last_bot_message_at') ? data.last_bot_message_at : undefined,
    };

    const fields = [];
    const values = [];
    for (const [field, value] of Object.entries(allowed)) {
        if (value !== undefined) {
            fields.push(`${field} = ?`);
            values.push(value);
        }
    }
    if (fields.length === 0) return db.prepare('SELECT * FROM bot_sessions WHERE id = ?').get(sessionId);

    fields.push("updated_at = datetime('now', 'localtime')");
    values.push(sessionId);
    db.prepare(`UPDATE bot_sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return db.prepare('SELECT * FROM bot_sessions WHERE id = ?').get(sessionId);
}

function getActiveFlows({ tenantId, linkedPageId, triggerType }) {
    return db.prepare(`
        SELECT f.*, n.id AS node_id, n.node_key, n.node_type, n.title, n.body, n.config_json
        FROM bot_flows f
        LEFT JOIN bot_flow_nodes n ON n.flow_id = f.id AND n.node_key = 'start'
        WHERE f.tenant_id = ?
          AND f.status = 'active'
          AND f.trigger_type = ?
          AND (f.linked_page_id IS NULL OR f.linked_page_id = ?)
        ORDER BY
          CASE WHEN f.linked_page_id = ? THEN 0 ELSE 1 END,
          f.priority ASC,
          f.id ASC
    `).all(tenantId, triggerType, linkedPageId, linkedPageId);
}

function splitKeywords(value) {
    return String(value || '')
        .split(/[\n,،]+/)
        .map(item => item.trim().toLowerCase())
        .filter(Boolean);
}

function findKeywordFlow({ tenantId, linkedPageId, messageText }) {
    const text = String(messageText || '').toLowerCase();
    if (!text) return null;
    const flows = getActiveFlows({ tenantId, linkedPageId, triggerType: 'keyword' });
    return flows.find(flow => splitKeywords(flow.trigger_value).some(keyword => text.includes(keyword))) || null;
}

function findExactTriggerFlow({ tenantId, linkedPageId, triggerType, triggerValue = null }) {
    const flows = getActiveFlows({ tenantId, linkedPageId, triggerType });
    if (!triggerValue) return flows[0] || null;
    const normalized = String(triggerValue).trim().toLowerCase();
    return flows.find(flow => String(flow.trigger_value || '').trim().toLowerCase() === normalized) || null;
}

function getFlowNode(flowId, nodeKey = 'start') {
    return db.prepare(`
        SELECT f.*, n.id AS node_id, n.node_key, n.node_type, n.title, n.body, n.config_json
        FROM bot_flows f
        JOIN bot_flow_nodes n ON n.flow_id = f.id
        WHERE f.id = ? AND n.node_key = ?
        LIMIT 1
    `).get(flowId, nodeKey);
}

function attachProductImages(products = []) {
    const rows = Array.isArray(products) ? products : [products].filter(Boolean);
    if (!rows.length) return Array.isArray(products) ? [] : null;

    const placeholders = rows.map(() => '?').join(', ');
    const images = db.prepare(`
        SELECT product_id, image_url, alt_text, sort_order, is_primary
        FROM bot_product_images
        WHERE product_id IN (${placeholders})
        ORDER BY is_primary DESC, sort_order ASC, id ASC
    `).all(...rows.map(product => product.id));
    const byProduct = new Map();
    for (const image of images) {
        if (!byProduct.has(image.product_id)) byProduct.set(image.product_id, []);
        byProduct.get(image.product_id).push(image);
    }

    const enriched = rows.map(product => {
        const productImages = byProduct.get(product.id) || [];
        return {
            ...product,
            images: productImages,
            image_url: productImages[0]?.image_url || product.image_url || null,
        };
    });

    return Array.isArray(products) ? enriched : enriched[0];
}

function searchActiveProducts({ tenantId, query, limit = MAX_GENERIC_ELEMENTS }) {
    const text = String(query || '').trim();
    if (text.length < 2) return [];
    const like = `%${text}%`;
    const products = db.prepare(`
        SELECT *
        FROM bot_products
        WHERE tenant_id = ?
          AND is_active = 1
          AND availability = 'available'
          AND (name LIKE ? OR sku LIKE ? OR description LIKE ? OR category LIKE ?)
        ORDER BY
          CASE WHEN name LIKE ? THEN 0 ELSE 1 END,
          updated_at DESC,
          id DESC
        LIMIT ?
    `).all(tenantId, like, like, like, like, like, Math.min(Math.max(Number(limit) || MAX_GENERIC_ELEMENTS, 1), MAX_GENERIC_ELEMENTS));
    return attachProductImages(products);
}

function listActiveProducts({ tenantId, category = null, limit = MAX_GENERIC_ELEMENTS }) {
    const params = [tenantId];
    let categoryClause = '';
    if (category) {
        categoryClause = 'AND LOWER(category) = LOWER(?)';
        params.push(category);
    }
    params.push(Math.min(Math.max(Number(limit) || MAX_GENERIC_ELEMENTS, 1), MAX_GENERIC_ELEMENTS));

    const products = db.prepare(`
        SELECT *
        FROM bot_products
        WHERE tenant_id = ?
          AND is_active = 1
          AND availability = 'available'
          ${categoryClause}
        ORDER BY updated_at DESC, id DESC
        LIMIT ?
    `).all(...params);
    return attachProductImages(products);
}

function getProduct(tenantId, productId) {
    const product = db.prepare(`
        SELECT *
        FROM bot_products
        WHERE id = ? AND tenant_id = ? AND is_active = 1
        LIMIT 1
    `).get(productId, tenantId);
    return attachProductImages(product);
}

function moneyText(product) {
    const price = Number(product.price || 0);
    if (!price) return product.category || '';
    return `${price.toLocaleString('ar-LY')} ${product.currency || 'LYD'}`;
}

function flag(config = {}, key, fallback = true) {
    if (!Object.prototype.hasOwnProperty.call(config, key)) return fallback;
    return config[key] !== false && config[key] !== 0 && config[key] !== '0';
}

function configLabel(config = {}, key, fallback) {
    return trimForMeta(config[key] || fallback, 20);
}

function quickRepliesFromConfig(config = {}) {
    const replies = Array.isArray(config.quick_replies) ? config.quick_replies : [];
    const mapped = replies
        .filter(reply => reply?.title)
        .slice(0, MAX_QUICK_REPLIES)
        .map(reply => buildQuickReply(reply));
    return withMainMenuQuickReply(mapped, config);
}

function buildQuickReply(item = {}) {
    const quickReply = {
        content_type: 'text',
        title: trimForMeta(item.title, 20),
        payload: trimForMeta(resolveConfiguredPayload(item), 1000),
    };
    if (isHttpUrl(item.image_url)) quickReply.image_url = item.image_url;
    return quickReply;
}

function buildCardButton(item = {}, config = {}) {
    return {
        type: 'postback',
        title: trimForMeta(item.action_label || config.card_action_label || 'اختيار', 20),
        payload: trimForMeta(resolveConfiguredPayload(item), 1000),
    };
}

function defaultReplyItems(config = {}) {
    const items = [];
    if (flag(config, 'include_products_reply', false)) {
        items.push({
            title: configLabel(config, 'products_reply_label', 'منتجات أخرى'),
            action: 'products',
        });
    }
    if (flag(config, 'include_handoff_reply', false)) {
        items.push({
            title: configLabel(config, 'handoff_reply_label', 'موظف بشري'),
            action: 'handoff',
        });
    }
    if (flag(config, 'include_menu', true)) {
        items.push({
            title: configLabel(config, 'menu_label', 'القائمة الرئيسية'),
            action: 'menu',
        });
    }
    return items;
}

function buildCardReplyMessage({ body, items = [], config = {} }) {
    const configuredItems = [...items, ...defaultReplyItems(config)]
        .filter(item => item?.title)
        .slice(0, MAX_GENERIC_ELEMENTS);
    if (!configuredItems.length) {
        return buildTextMessage(body || 'اختر أحد الخيارات.');
    }

    return {
        attachment: {
            type: 'template',
            payload: {
                template_type: 'generic',
                elements: configuredItems.map(item => ({
                    title: trimForMeta(item.title, 80),
                    subtitle: trimForMeta(item.subtitle || item.description || body || '', 80),
                    image_url: isHttpUrl(item.image_url) ? item.image_url : undefined,
                    buttons: [buildCardButton(item, config)],
                })),
            },
        },
    };
}

function resolveConfiguredPayload(item = {}) {
    if (item.payload) return item.payload;
    if (item.action === 'products') return item.category ? `BOT:PRODUCTS:${item.category}` : 'BOT:PRODUCTS';
    if (item.action === 'node' && item.node_key) return `BOT:NODE:${item.node_key}`;
    if (item.action === 'handoff') return 'BOT:HANDOFF';
    if (item.action === 'menu') return 'BOT:MENU';
    if (item.action === 'custom' && item.custom_payload) return item.custom_payload;
    if (item.node_key) return `BOT:NODE:${item.node_key}`;
    return `BOT:SERVICE:${item.title || 'option'}`;
}

function withMainMenuQuickReply(replies = [], config = {}) {
    if (config.include_menu === false) return replies.slice(0, MAX_QUICK_REPLIES);
    const hasMenu = replies.some(reply => reply.payload === 'BOT:MENU');
    const next = hasMenu ? replies : [
        ...replies,
        { content_type: 'text', title: configLabel(config, 'menu_label', 'القائمة الرئيسية'), payload: 'BOT:MENU' },
    ];
    return next.slice(0, MAX_QUICK_REPLIES);
}

function buildDefaultQuickReplies(config = {}, defaults = {}) {
    const replies = [];
    const includeProducts = flag(config, 'include_products_reply', Boolean(defaults.includeProducts));
    const includeHandoff = flag(config, 'include_handoff_reply', Boolean(defaults.includeHandoff));

    if (includeProducts) {
        replies.push({
            content_type: 'text',
            title: configLabel(config, 'products_reply_label', 'منتجات أخرى'),
            payload: 'BOT:PRODUCTS',
        });
    }
    if (includeHandoff) {
        replies.push({
            content_type: 'text',
            title: configLabel(config, 'handoff_reply_label', 'موظف بشري'),
            payload: 'BOT:HANDOFF',
        });
    }
    return withMainMenuQuickReply(replies, config);
}

function serviceItemsFromConfig(config = {}) {
    return Array.isArray(config.items) ? config.items : [];
}

function buildServiceQuickReplies(config = {}) {
    const items = serviceItemsFromConfig(config);
    const replies = items
        .filter(item => item?.title)
        .slice(0, MAX_QUICK_REPLIES - 3)
        .map(item => buildQuickReply(item));

    if (flag(config, 'include_products_reply', true)) {
        replies.push({ content_type: 'text', title: configLabel(config, 'products_reply_label', 'المنتجات'), payload: 'BOT:PRODUCTS' });
    }
    if (flag(config, 'include_handoff_reply', true)) {
        replies.push({ content_type: 'text', title: configLabel(config, 'handoff_reply_label', 'موظف بشري'), payload: 'BOT:HANDOFF' });
    }
    return withMainMenuQuickReply(replies, config);
}

function buildReplyMessage({ body, config = {}, sourceKey = 'quick_replies' }) {
    const items = Array.isArray(config[sourceKey]) ? config[sourceKey] : [];
    if (config.reply_display === 'cards') {
        return buildCardReplyMessage({ body, items, config });
    }
    return buildTextMessage(body, quickRepliesFromConfig(config));
}

function buildServiceMessage({ body, config = {} }) {
    if (config.reply_display === 'cards') {
        return buildCardReplyMessage({ body, items: serviceItemsFromConfig(config), config });
    }
    return buildTextMessage(body, buildServiceQuickReplies(config));
}

function buildProductCards(products, config = {}) {
    return products.slice(0, MAX_GENERIC_ELEMENTS).map(product => {
        const buttons = [];
        if (flag(config, 'card_show_details_button', true)) {
            buttons.push({
                type: 'postback',
                title: configLabel(config, 'card_details_label', 'تفاصيل'),
                payload: `BOT:PRODUCT:${product.id}`,
            });
        }
        if (flag(config, 'card_show_inquiry_button', true)) {
            buttons.push({
                type: 'postback',
                title: configLabel(config, 'card_inquiry_label', 'استفسار'),
                payload: `BOT:HANDOFF:PRODUCT:${product.id}`,
            });
        }

        if (flag(config, 'card_show_link_button', true) && isHttpUrl(product.product_url)) {
            buttons.push({
                type: 'web_url',
                title: configLabel(config, 'card_link_label', 'فتح الرابط'),
                url: product.product_url,
            });
        }

        const subtitleParts = [];
        if (flag(config, 'card_show_price', true)) subtitleParts.push(moneyText(product));
        if (flag(config, 'card_show_category', false)) subtitleParts.push(product.category);
        if (flag(config, 'card_show_sku', false)) subtitleParts.push(product.sku);
        if (flag(config, 'card_show_description', true)) subtitleParts.push(product.description);

        return {
            title: trimForMeta(product.name, 80),
            subtitle: trimForMeta(subtitleParts.filter(Boolean).join(' - '), 80),
            image_url: flag(config, 'card_show_image', true) && isHttpUrl(product.image_url) ? product.image_url : undefined,
            default_action: flag(config, 'card_show_link_button', true) && isHttpUrl(product.product_url)
                ? { type: 'web_url', url: product.product_url, webview_height_ratio: 'full' }
                : undefined,
            buttons: buttons.slice(0, 3),
        };
    });
}

function buildTextMessage(text, quickReplies = []) {
    const message = { text: trimForMeta(text, 2000) };
    if (quickReplies.length > 0) message.quick_replies = quickReplies;
    return message;
}

function buildProductListMessage({ products, emptyText, config = {} }) {
    if (!products.length) {
        return buildTextMessage(emptyText || 'لا توجد منتجات متاحة حاليا.', buildDefaultQuickReplies(config, {
            includeHandoff: true,
        }));
    }

    return {
        attachment: {
            type: 'template',
            payload: {
                template_type: 'generic',
                elements: buildProductCards(products, config),
            },
        },
        quick_replies: buildDefaultQuickReplies(config, {
            includeHandoff: true,
        }),
    };
}

function buildProductDetailMessage(product) {
    if (!product) {
        return buildTextMessage('لم يتم العثور على هذا المنتج أو لم يعد متاحا.', [
            { content_type: 'text', title: 'عرض المنتجات', payload: 'BOT:PRODUCTS' },
            { content_type: 'text', title: 'موظف بشري', payload: 'BOT:HANDOFF' },
        ]);
    }

    const images = (product.images || [])
        .map(image => image.image_url)
        .filter(isHttpUrl)
        .slice(0, MAX_GENERIC_ELEMENTS);
    const body = [
        product.name,
        moneyText(product),
        product.description,
        product.product_url && isHttpUrl(product.product_url) ? product.product_url : null,
    ].filter(Boolean).join('\n');

    if (images.length > 0) {
        return {
            attachment: {
                type: 'template',
                payload: {
                    template_type: 'generic',
                    elements: images.map((imageUrl, index) => {
                        const buttons = [
                            {
                                type: 'postback',
                                title: 'استفسار',
                                payload: `BOT:HANDOFF:PRODUCT:${product.id}`,
                            },
                        ];
                        if (isHttpUrl(product.product_url)) {
                            buttons.push({
                                type: 'web_url',
                                title: 'فتح الرابط',
                                url: product.product_url,
                            });
                        }
                        return {
                            title: trimForMeta(index === 0 ? product.name : `${product.name} - صورة ${index + 1}`, 80),
                            subtitle: trimForMeta(index === 0
                                ? [moneyText(product), product.description].filter(Boolean).join(' - ')
                                : `صورة ${index + 1} من ${images.length}`, 80),
                            image_url: imageUrl,
                            buttons: buttons.slice(0, 3),
                        };
                    }),
                },
            },
            quick_replies: [
                { content_type: 'text', title: 'القائمة الرئيسية', payload: 'BOT:MENU' },
                { content_type: 'text', title: 'منتجات أخرى', payload: 'BOT:PRODUCTS' },
                { content_type: 'text', title: 'موظف بشري', payload: `BOT:HANDOFF:PRODUCT:${product.id}` },
            ],
        };
    }

    return buildTextMessage(body, [
        { content_type: 'text', title: 'القائمة الرئيسية', payload: 'BOT:MENU' },
        { content_type: 'text', title: 'منتجات أخرى', payload: 'BOT:PRODUCTS' },
        { content_type: 'text', title: 'استفسار', payload: `BOT:HANDOFF:PRODUCT:${product.id}` },
    ]);
}

async function sendBotMessage({ linkedPage, conversation, session, message, previewText, metadata = {} }) {
    const accessToken = decryptIfEncrypted(linkedPage.page_access_token_encrypted);
    if (!accessToken) {
        throw new Error('رمز صفحة Messenger غير متوفر');
    }

    let billingReservation = null;
    try {
        billingReservation = reserveBilling({
            tenantId: conversation.tenant_id,
            operationKey: BILLING_OPERATIONS.MESSENGER_BOT_REPLY,
            quantity: 1,
            referenceType: 'messenger_bot_message',
            metadata: {
                linked_page_id: linkedPage.id,
                conversation_id: conversation.id,
                user_psid: conversation.user_psid,
                bot_session_id: session?.id || null,
                ...metadata,
            },
        });

        const response = await fetch(`${META_API_BASE}/${linkedPage.page_id}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                recipient: { id: conversation.user_psid },
                messaging_type: 'RESPONSE',
                message,
            }),
        });
        const data = await response.json();

        if (!response.ok || data.error) {
            releaseBilling(billingReservation, data.error?.message || 'Meta Messenger bot reply failed');
            recordBotEvent({
                tenantId: conversation.tenant_id,
                linkedPageId: linkedPage.id,
                conversationId: conversation.id,
                sessionId: session?.id || null,
                eventType: 'send_failed',
                direction: 'outgoing',
                payload: { message, meta: data.error || data },
                status: 'error',
                errorMessage: data.error?.message || 'Meta send failed',
            });
            throw new Error(data.error?.message || 'فشل إرسال رد البوت');
        }

        const mid = data.message_id;
        commitBilling(billingReservation, {
            referenceId: mid,
            description: 'خصم رد Messenger Bot',
        });

        const createdAt = normalizeMessengerTimestamp();
        const messageText = previewText || message.text || '[Messenger Bot]';
        insertMessengerMessage(db, {
            conversationId: conversation.id,
            tenantId: conversation.tenant_id,
            mid,
            direction: 'outgoing',
            senderId: linkedPage.page_id,
            senderName: linkedPage.page_name,
            messageText,
            createdAt,
        });

        db.prepare(`
            UPDATE fb_conversations
            SET last_message = ?, last_message_time = ?, updated_at = datetime('now', 'localtime')
            WHERE id = ?
        `).run(messageText.substring(0, 100), createdAt, conversation.id);

        if (session?.id) {
            updateSession(session.id, { last_bot_message_at: createdAt });
        }

        recordBotEvent({
            tenantId: conversation.tenant_id,
            linkedPageId: linkedPage.id,
            conversationId: conversation.id,
            sessionId: session?.id || null,
            eventType: 'send_success',
            direction: 'outgoing',
            payload: { mid, preview: messageText, metadata },
            status: 'success',
        });

        const eventPayload = {
            tenant_id: conversation.tenant_id,
            page_id: linkedPage.page_id,
            conversation_id: conversation.id,
            direction: 'outgoing',
            sender_id: linkedPage.page_id,
            sender_name: linkedPage.page_name,
            message: messageText,
            bot: true,
        };
        eventBus.broadcast('admin', 'fb_message:new', eventPayload);
        eventBus.broadcast(`tenant:${conversation.tenant_id}`, 'fb_message:new', eventPayload);

        return { mid, message_text: messageText };
    } catch (error) {
        if (billingReservation) {
            try {
                releaseBilling(billingReservation, error.message);
            } catch (releaseError) {
                console.error('[MessengerBot] Billing release error:', releaseError.message);
            }
        }
        throw error;
    }
}

async function renderNode({ linkedPage, conversation, session, node, context = {} }) {
    const config = parseJson(node.config_json, {});
    const nodeType = node.node_type || 'text';
    const body = safeText(node.body, 'كيف يمكنني مساعدتك؟');

    updateSession(session.id, {
        current_node_key: node.node_key || 'start',
        context_json: { ...parseJson(session.context_json, {}), ...context },
    });

    if (nodeType === 'product_list') {
        const category = config.category || context.category || null;
        const products = listActiveProducts({
            tenantId: conversation.tenant_id,
            category,
            limit: config.limit || MAX_GENERIC_ELEMENTS,
        });
        const message = buildProductListMessage({ products, emptyText: config.empty_text, config });
        return sendBotMessage({
            linkedPage,
            conversation,
            session,
            message,
            previewText: products.length ? `عرض ${products.length} منتجات` : (config.empty_text || 'لا توجد منتجات متاحة'),
            metadata: { node_type: nodeType, category, products_count: products.length },
        });
    }

    if (nodeType === 'product_detail') {
        const product = getProduct(conversation.tenant_id, config.product_id || context.product_id);
        return sendBotMessage({
            linkedPage,
            conversation,
            session,
            message: buildProductDetailMessage(product),
            previewText: product ? `تفاصيل المنتج: ${product.name}` : 'المنتج غير متاح',
            metadata: { node_type: nodeType, product_id: product?.id || context.product_id || null },
        });
    }

    if (nodeType === 'service_menu') {
        return sendBotMessage({
            linkedPage,
            conversation,
            session,
            message: buildServiceMessage({ body, config }),
            previewText: body,
            metadata: { node_type: nodeType },
        });
    }

    if (nodeType === 'quick_replies') {
        return sendBotMessage({
            linkedPage,
            conversation,
            session,
            message: buildReplyMessage({ body, config }),
            previewText: body,
            metadata: { node_type: nodeType },
        });
    }

    if (nodeType === 'handoff') {
        updateSession(session.id, { status: 'handoff' });
        recordBotEvent({
            tenantId: conversation.tenant_id,
            linkedPageId: linkedPage.id,
            conversationId: conversation.id,
            sessionId: session.id,
            eventType: 'handoff',
            direction: 'outgoing',
            payload: { node_key: node.node_key || null },
            status: 'success',
        });
        return sendBotMessage({
            linkedPage,
            conversation,
            session,
            message: buildTextMessage(body || 'تم تحويلك إلى أحد الموظفين.'),
            previewText: body || 'تم تحويلك إلى أحد الموظفين.',
            metadata: { node_type: nodeType, handoff: true },
        });
    }

    return sendBotMessage({
        linkedPage,
        conversation,
        session,
        message: buildReplyMessage({ body, config }),
        previewText: body,
        metadata: { node_type: nodeType },
    });
}

async function renderFlow({ flow, linkedPage, conversation, session, context = {} }) {
    const node = getFlowNode(flow.id, flow.node_key || 'start') || flow;
    updateSession(session.id, {
        active_flow_id: flow.id,
        current_node_key: node.node_key || 'start',
        status: 'active',
    });

    recordBotEvent({
        tenantId: conversation.tenant_id,
        linkedPageId: linkedPage.id,
        conversationId: conversation.id,
        sessionId: session.id,
        eventType: 'flow_matched',
        direction: 'incoming',
        payload: {
            flow_id: flow.id,
            flow_name: flow.name,
            trigger_type: flow.trigger_type,
            trigger_value: flow.trigger_value,
            reason: context.reason || flow.trigger_type,
        },
        status: 'success',
    });

    return renderNode({ linkedPage, conversation, session, node, context });
}

async function handleBotPayload({ payload, linkedPage, conversation, session }) {
    const value = String(payload || '').trim();

    if (value.startsWith('BOT:HANDOFF')) {
        const productId = value.split(':')[3] || null;
        const product = productId ? getProduct(conversation.tenant_id, productId) : null;
        updateSession(session.id, {
            status: 'handoff',
            context_json: { ...parseJson(session.context_json, {}), handoff_product_id: productId },
        });
        recordBotEvent({
            tenantId: conversation.tenant_id,
            linkedPageId: linkedPage.id,
            conversationId: conversation.id,
            sessionId: session.id,
            eventType: 'handoff',
            direction: 'incoming',
            payload: { payload: value, product_id: productId },
            status: 'success',
        });
        return sendBotMessage({
            linkedPage,
            conversation,
            session,
            message: buildTextMessage(product
                ? `تم تحويل استفسارك عن "${product.name}" إلى أحد الموظفين.`
                : 'تم تحويلك إلى أحد الموظفين.'),
            previewText: 'تحويل إلى موظف بشري',
            metadata: { payload: value, handoff: true, product_id: productId },
        });
    }

    if (value.startsWith('BOT:PRODUCT:')) {
        const productId = Number(value.split(':')[2]);
        return renderNode({
            linkedPage,
            conversation,
            session,
            node: {
                node_type: 'product_detail',
                node_key: 'product_detail',
                config_json: serializeJson({ product_id: productId }),
            },
            context: { product_id: productId },
        });
    }

    if (value.startsWith('BOT:PRODUCTS')) {
        const parts = value.split(':');
        const category = parts[2] || null;
        return renderNode({
            linkedPage,
            conversation,
            session,
            node: {
                node_type: 'product_list',
                node_key: 'products',
                config_json: serializeJson({ category }),
            },
            context: { category },
        });
    }

    if (value.startsWith('BOT:FLOW:')) {
        const parts = value.split(':');
        const flowId = Number(parts[2]);
        const nodeKey = parts[4] || 'start';
        const flow = db.prepare(`
            SELECT *
            FROM bot_flows
            WHERE id = ? AND tenant_id = ? AND status = 'active'
        `).get(flowId, conversation.tenant_id);
        const node = flow ? getFlowNode(flow.id, nodeKey) : null;
        if (flow && node) {
            return renderFlow({ flow: { ...flow, node_key: nodeKey }, linkedPage, conversation, session });
        }
    }

    if (value.startsWith('BOT:NODE:')) {
        const nodeKey = value.split(':')[2] || 'start';
        const flowId = session.active_flow_id;
        const flow = flowId ? db.prepare(`
            SELECT *
            FROM bot_flows
            WHERE id = ? AND tenant_id = ? AND status = 'active'
        `).get(flowId, conversation.tenant_id) : null;
        const node = flow ? getFlowNode(flow.id, nodeKey) : null;
        if (flow && node) {
            return renderFlow({
                flow: { ...flow, node_key: nodeKey },
                linkedPage,
                conversation,
                session,
                context: { reason: 'node_navigation', node_key: nodeKey },
            });
        }
    }

    if (value === 'BOT:MENU') {
        const flow = findExactTriggerFlow({
            tenantId: conversation.tenant_id,
            linkedPageId: linkedPage.id,
            triggerType: 'menu',
        }) || findExactTriggerFlow({
            tenantId: conversation.tenant_id,
            linkedPageId: linkedPage.id,
            triggerType: 'welcome',
        });
        if (flow) return renderFlow({ flow, linkedPage, conversation, session });
    }

    const postbackFlow = findExactTriggerFlow({
        tenantId: conversation.tenant_id,
        linkedPageId: linkedPage.id,
        triggerType: 'postback',
        triggerValue: value,
    });
    if (postbackFlow) return renderFlow({ flow: postbackFlow, linkedPage, conversation, session });

    return null;
}

export async function processMessengerBotEvent({
    linkedPage,
    conversation,
    senderId,
    messageText = '',
    quickReplyPayload = null,
    postbackPayload = null,
    isFirstMessage = false,
} = {}) {
    if (!linkedPage || !conversation || !senderId) {
        return { handled: false, reason: 'missing_context' };
    }

    const session = getOrCreateSession({
        tenantId: linkedPage.tenant_id,
        linkedPageId: linkedPage.id,
        conversationId: conversation.id,
        userPsid: senderId,
    });

    if (session.status === 'handoff' || session.status === 'closed') {
        recordBotEvent({
            tenantId: linkedPage.tenant_id,
            linkedPageId: linkedPage.id,
            conversationId: conversation.id,
            sessionId: session.id,
            eventType: 'skipped',
            direction: 'incoming',
            payload: { reason: session.status, message_text: messageText, postback_payload: postbackPayload },
            status: 'info',
        });
        return { handled: true, reason: session.status };
    }

    const payload = quickReplyPayload || postbackPayload;
    try {
        if (payload) {
            const payloadResult = await handleBotPayload({ payload, linkedPage, conversation, session });
            if (payloadResult) return { handled: true, reason: 'payload', result: payloadResult };
        }

        let flow = null;
        if (isFirstMessage) {
            flow = findExactTriggerFlow({
                tenantId: linkedPage.tenant_id,
                linkedPageId: linkedPage.id,
                triggerType: 'welcome',
            });
        }

        let reason = flow ? 'welcome' : null;
        if (!flow) {
            flow = findKeywordFlow({
                tenantId: linkedPage.tenant_id,
                linkedPageId: linkedPage.id,
                messageText,
            });
            if (flow) reason = 'keyword_matched';
        }

        if (!flow) {
            const products = searchActiveProducts({
                tenantId: linkedPage.tenant_id,
                query: messageText,
                limit: MAX_GENERIC_ELEMENTS,
            });
            if (products.length > 0) {
                recordBotEvent({
                    tenantId: linkedPage.tenant_id,
                    linkedPageId: linkedPage.id,
                    conversationId: conversation.id,
                    sessionId: session.id,
                    eventType: 'product_search',
                    direction: 'incoming',
                    payload: { query: messageText, results: products.length },
                    status: 'success',
                });
                const result = await sendBotMessage({
                    linkedPage,
                    conversation,
                    session,
                    message: buildProductListMessage({ products }),
                    previewText: `نتائج بحث المنتجات: ${products.length}`,
                    metadata: { node_type: 'product_search', query: messageText, products_count: products.length },
                });
                return { handled: true, reason: 'product_search', result };
            }
        }

        if (!flow) {
            flow = findExactTriggerFlow({
                tenantId: linkedPage.tenant_id,
                linkedPageId: linkedPage.id,
                triggerType: 'fallback',
            });
            if (flow) reason = 'fallback';
        }

        if (!flow) {
            return { handled: false, reason: 'no_flow' };
        }

        const result = await renderFlow({ flow, linkedPage, conversation, session, context: { reason } });
        return { handled: true, reason: flow.trigger_type, result };
    } catch (error) {
        recordBotEvent({
            tenantId: linkedPage.tenant_id,
            linkedPageId: linkedPage.id,
            conversationId: conversation.id,
            sessionId: session.id,
            eventType: 'error',
            direction: 'incoming',
            payload: { message_text: messageText, quick_reply_payload: quickReplyPayload, postback_payload: postbackPayload },
            status: 'error',
            errorMessage: error.message,
        });
        console.error('[MessengerBot] Processing failed:', error.message);
        return { handled: true, reason: 'error', error: error.message };
    }
}

export function markBotHandoffForConversation({
    tenantId = null,
    linkedPageId = null,
    conversationId = null,
    userPsid = null,
    reason = 'manual_reply',
    actor = 'staff',
} = {}) {
    const conversation = conversationId
        ? db.prepare('SELECT * FROM fb_conversations WHERE id = ?').get(conversationId)
        : db.prepare(`
            SELECT *
            FROM fb_conversations
            WHERE linked_page_id = ? AND user_psid = ?
            LIMIT 1
        `).get(linkedPageId, userPsid);

    const resolvedTenantId = tenantId || conversation?.tenant_id;
    const resolvedLinkedPageId = linkedPageId || conversation?.linked_page_id;
    const resolvedConversationId = conversationId || conversation?.id || null;
    const resolvedUserPsid = userPsid || conversation?.user_psid;

    if (!resolvedTenantId || !resolvedLinkedPageId || !resolvedUserPsid) {
        return null;
    }

    let session = db.prepare(`
        SELECT *
        FROM bot_sessions
        WHERE linked_page_id = ? AND user_psid = ?
        LIMIT 1
    `).get(resolvedLinkedPageId, resolvedUserPsid);

    if (session) {
        session = updateSession(session.id, {
            status: 'handoff',
            context_json: {
                ...parseJson(session.context_json, {}),
                handoff_reason: reason,
                handoff_actor: actor,
            },
        });
        if (resolvedConversationId && session.conversation_id !== resolvedConversationId) {
            db.prepare(`
                UPDATE bot_sessions
                SET conversation_id = ?, updated_at = datetime('now', 'localtime')
                WHERE id = ?
            `).run(resolvedConversationId, session.id);
            session = db.prepare('SELECT * FROM bot_sessions WHERE id = ?').get(session.id);
        }
    } else {
        const result = db.prepare(`
            INSERT INTO bot_sessions (
                tenant_id, linked_page_id, conversation_id, user_psid,
                status, context_json
            ) VALUES (?, ?, ?, ?, 'handoff', ?)
        `).run(
            resolvedTenantId,
            resolvedLinkedPageId,
            resolvedConversationId,
            resolvedUserPsid,
            serializeJson({ handoff_reason: reason, handoff_actor: actor })
        );
        session = db.prepare('SELECT * FROM bot_sessions WHERE id = ?').get(result.lastInsertRowid);
    }

    recordBotEvent({
        tenantId: resolvedTenantId,
        linkedPageId: resolvedLinkedPageId,
        conversationId: resolvedConversationId,
        sessionId: session.id,
        eventType: 'handoff',
        direction: 'outgoing',
        payload: { reason, actor },
        status: 'success',
    });

    return session;
}

export function buildNodePreview(node = {}, tenantId) {
    const config = parseJson(node.config_json || node.config, {});
    const nodeType = node.node_type || 'text';
    if (nodeType === 'product_list') {
        const products = listActiveProducts({
            tenantId,
            category: config.category || null,
            limit: config.limit || MAX_GENERIC_ELEMENTS,
        });
        return {
            type: 'product_list',
            products,
            message: products.length ? `سيتم عرض ${products.length} منتجات.` : (config.empty_text || 'لا توجد منتجات متاحة حاليا.'),
        };
    }
    return {
        type: nodeType,
        message: node.body || '',
        config,
    };
}
