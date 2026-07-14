import assert from 'node:assert/strict';
import test from 'node:test';
import {
    getMetricsSnapshot,
    normalizeMetricPath,
    recordRequestMetric,
    redactLogData,
    redactLogString,
} from '../services/observability.js';

test('structured logging redacts credential fields and bearer values', () => {
    const result = redactLogData({
        authorization: 'Bearer top-secret',
        nested: { access_token: 'token-value', safe: 'visible' },
        message: 'request failed access_token=abc123&next=1',
    });

    assert.equal(result.authorization, '[REDACTED]');
    assert.equal(result.nested.access_token, '[REDACTED]');
    assert.equal(result.nested.safe, 'visible');
    assert.equal(result.message.includes('abc123'), false);
    assert.equal(redactLogString('Bearer abc.def.ghi'), 'Bearer [REDACTED]');
});

test('metric paths remove high-cardinality identifiers and query data', () => {
    assert.equal(normalizeMetricPath('/tenants/123/templates/456'), '/tenants/:id/templates/:id');
    assert.equal(normalizeMetricPath('/media/550e8400-e29b-41d4-a716-446655440000/download'), '/media/:id/download');
    assert.equal(normalizeMetricPath('/health'), '/health');
});

test('five-minute request window excludes older metrics and calculates error ratio', () => {
    const nowMs = Date.UTC(2026, 6, 13, 12, 5, 0);
    recordRequestMetric({ method: 'GET', path: '/old', status: 500, durationMs: 10, timestampMs: nowMs - 6 * 60000 });
    recordRequestMetric({ method: 'GET', path: '/current', status: 200, durationMs: 20, timestampMs: nowMs });
    recordRequestMetric({ method: 'GET', path: '/current', status: 503, durationMs: 40, timestampMs: nowMs });

    const metrics = getMetricsSnapshot({ nowMs });
    assert.deepEqual(metrics.window_5m, {
        minutes: 5,
        requests: 2,
        errors: 1,
        error_ratio: 0.5,
        average_duration_ms: 30,
    });
});
