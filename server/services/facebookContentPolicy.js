import {
    isWithinPostingWindow,
    localDateTimeToUtc,
    nextPostingWindow,
    normalizeScheduleDays,
    normalizeScheduleTimes,
    normalizeTimeZone,
    parseStoredList,
    zonedDayBounds,
} from './facebookContentSchedule.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_FACEBOOK_CONTENT_POLICY = Object.freeze({
    timezone: 'Africa/Tripoli',
    allowed_days: Object.freeze([0, 1, 2, 3, 4, 5, 6]),
    posting_start_time: '08:00',
    posting_end_time: '22:00',
    daily_post_limit: 3,
    no_repeat_days: 14,
});

const boundedNumber = (value, fallback, min, max) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
};

const presentPolicy = row => ({
    timezone: normalizeTimeZone(row?.timezone || DEFAULT_FACEBOOK_CONTENT_POLICY.timezone),
    allowed_days: normalizeScheduleDays(parseStoredList(
        row?.allowed_days_json,
        DEFAULT_FACEBOOK_CONTENT_POLICY.allowed_days,
    )),
    posting_start_time: normalizeScheduleTimes([
        row?.posting_start_time || DEFAULT_FACEBOOK_CONTENT_POLICY.posting_start_time,
    ])[0],
    posting_end_time: normalizeScheduleTimes([
        row?.posting_end_time || DEFAULT_FACEBOOK_CONTENT_POLICY.posting_end_time,
    ])[0],
    daily_post_limit: boundedNumber(
        row?.daily_post_limit,
        DEFAULT_FACEBOOK_CONTENT_POLICY.daily_post_limit,
        1,
        24,
    ),
    no_repeat_days: boundedNumber(
        row?.no_repeat_days,
        DEFAULT_FACEBOOK_CONTENT_POLICY.no_repeat_days,
        0,
        365,
    ),
});

export const getFacebookContentPublishingPolicy = (database, tenantId, linkedPageId) => {
    const page = database.prepare(`
        SELECT timezone, allowed_days_json, posting_start_time, posting_end_time,
               daily_post_limit, no_repeat_days
        FROM facebook_content_settings
        WHERE tenant_id = ? AND linked_page_id = ?
        LIMIT 1
    `).get(tenantId, linkedPageId);
    const tenant = page ? null : database.prepare(`
        SELECT timezone, allowed_days_json, posting_start_time, posting_end_time,
               daily_post_limit, no_repeat_days
        FROM facebook_content_settings
        WHERE tenant_id = ? AND linked_page_id IS NULL
        LIMIT 1
    `).get(tenantId);
    return presentPolicy(page || tenant);
};

export const parsePageLocalDateTime = (value, timeZone) => {
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) return null;
        return value;
    }
    const normalized = String(value || '').trim();
    const localMatch = normalized.match(
        /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/,
    );
    if (localMatch) {
        const [, year, month, date, hour, minute] = localMatch;
        return localDateTimeToUtc({
            year: Number(year),
            month: Number(month),
            date: Number(date),
            hour: Number(hour),
            minute: Number(minute),
            timeZone: normalizeTimeZone(timeZone),
        });
    }
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const effectiveProductId = (database, tenantId, contentItemId, productId) => {
    if (productId) return Number(productId);
    if (!contentItemId) return null;
    return database.prepare(`
        SELECT product_id
        FROM facebook_content_items
        WHERE id = ? AND tenant_id = ?
    `).get(contentItemId, tenantId)?.product_id || null;
};

const sourceConflict = (database, {
    tenantId,
    linkedPageId,
    contentItemId,
    productId,
    renderedMessage,
    linkUrl,
    mediaUrl,
    at,
    noRepeatDays,
    excludePublicationId,
    mode,
}) => {
    if (noRepeatDays <= 0) return null;
    const normalizedProductId = effectiveProductId(database, tenantId, contentItemId, productId);
    const sourceClauses = [];
    const sourceParams = [];
    if (contentItemId) {
        sourceClauses.push('publication.content_item_id = ?');
        sourceParams.push(contentItemId);
    }
    if (normalizedProductId) {
        sourceClauses.push('COALESCE(publication.product_id, item.product_id) = ?');
        sourceParams.push(normalizedProductId);
    }
    const normalizedMessage = String(renderedMessage || '').trim();
    const normalizedLink = String(linkUrl || '').trim();
    const normalizedMedia = String(mediaUrl || '').trim();
    if (normalizedMessage) {
        sourceClauses.push('publication.rendered_message = ?');
        sourceParams.push(normalizedMessage);
    }
    if (normalizedLink) {
        sourceClauses.push('publication.link_url = ?');
        sourceParams.push(normalizedLink);
    }
    if (normalizedMedia) {
        sourceClauses.push('publication.media_url = ?');
        sourceParams.push(normalizedMedia);
    }
    if (!sourceClauses.length) return null;

    const clauses = [
        'publication.tenant_id = ?',
        'publication.linked_page_id = ?',
        `(${sourceClauses.join(' OR ')})`,
    ];
    const params = [tenantId, linkedPageId, ...sourceParams];
    if (excludePublicationId) {
        clauses.push('publication.id != ?');
        params.push(excludePublicationId);
    }
    const target = at instanceof Date ? at : new Date(at);
    const start = new Date(target.getTime() - (noRepeatDays * DAY_MS));
    if (mode === 'publish') {
        clauses.push("publication.status = 'published'");
        clauses.push('publication.published_at >= ? AND publication.published_at <= ?');
        params.push(start.toISOString(), target.toISOString());
    } else {
        const end = new Date(target.getTime() + (noRepeatDays * DAY_MS));
        clauses.push("publication.status IN ('pending', 'processing', 'published')");
        clauses.push('COALESCE(publication.published_at, publication.scheduled_for) >= ?');
        clauses.push('COALESCE(publication.published_at, publication.scheduled_for) <= ?');
        params.push(start.toISOString(), end.toISOString());
    }
    return database.prepare(`
        SELECT publication.id, publication.status,
               COALESCE(publication.published_at, publication.scheduled_for) AS occurred_at
        FROM facebook_content_publications publication
        LEFT JOIN facebook_content_items item
          ON item.id = publication.content_item_id
         AND item.tenant_id = publication.tenant_id
        WHERE ${clauses.join(' AND ')}
        ORDER BY occurred_at DESC, publication.id DESC
        LIMIT 1
    `).get(...params) || null;
};

const dailyPublicationCount = (database, {
    tenantId,
    linkedPageId,
    at,
    timeZone,
    excludePublicationId,
    mode,
}) => {
    const { start, end } = zonedDayBounds(at, timeZone);
    const clauses = ['tenant_id = ?', 'linked_page_id = ?'];
    const params = [tenantId, linkedPageId];
    if (excludePublicationId) {
        clauses.push('id != ?');
        params.push(excludePublicationId);
    }
    if (mode === 'publish') {
        clauses.push("status = 'published'");
        clauses.push('published_at >= ? AND published_at < ?');
    } else {
        clauses.push("status IN ('pending', 'processing', 'published')");
        clauses.push('scheduled_for >= ? AND scheduled_for < ?');
    }
    params.push(start.toISOString(), end.toISOString());
    return {
        count: database.prepare(`
            SELECT COUNT(*) AS count
            FROM facebook_content_publications
            WHERE ${clauses.join(' AND ')}
        `).get(...params).count,
        dayEnd: end,
    };
};

const policyResult = ({ allowed, code = null, message = null, nextAllowedAt = null, policy }) => ({
    allowed,
    code,
    message,
    next_allowed_at: nextAllowedAt?.toISOString() || null,
    timezone: policy.timezone,
    policy,
});

export const evaluateFacebookContentPublishingPolicy = (database, {
    tenantId,
    linkedPageId,
    contentItemId = null,
    productId = null,
    renderedMessage = null,
    linkUrl = null,
    mediaUrl = null,
    at = new Date(),
    excludePublicationId = null,
    mode = 'schedule',
} = {}) => {
    const target = at instanceof Date ? at : new Date(at);
    if (Number.isNaN(target.getTime())) throw new TypeError('at must be a valid date');
    const policy = getFacebookContentPublishingPolicy(database, tenantId, linkedPageId);
    const withinWindow = isWithinPostingWindow({
        date: target,
        timeZone: policy.timezone,
        days: policy.allowed_days,
        startTime: policy.posting_start_time,
        endTime: policy.posting_end_time,
    });
    if (!withinWindow) {
        return policyResult({
            allowed: false,
            code: 'CONTENT_POSTING_WINDOW_CLOSED',
            message: 'الموعد خارج أيام أو ساعات النشر المحددة لهذه الصفحة.',
            nextAllowedAt: nextPostingWindow({
                from: new Date(target.getTime() + 60 * 1000),
                timeZone: policy.timezone,
                days: policy.allowed_days,
                startTime: policy.posting_start_time,
                endTime: policy.posting_end_time,
            }),
            policy,
        });
    }

    const daily = dailyPublicationCount(database, {
        tenantId,
        linkedPageId,
        at: target,
        timeZone: policy.timezone,
        excludePublicationId,
        mode,
    });
    if (daily.count >= policy.daily_post_limit) {
        return policyResult({
            allowed: false,
            code: 'CONTENT_DAILY_LIMIT_REACHED',
            message: `بلغت الصفحة الحد اليومي للنشر (${policy.daily_post_limit}).`,
            nextAllowedAt: nextPostingWindow({
                from: new Date(daily.dayEnd.getTime() + 60 * 1000),
                timeZone: policy.timezone,
                days: policy.allowed_days,
                startTime: policy.posting_start_time,
                endTime: policy.posting_end_time,
            }),
            policy,
        });
    }

    const conflict = sourceConflict(database, {
        tenantId,
        linkedPageId,
        contentItemId,
        productId,
        renderedMessage,
        linkUrl,
        mediaUrl,
        at: target,
        noRepeatDays: policy.no_repeat_days,
        excludePublicationId,
        mode,
    });
    if (conflict) {
        const repeatEndsAt = new Date(
            new Date(conflict.occurred_at).getTime() + (policy.no_repeat_days * DAY_MS) + 60 * 1000,
        );
        return policyResult({
            allowed: false,
            code: 'CONTENT_REPEAT_WINDOW_ACTIVE',
            message: `سبق استخدام هذا المحتوى خلال فترة منع التكرار (${policy.no_repeat_days} يوماً).`,
            nextAllowedAt: nextPostingWindow({
                from: repeatEndsAt,
                timeZone: policy.timezone,
                days: policy.allowed_days,
                startTime: policy.posting_start_time,
                endTime: policy.posting_end_time,
            }),
            policy,
        });
    }
    return policyResult({ allowed: true, policy });
};

export const assertFacebookContentPublishingPolicy = (database, options) => {
    const result = evaluateFacebookContentPublishingPolicy(database, options);
    if (result.allowed) return result;
    const error = new Error(result.message);
    error.status = 409;
    error.code = result.code;
    error.details = {
        next_allowed_at: result.next_allowed_at,
        timezone: result.timezone,
    };
    throw error;
};
