import { META_API_BASE } from '../config/index.js';
import {
    normalizeMetaCategory,
    normalizePricingType,
    toInt,
} from './billingCore.js';
import { readMetaResponse } from './metaHttp.js';

export function buildWabaFieldUrl(wabaId, field, accessToken) {
    const params = new URLSearchParams({
        fields: field,
        access_token: accessToken,
    });
    return `${META_API_BASE}/${wabaId}?${params.toString()}`;
}

export async function fetchWabaField(wabaId, field, accessToken, fetchImpl = globalThis.fetch) {
    const response = await fetchImpl(buildWabaFieldUrl(wabaId, field, accessToken));
    const metaResult = await readMetaResponse(response);
    if (!metaResult.ok) {
        const error = new Error(metaResult.error?.message || 'Meta analytics request failed');
        error.status = metaResult.status;
        error.data = metaResult.error;
        throw error;
    }
    return metaResult.data;
}

export function sumMessageAnalytics(data) {
    const points = data?.analytics?.data_points || [];
    return points.reduce((acc, point) => ({
        sent: acc.sent + toInt(point.sent),
        delivered: acc.delivered + toInt(point.delivered),
    }), { sent: 0, delivered: 0 });
}

const flattenConversationPoints = (data) => {
    const groups = data?.conversation_analytics?.data || [];
    return groups.flatMap((group) => Array.isArray(group.data_points) ? group.data_points : []);
};

export function sumConversationAnalytics(data) {
    const points = flattenConversationPoints(data);
    return points.reduce((acc, point) => ({
        conversations: acc.conversations + toInt(point.conversation),
        cost: acc.cost + (Number(point.cost) || 0),
        currency: acc.currency || point.currency || null,
    }), { conversations: 0, cost: 0, currency: null });
}

const flattenPricingPoints = (data) => {
    const pricing = data?.pricing_analytics;
    if (!pricing) return [];
    if (Array.isArray(pricing.data_points)) return pricing.data_points;
    if (Array.isArray(pricing.data)) {
        return pricing.data.flatMap((group) => {
            if (Array.isArray(group.data_points)) return group.data_points;
            if (group && typeof group === 'object') return [group];
            return [];
        });
    }
    return [];
};

export function sumPricingAnalytics(data) {
    const points = flattenPricingPoints(data);
    const byCategoryType = {};
    let volume = 0;
    let cost = 0;
    let currency = null;

    for (const point of points) {
        const pointVolume = toInt(point.volume);
        const pointCost = Number(point.cost) || 0;
        const category = normalizeMetaCategory(point.pricing_category || point.category) || 'unknown';
        const type = normalizePricingType(point.pricing_type || point.type) || 'unknown';
        const key = `${category}:${type}`;

        volume += pointVolume;
        cost += pointCost;
        currency = currency || point.currency || null;

        if (!byCategoryType[key]) {
            byCategoryType[key] = {
                pricing_category: category,
                pricing_type: type,
                volume: 0,
                cost: 0,
                currency: point.currency || null,
            };
        }
        byCategoryType[key].volume += pointVolume;
        byCategoryType[key].cost += pointCost;
        byCategoryType[key].currency = byCategoryType[key].currency || point.currency || null;
    }

    return {
        volume,
        cost,
        currency,
        points,
        by_category_type: Object.values(byCategoryType),
    };
}
