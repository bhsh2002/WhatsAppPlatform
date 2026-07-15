import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildFacebookPrivateReplyRequest,
    sendFacebookPrivateReply,
} from '../services/facebookPrivateReplies.js';

test('Facebook comment private replies use the Page Send API comment recipient contract', async () => {
    const request = buildFacebookPrivateReplyRequest({
        pageId: 'page/123',
        commentId: 'post_comment',
        message: 'Private response',
        accessToken: 'page-token',
        apiBase: 'https://graph.test/v25.0',
    });
    assert.equal(request.url, 'https://graph.test/v25.0/page%2F123/messages');
    assert.doesNotMatch(request.url, /private_replies/);
    assert.equal(request.init.headers.Authorization, 'Bearer page-token');
    assert.deepEqual(JSON.parse(request.init.body), {
        recipient: { comment_id: 'post_comment' },
        message: { text: 'Private response' },
    });

    const calls = [];
    const result = await sendFacebookPrivateReply({
        pageId: 'page-1',
        commentId: 'comment-1',
        message: 'Hello',
        accessToken: 'token',
        apiBase: 'https://graph.test/v25.0',
    }, {
        fetchImpl: async (url, init) => { calls.push({ url, init }); return { response: true }; },
        parseMetaResponse: async response => ({ ok: true, status: 200, data: { message_id: 'mid-1' }, response }),
    });
    assert.equal(calls.length, 1);
    assert.equal(result.ok, true);
    assert.equal(result.data.message_id, 'mid-1');
});

test('Facebook private reply requests reject missing identity or message fields', () => {
    assert.throws(() => buildFacebookPrivateReplyRequest({
        pageId: '', commentId: 'comment', message: 'Hello', accessToken: 'token',
    }), /pageId is required/);
    assert.throws(() => buildFacebookPrivateReplyRequest({
        pageId: 'page', commentId: '', message: 'Hello', accessToken: 'token',
    }), /commentId is required/);
});
