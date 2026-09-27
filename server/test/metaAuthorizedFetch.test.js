import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchMetaWithAccessToken } from '../services/metaAuthorizedFetch.js';

test('Meta access tokens are sent in the Authorization header and never added to URLs', async () => {
    let captured;
    const response = { ok: true };
    const returned = await fetchMetaWithAccessToken(
        'https://graph.facebook.com/v25.0/page/insights?metric=page_views_total',
        'private-page-token',
        { headers: { Accept: 'application/json' } },
        async (url, init) => {
            captured = { url, init };
            return response;
        }
    );

    assert.equal(returned, response);
    assert.equal(captured.init.headers.Authorization, 'Bearer private-page-token');
    assert.equal(captured.init.headers.Accept, 'application/json');
    assert.doesNotMatch(captured.url, /private-page-token|access_token=/);
});

