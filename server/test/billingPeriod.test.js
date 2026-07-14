import assert from 'node:assert/strict';
import test from 'node:test';
import {
    normalizeBillingPeriod,
    normalizeSqlDate,
    sqlDate,
    toUnixSeconds,
} from '../services/billingPeriod.js';

const fixedDb = {
    prepare(sql) {
        return {
            get() {
                if (sql.includes("start of month")) {
                    return {
                        start_sql: '2026-07-01 00:00:00',
                        end_sql: '2026-07-13 12:00:00',
                    };
                }
                return { value: '2026-07-13 12:00:00' };
            },
        };
    },
};

test('billing periods normalize full-day boundaries and deterministic defaults', () => {
    assert.deepEqual(normalizeBillingPeriod(fixedDb, {
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
    }), {
        start: '2026-06-01 00:00:00',
        end: '2026-06-30 23:59:59',
        period_start: '2026-06-01 00:00:00',
        period_end: '2026-06-30 23:59:59',
        start_date: '2026-06-01',
        end_date: '2026-06-30',
        default_start: false,
        default_end: false,
    });
    assert.deepEqual(normalizeBillingPeriod(fixedDb), {
        start: '2026-07-01 00:00:00',
        end: '2026-07-13 12:00:00',
        period_start: '2026-07-01 00:00:00',
        period_end: '2026-07-13 12:00:00',
        start_date: '2026-07-01',
        end_date: '2026-07-13',
        default_start: true,
        default_end: true,
    });
});

test('billing SQL and Unix date conversion use one normalized contract', () => {
    assert.equal(normalizeSqlDate(fixedDb, '2026-01-02'), '2026-01-02 00:00:00');
    assert.equal(normalizeSqlDate(fixedDb, '2026-01-02', true), '2026-01-02 23:59:59');
    assert.equal(normalizeSqlDate(fixedDb, '2026-01-02T03:04:05Z'), '2026-01-02 03:04:05');
    assert.equal(sqlDate(fixedDb), '2026-07-13 12:00:00');
    assert.equal(sqlDate(fixedDb, 0), '1970-01-01 00:00:00');
    assert.equal(
        toUnixSeconds(fixedDb, '2026-01-02'),
        Math.floor(new Date('2026-01-02T00:00:00').getTime() / 1000)
    );
    assert.equal(toUnixSeconds(fixedDb, null), null);
});

test('billing periods reject impossible, malformed and reversed dates', () => {
    const invalidPeriods = [
        { periodStart: '2026-02-31', periodEnd: '2026-03-02' },
        { periodStart: 'not-a-date', periodEnd: '2026-03-02' },
        { periodStart: '2026-04-02', periodEnd: '2026-04-01' },
    ];
    for (const period of invalidPeriods) {
        assert.throws(
            () => normalizeBillingPeriod(fixedDb, period),
            error => error?.code === 'INVALID_BILLING_PERIOD' && error?.status === 400
        );
    }
    assert.throws(
        () => normalizeSqlDate(fixedDb, '2026-13-01'),
        error => error?.code === 'INVALID_BILLING_PERIOD'
    );
    assert.equal(toUnixSeconds(fixedDb, 'not-a-date'), null);
});
