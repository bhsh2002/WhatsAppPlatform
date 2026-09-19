import assert from 'node:assert/strict';
import test from 'node:test';

import {
    canDismissServiceRequest,
    presentServiceRequest,
    shouldLoadServiceRequests,
} from './serviceRequestPresentation.js';

test('service requests are loaded for any connected selected platform', () => {
    assert.equal(shouldLoadServiceRequests({
        platform_code: 'sawemly',
        connection_id: 'sawemly-connection',
    }), true);
    assert.equal(shouldLoadServiceRequests({
        platform_code: 'catalog',
        connection_id: null,
    }), false);
});

test('only pending notification requests expose dismiss', () => {
    assert.equal(canDismissServiceRequest({
        request_kind: 'notification_request',
        status: 'pending_review',
    }), true);
    assert.equal(canDismissServiceRequest({
        request_kind: 'content_publication',
        status: 'pending_review',
    }), false);
    assert.equal(canDismissServiceRequest({
        request_kind: 'notification_request',
        status: 'sent',
    }), false);
});

test('service request presentation identifies kind, status, and useful payload fields', () => {
    const result = presentServiceRequest({
        request_kind: 'content_publication',
        request_key: 'sawemly-content-1',
        status: 'pending_review',
        payload: {
            request_id: 'sawemly-content-1',
            content_type: 'product_post',
            channels: ['facebook', 'instagram'],
            text: 'منشور منتج جاهز للمراجعة',
        },
    }, 'ar');

    assert.equal(result.kind, 'طلب نشر محتوى');
    assert.equal(result.status, 'قيد المراجعة');
    assert.match(result.summary, /منشور منتج/);
    assert.match(result.summary, /facebook, instagram/);
    assert.equal(result.dismissible, false);
});
