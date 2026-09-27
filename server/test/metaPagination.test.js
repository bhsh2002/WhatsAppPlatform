import assert from 'node:assert/strict';
import test from 'node:test';

import { safeMetaNextPageUrl } from '../services/metaPagination.js';

const endpoint = 'https://graph.test/v25.0/waba/message_templates?limit=100&fields=name,language';

test('Meta pagination reuses only the cursor and strips provider token/query fields', () => {
    const next = safeMetaNextPageUrl(
        'https://graph.test/v25.0/waba/message_templates?after=cursor-2&access_token=private&debug=secret',
        endpoint
    );
    const parsed = new URL(next);
    assert.equal(parsed.origin + parsed.pathname, 'https://graph.test/v25.0/waba/message_templates');
    assert.equal(parsed.searchParams.get('fields'), 'name,language');
    assert.equal(parsed.searchParams.get('limit'), '100');
    assert.equal(parsed.searchParams.get('after'), 'cursor-2');
    assert.ok(!next.includes('private'));
    assert.ok(!next.includes('debug'));
});

test('Meta pagination rejects wrong origin, endpoint, missing or ambiguous cursors', () => {
    for (const next of [
        'https://attacker.test/v25.0/waba/message_templates?after=cursor',
        'https://graph.test/v25.0/other?after=cursor',
        'http://graph.test/v25.0/waba/message_templates?after=cursor',
        'https://graph.test/v25.0/waba/message_templates?before=cursor',
        'https://graph.test/v25.0/waba/message_templates?after=a&after=b',
    ]) {
        assert.equal(safeMetaNextPageUrl(next, endpoint), null, next);
    }
    assert.equal(
        safeMetaNextPageUrl('https://graph.test/v25.0/waba/message_templates?after=a', `${endpoint}&access_token=private`),
        null
    );
});
