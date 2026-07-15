import { META_API_BASE } from '../config/index.js';
import { readMetaResponse } from './metaHttp.js';

const requiredText = (value, field) => {
    const normalized = String(value || '').trim();
    if (!normalized) throw new TypeError(`${field} is required`);
    return normalized;
};

export function buildFacebookPrivateReplyRequest({
    pageId,
    commentId,
    message,
    accessToken,
    apiBase = META_API_BASE,
}) {
    const normalizedPageId = requiredText(pageId, 'pageId');
    const normalizedCommentId = requiredText(commentId, 'commentId');
    const normalizedMessage = requiredText(message, 'message');
    const normalizedAccessToken = requiredText(accessToken, 'accessToken');

    return {
        url: `${apiBase}/${encodeURIComponent(normalizedPageId)}/messages`,
        init: {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${normalizedAccessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                recipient: { comment_id: normalizedCommentId },
                message: { text: normalizedMessage },
            }),
        },
    };
}

export async function sendFacebookPrivateReply(options, {
    fetchImpl = globalThis.fetch,
    parseMetaResponse = readMetaResponse,
} = {}) {
    const request = buildFacebookPrivateReplyRequest(options);
    const response = await fetchImpl(request.url, request.init);
    return parseMetaResponse(response);
}
