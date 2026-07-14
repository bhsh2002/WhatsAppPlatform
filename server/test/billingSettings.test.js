import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
    getBillingSettings,
    updateBillingSettings,
} from '../services/billingSettings.js';

const createDatabase = () => {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE billing_settings (
            key TEXT PRIMARY KEY,
            value TEXT,
            description TEXT,
            updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
        )
    `);
    return db;
};

const insertSetting = (db, key, value, description = null) => db.prepare(`
    INSERT INTO billing_settings (key, value, description)
    VALUES (?, ?, ?)
`).run(key, value, description);

const assertBillingCode = (operation, code) => assert.throws(
    operation,
    error => error?.code === code && error?.status === 400
);

test('billing settings return safe defaults for missing or invalid legacy values', () => {
    const db = createDatabase();
    insertSetting(db, 'meta_cost_exchange_rate_to_lyd', '-2', 'exchange');
    insertSetting(db, 'credit_value_lyd', '0');
    insertSetting(db, 'meta_cost_margin_percent', '-1');
    insertSetting(db, 'strict_meta_rate_required', 'ambiguous');
    insertSetting(db, 'whatsapp_pricing_source_priority', 'unknown');
    insertSetting(db, 'meta_cost_margin_note', 'legacy note');

    const result = getBillingSettings(db);

    assert.deepEqual(result.settings, {
        meta_cost_exchange_rate_to_lyd: 1,
        meta_cost_margin_note: 'legacy note',
        credit_value_lyd: 0.1,
        meta_cost_margin_percent: 20,
        strict_meta_rate_required: true,
        whatsapp_pricing_source_priority: 'status_webhook_then_estimate',
    });
    assert.equal(result.rows.length, 6);
    assert.equal(result.rows.find(row => row.key === 'meta_cost_exchange_rate_to_lyd').description, 'exchange');
    db.close();
});

test('billing settings update known fields atomically with normalized storage', () => {
    const db = createDatabase();
    const result = updateBillingSettings(db, {
        meta_cost_exchange_rate_to_lyd: '5.25',
        meta_cost_margin_note: '  approved margin  ',
        credit_value_lyd: 0.2,
        meta_cost_margin_percent: 0,
        strict_meta_rate_required: 'off',
        whatsapp_pricing_source_priority: 'status_webhook_then_estimate',
        unknown_setting: 'ignored',
    });

    assert.deepEqual(result.settings, {
        meta_cost_exchange_rate_to_lyd: 5.25,
        meta_cost_margin_note: 'approved margin',
        credit_value_lyd: 0.2,
        meta_cost_margin_percent: 0,
        strict_meta_rate_required: false,
        whatsapp_pricing_source_priority: 'status_webhook_then_estimate',
    });
    assert.deepEqual(
        db.prepare('SELECT key, value FROM billing_settings ORDER BY key').all(),
        [
            { key: 'credit_value_lyd', value: '0.2' },
            { key: 'meta_cost_exchange_rate_to_lyd', value: '5.25' },
            { key: 'meta_cost_margin_note', value: 'approved margin' },
            { key: 'meta_cost_margin_percent', value: '0' },
            { key: 'strict_meta_rate_required', value: 'false' },
            { key: 'whatsapp_pricing_source_priority', value: 'status_webhook_then_estimate' },
        ]
    );
    assert.equal(db.prepare("SELECT COUNT(*) count FROM billing_settings WHERE key = 'unknown_setting'").get().count, 0);
    db.close();
});

test('invalid billing settings fail with 400 and leave all stored values unchanged', () => {
    const db = createDatabase();
    insertSetting(db, 'meta_cost_margin_note', 'original');
    const invalidCases = [
        [{ meta_cost_exchange_rate_to_lyd: 0 }, 'INVALID_BILLING_SETTING'],
        [{ credit_value_lyd: -0.1 }, 'INVALID_BILLING_SETTING'],
        [{ meta_cost_margin_percent: -1 }, 'INVALID_BILLING_SETTING'],
        [{ strict_meta_rate_required: 'sometimes' }, 'INVALID_BILLING_SETTING'],
        [{ whatsapp_pricing_source_priority: 'estimate_only' }, 'INVALID_BILLING_SETTING'],
        [{ meta_cost_margin_note: 'changed', credit_value_lyd: 'invalid' }, 'INVALID_BILLING_SETTING'],
        [{ unknown_setting: true }, 'NO_FIELDS'],
    ];

    for (const [data, code] of invalidCases) {
        assertBillingCode(() => updateBillingSettings(db, data), code);
    }
    assert.deepEqual(
        db.prepare('SELECT key, value FROM billing_settings').all(),
        [{ key: 'meta_cost_margin_note', value: 'original' }]
    );
    db.close();
});
