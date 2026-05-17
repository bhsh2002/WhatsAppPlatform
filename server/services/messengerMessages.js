import crypto from 'crypto';

const APP_TIME_ZONE = process.env.TZ || 'Africa/Tripoli';

const SQLITE_ISO_NORMALIZED_CREATED_AT = `
    CASE
        WHEN m.created_at GLOB '????-??-??T??:??:??*'
            THEN datetime(substr(replace(m.created_at, 'T', ' '), 1, 19), 'localtime')
        ELSE m.created_at
    END
`;

const MESSENGER_FALLBACK_MID_EXPR = `
    CASE
        WHEN NULLIF(m.mid, '') IS NULL THEN 1
        WHEN m.mid GLOB 'fb_fallback_*' THEN 1
        WHEN m.mid GLOB CAST(m.conversation_id AS TEXT) || '_*' THEN 1
        ELSE 0
    END
`;

const MESSENGER_MESSAGE_CTE = `
    WITH normalized AS (
        SELECT
            m.*,
            ${SQLITE_ISO_NORMALIZED_CREATED_AT} AS normalized_created_at,
            ${MESSENGER_FALLBACK_MID_EXPR} AS is_fallback_mid,
            m.conversation_id || '|' ||
                COALESCE(m.direction, '') || '|' ||
                COALESCE(m.sender_id, '') || '|' ||
                COALESCE(${SQLITE_ISO_NORMALIZED_CREATED_AT}, '') || '|' ||
                COALESCE(m.message_text, '') || '|' ||
                COALESCE(m.attachment_type, '') || '|' ||
                COALESCE(m.attachment_url, '') || '|' ||
                COALESCE(m.sticker_url, '') AS fingerprint_key
        FROM fb_messages m
        WHERE __WHERE__
    ),
    ranked AS (
        SELECT
            normalized.*,
            SUM(CASE WHEN is_fallback_mid = 0 THEN 1 ELSE 0 END)
                OVER (PARTITION BY fingerprint_key) AS real_mid_count,
            ROW_NUMBER()
                OVER (PARTITION BY fingerprint_key, is_fallback_mid ORDER BY id ASC) AS duplicate_rank
        FROM normalized
    )
`;

function parseTimestamp(value) {
    if (!value) return new Date();

    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? new Date() : value;
    }

    if (typeof value === 'number') {
        const timestamp = value < 1e12 ? value * 1000 : value;
        const date = new Date(timestamp);
        return Number.isNaN(date.getTime()) ? new Date() : date;
    }

    const raw = String(value).trim();
    if (!raw) return new Date();

    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? new Date() : date;
}

function formatDatePart(parts, type) {
    return parts.find(part => part.type === type)?.value || '00';
}

export function toSqliteLocalDateTime(value = new Date()) {
    const date = parseTimestamp(value);
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: APP_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).formatToParts(date);

    return [
        `${formatDatePart(parts, 'year')}-${formatDatePart(parts, 'month')}-${formatDatePart(parts, 'day')}`,
        `${formatDatePart(parts, 'hour')}:${formatDatePart(parts, 'minute')}:${formatDatePart(parts, 'second')}`,
    ].join(' ');
}

export function getTimestampMs(value) {
    return parseTimestamp(value).getTime();
}

export function normalizeMessengerTimestamp(value) {
    return toSqliteLocalDateTime(value);
}

export function buildMessengerMid({
    mid,
    conversationId,
    senderId,
    createdAt,
    messageText,
    attachmentType,
    attachmentUrl,
    stickerUrl,
}) {
    if (mid && String(mid).trim()) return String(mid).trim();

    const fingerprint = [
        conversationId || '',
        senderId || '',
        createdAt || '',
        messageText || '',
        attachmentType || '',
        attachmentUrl || '',
        stickerUrl || '',
    ].join('|');

    return `fb_fallback_${crypto.createHash('sha256').update(fingerprint).digest('hex').slice(0, 32)}`;
}

export function insertMessengerMessage(db, {
    conversationId,
    tenantId,
    mid,
    direction = 'incoming',
    senderId = null,
    senderName = null,
    messageText = null,
    attachmentType = null,
    attachmentUrl = null,
    stickerUrl = null,
    isRead = 0,
    createdAt = new Date(),
}) {
    const normalizedCreatedAt = normalizeMessengerTimestamp(createdAt);
    const messageMid = buildMessengerMid({
        mid,
        conversationId,
        senderId,
        createdAt: normalizedCreatedAt,
        messageText,
        attachmentType,
        attachmentUrl,
        stickerUrl,
    });

    const result = db.prepare(`
        INSERT OR IGNORE INTO fb_messages (
            conversation_id, tenant_id, mid, direction, sender_id, sender_name,
            message_text, attachment_type, attachment_url, sticker_url, is_read, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        conversationId,
        tenantId,
        messageMid,
        direction,
        senderId,
        senderName,
        messageText,
        attachmentType,
        attachmentUrl,
        stickerUrl,
        isRead,
        normalizedCreatedAt
    );

    return {
        inserted: result.changes > 0,
        mid: messageMid,
        createdAt: normalizedCreatedAt,
    };
}

export function selectMessengerMessages(db, {
    conversationId,
    tenantId = null,
    beforeId = null,
    limit = null,
    unified = false,
    newestFirst = false,
}) {
    const where = ['m.conversation_id = ?'];
    const params = [conversationId];

    if (tenantId !== null && tenantId !== undefined) {
        where.push('m.tenant_id = ?');
        params.push(tenantId);
    }

    if (beforeId !== null && beforeId !== undefined) {
        where.push('m.id < ?');
        params.push(beforeId);
    }

    const orderDirection = newestFirst ? 'DESC' : 'ASC';
    const limitSql = Number.isInteger(limit) && limit > 0 ? 'LIMIT ?' : '';
    if (limitSql) params.push(limit);

    const selectColumns = unified
        ? `
            id, 'messenger' as channel, direction,
            sender_name,
            message_text,
            CASE
                WHEN attachment_type IS NOT NULL THEN attachment_type
                WHEN sticker_url IS NOT NULL THEN 'sticker'
                ELSE 'text'
            END as message_type,
            attachment_url,
            sticker_url,
            is_read,
            normalized_created_at AS created_at
        `
        : `
            id, conversation_id, tenant_id, mid, direction, sender_id, sender_name,
            message_text, attachment_type, attachment_url, sticker_url, is_read,
            normalized_created_at AS created_at
        `;

    const sql = `
        ${MESSENGER_MESSAGE_CTE.replace('__WHERE__', where.join(' AND '))}
        SELECT ${selectColumns}
        FROM ranked
        WHERE is_fallback_mid = 0 OR (real_mid_count = 0 AND duplicate_rank = 1)
        ORDER BY normalized_created_at ${orderDirection}, id ${orderDirection}
        ${limitSql}
    `;

    return db.prepare(sql).all(...params);
}
