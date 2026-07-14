import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
    createMetaRate,
    listMetaRates,
    upsertMetaRate,
    updateMetaRate,
} from '../services/billingMetaRates.js';

const createDatabase = () => {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE meta_whatsapp_rates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            country_calling_code TEXT NOT NULL,
            market_name TEXT,
            currency TEXT NOT NULL DEFAULT 'USD',
            category TEXT NOT NULL,
            rate_amount REAL NOT NULL DEFAULT 0,
            volume_tier_min INTEGER DEFAULT 1,
            volume_tier_max INTEGER,
            effective_from DATE NOT NULL DEFAULT (date('now')),
            effective_to DATE,
            source TEXT DEFAULT 'manual',
            notes TEXT,
            is_active INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT (datetime('now', 'localtime')),
            updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
            UNIQUE(country_calling_code, currency, category, effective_from, volume_tier_min)
        )
    `);
    return db;
};

const assertBillingCode = (operation, code, status = 400) => assert.throws(
    operation,
    error => error?.code === code && error?.status === status
);

test('Meta rate CRUD normalizes persisted values and applies list filters', () => {
    const db = createDatabase();
    const active = createMetaRate(db, {
        country_calling_code: '+218',
        market_name: '  Libya  ',
        currency: 'usd',
        category: 'UTILITY',
        rate_amount: '0.125',
        volume_tier_min: '1',
        volume_tier_max: '1000',
        effective_from: '2026-01-01',
        source: ' test ',
    });
    const inactive = createMetaRate(db, {
        country_calling_code: '*',
        currency: 'EUR',
        category: 'marketing_lite',
        rate_amount: 0,
        effective_from: '2026-01-01',
        is_active: 'false',
    });

    assert.deepEqual({
        country_calling_code: active.country_calling_code,
        market_name: active.market_name,
        currency: active.currency,
        category: active.category,
        rate_amount: active.rate_amount,
        volume_tier_min: active.volume_tier_min,
        volume_tier_max: active.volume_tier_max,
        source: active.source,
        is_active: active.is_active,
    }, {
        country_calling_code: '218',
        market_name: 'Libya',
        currency: 'USD',
        category: 'utility',
        rate_amount: 0.125,
        volume_tier_min: 1,
        volume_tier_max: 1000,
        source: 'test',
        is_active: 1,
    });
    assert.equal(inactive.is_active, 0);
    assert.deepEqual(
        listMetaRates(db, { category: 'UTILITY', currency: 'usd' }).map(rate => rate.id),
        [active.id]
    );
    assert.deepEqual(
        listMetaRates(db, { activeOnly: true }).map(rate => rate.id),
        [active.id]
    );

    const repeatedImport = upsertMetaRate(db, {
        country_calling_code: '+218',
        market_name: 'Libya updated',
        currency: 'usd',
        category: 'UTILITY',
        rate_amount: 0.2,
        volume_tier_min: 1,
        volume_tier_max: 1000,
        effective_from: '2026-01-01',
        source: 'csv_import',
    });
    assert.equal(repeatedImport.action, 'updated');
    assert.equal(repeatedImport.rate.id, active.id);
    assert.equal(repeatedImport.rate.country_calling_code, '218');
    assert.equal(repeatedImport.rate.rate_amount, 0.2);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM meta_whatsapp_rates').get().count, 2);
    db.close();
});

test('Meta rate creation rejects malformed money, category, currency, tiers and dates', () => {
    const db = createDatabase();
    const valid = {
        country_calling_code: '218',
        currency: 'USD',
        category: 'utility',
        rate_amount: 0.1,
        effective_from: '2026-01-01',
    };
    const cases = [
        [{ ...valid, country_calling_code: 'country' }, 'INVALID_META_RATE_COUNTRY_CODE'],
        [{ ...valid, category: 'arbitrary' }, 'INVALID_META_RATE_CATEGORY'],
        [{ ...valid, currency: 'US_DOLLAR' }, 'INVALID_META_RATE_CURRENCY'],
        [{ ...valid, rate_amount: -0.1 }, 'INVALID_META_RATE_AMOUNT'],
        [{ ...valid, rate_amount: 'not-a-number' }, 'INVALID_META_RATE_AMOUNT'],
        [{ ...valid, rate_amount: '' }, 'INVALID_META_RATE_AMOUNT'],
        [{ ...valid, volume_tier_min: 0 }, 'INVALID_META_RATE_VOLUME_TIER'],
        [{ ...valid, volume_tier_min: 10, volume_tier_max: 9 }, 'INVALID_META_RATE_VOLUME_TIER'],
        [{ ...valid, effective_from: '2026-02-31' }, 'INVALID_META_RATE_PERIOD'],
        [{ ...valid, effective_to: '2025-12-31' }, 'INVALID_META_RATE_PERIOD'],
        [{ ...valid, is_active: 'enabled' }, 'INVALID_META_RATE_STATUS'],
    ];

    for (const [data, code] of cases) {
        assertBillingCode(() => createMetaRate(db, data), code);
    }
    assert.equal(db.prepare('SELECT COUNT(*) count FROM meta_whatsapp_rates').get().count, 0);
    db.close();
});

test('Meta rate updates validate the merged period and preserve failed records', () => {
    const db = createDatabase();
    const rate = createMetaRate(db, {
        country_calling_code: '218',
        currency: 'USD',
        category: 'authentication',
        rate_amount: 0.2,
        volume_tier_min: 10,
        volume_tier_max: 100,
        effective_from: '2026-01-01',
        effective_to: '2026-12-31',
    });

    const updated = updateMetaRate(db, rate.id, {
        rate_amount: '0.35',
        currency: 'eur',
        is_active: 'false',
        notes: '  reviewed  ',
    });
    assert.deepEqual({
        rate_amount: updated.rate_amount,
        currency: updated.currency,
        is_active: updated.is_active,
        notes: updated.notes,
    }, {
        rate_amount: 0.35,
        currency: 'EUR',
        is_active: 0,
        notes: 'reviewed',
    });

    assertBillingCode(
        () => updateMetaRate(db, rate.id, { volume_tier_min: 101 }),
        'INVALID_META_RATE_VOLUME_TIER'
    );
    assertBillingCode(
        () => updateMetaRate(db, rate.id, { effective_from: '2027-01-01' }),
        'INVALID_META_RATE_PERIOD'
    );
    assertBillingCode(() => updateMetaRate(db, rate.id, { unknown: true }), 'NO_FIELDS');
    assertBillingCode(() => updateMetaRate(db, 999, { is_active: false }), 'META_RATE_NOT_FOUND', 404);

    const otherRate = createMetaRate(db, {
        country_calling_code: '219',
        currency: 'EUR',
        category: 'authentication',
        rate_amount: 0.4,
        volume_tier_min: 10,
        effective_from: '2026-01-01',
        effective_to: '2026-12-31',
    });
    assertBillingCode(() => createMetaRate(db, {
        country_calling_code: '218',
        currency: 'EUR',
        category: 'authentication',
        rate_amount: 0.4,
        volume_tier_min: 10,
        effective_from: '2026-01-01',
    }), 'META_RATE_CONFLICT');
    assertBillingCode(() => updateMetaRate(db, otherRate.id, {
        country_calling_code: '218',
    }), 'META_RATE_CONFLICT');

    const persisted = db.prepare('SELECT * FROM meta_whatsapp_rates WHERE id = ?').get(rate.id);
    assert.equal(persisted.volume_tier_min, 10);
    assert.equal(persisted.effective_from, '2026-01-01');
    db.close();
});
