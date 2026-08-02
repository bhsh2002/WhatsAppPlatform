import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { getWhatsAppConversationWindow } from '../services/whatsappConversationWindow.js';
import {
    listTenantWhatsAppNumbers,
    resolveTenantWhatsAppContext,
    setDefaultTenantWhatsAppNumber,
} from '../services/whatsappNumbers.js';

const createDatabase = () => {
    const database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    database.exec(`
        CREATE TABLE tenants (
            id INTEGER PRIMARY KEY,
            name TEXT,
            status TEXT,
            phone_number_id TEXT,
            waba_id TEXT,
            business_id TEXT,
            dataset_id TEXT,
            access_token TEXT,
            access_token_encrypted TEXT,
            updated_at DATETIME
        );
        CREATE TABLE tenant_whatsapp_numbers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER NOT NULL,
            phone_number_id TEXT NOT NULL UNIQUE,
            waba_id TEXT,
            business_id TEXT,
            dataset_id TEXT,
            display_phone_number TEXT,
            verified_name TEXT,
            label TEXT,
            quality_rating TEXT,
            platform_status TEXT,
            access_token_encrypted TEXT,
            is_default INTEGER NOT NULL DEFAULT 0,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (tenant_id, phone_number_id),
            FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
        );
        CREATE UNIQUE INDEX one_default
            ON tenant_whatsapp_numbers(tenant_id) WHERE is_default = 1;
        CREATE TABLE tenant_whatsapp_contact_windows (
            tenant_id INTEGER NOT NULL,
            phone_number_id TEXT NOT NULL,
            contact_phone TEXT NOT NULL,
            last_customer_message_at DATETIME NOT NULL,
            updated_at DATETIME,
            PRIMARY KEY (tenant_id, phone_number_id, contact_phone)
        );
        CREATE TABLE contacts (
            tenant_id INTEGER, phone TEXT, last_customer_message_at DATETIME
        );
        INSERT INTO tenants VALUES
            (1, 'Tenant A', 'Active', 'phone-a', 'waba-a', 'business-a', 'dataset-a', NULL, 'enc:token-a', NULL),
            (2, 'Tenant B', 'Active', 'phone-b', 'waba-b', 'business-b', 'dataset-b', NULL, 'enc:token-b', NULL);
        INSERT INTO tenant_whatsapp_numbers (
            tenant_id, phone_number_id, waba_id, business_id,
            display_phone_number, verified_name, label,
            access_token_encrypted, is_default, is_active
        ) VALUES
            (1, 'phone-a', 'waba-a', 'business-a', '+218 91 000 0001', 'Branch A', 'المبيعات', 'enc:token-a', 1, 1),
            (1, 'phone-a-2', 'waba-a', 'business-a', '+218 92 000 0002', 'Branch B', 'الدعم', 'enc:token-a-2', 0, 1),
            (2, 'phone-b', 'waba-b', 'business-b', '+218 93 000 0003', 'Other', NULL, 'enc:token-b', 1, 1);
        INSERT INTO tenant_whatsapp_contact_windows VALUES
            (1, 'phone-a', '218910000099', '2026-07-14T12:00:00.000Z', NULL),
            (1, 'phone-a-2', '218910000099', '2026-07-12T12:00:00.000Z', NULL);
    `);
    return database;
};

const decryptToken = value => value?.replace(/^enc:/, '') || null;

test('number resolution defaults safely and accepts only active tenant-owned selections', (t) => {
    const database = createDatabase();
    t.after(() => database.close());

    const defaultContext = resolveTenantWhatsAppContext({
        database,
        tenantId: 1,
        decryptToken,
        accessTokenForTenant: () => null,
    });
    assert.equal(defaultContext.phoneNumberId, 'phone-a');
    assert.equal(defaultContext.accessToken, 'token-a');

    const selectedContext = resolveTenantWhatsAppContext({
        database,
        tenantId: 1,
        request: { headers: { 'x-whatsapp-phone-number-id': 'phone-a-2' } },
        decryptToken,
        accessTokenForTenant: () => null,
    });
    assert.equal(selectedContext.phoneNumberId, 'phone-a-2');
    assert.equal(selectedContext.accessToken, 'token-a-2');

    const crossTenant = resolveTenantWhatsAppContext({
        database,
        tenantId: 1,
        phoneNumberId: 'phone-b',
        decryptToken,
        accessTokenForTenant: () => null,
    });
    assert.equal(crossTenant.status, 404);
    assert.equal(crossTenant.code, 'WHATSAPP_NUMBER_NOT_FOUND');

    database.prepare("UPDATE tenant_whatsapp_numbers SET is_active = 0 WHERE phone_number_id = 'phone-a-2'").run();
    const inactive = resolveTenantWhatsAppContext({
        database,
        tenantId: 1,
        phoneNumberId: 'phone-a-2',
        decryptToken,
        accessTokenForTenant: () => null,
    });
    assert.equal(inactive.status, 409);
    assert.equal(inactive.code, 'WHATSAPP_NUMBER_INACTIVE');
});

test('public number listing omits credentials and changing the default synchronizes legacy pointers', (t) => {
    const database = createDatabase();
    t.after(() => database.close());

    const numbers = listTenantWhatsAppNumbers(database, 1);
    assert.deepEqual(numbers.map(number => number.phone_number_id), ['phone-a', 'phone-a-2']);
    assert.ok(numbers.every(number => !Object.hasOwn(number, 'access_token_encrypted')));

    const updated = setDefaultTenantWhatsAppNumber(database, 1, 'phone-a-2');
    assert.equal(updated.is_default, 1);
    assert.deepEqual(
        database.prepare(`
            SELECT phone_number_id, waba_id, business_id, access_token_encrypted
            FROM tenants WHERE id = 1
        `).get(),
        {
            phone_number_id: 'phone-a-2',
            waba_id: 'waba-a',
            business_id: 'business-a',
            access_token_encrypted: 'enc:token-a-2',
        }
    );
    assert.equal(
        database.prepare("SELECT COUNT(*) count FROM tenant_whatsapp_numbers WHERE tenant_id = 1 AND is_default = 1").get().count,
        1,
    );
});

test('24-hour conversation windows are isolated by receiving WhatsApp number', (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const now = Date.parse('2026-07-14T13:00:00.000Z');

    const first = getWhatsAppConversationWindow(database, 1, '218910000099', now, 'phone-a');
    const second = getWhatsAppConversationWindow(database, 1, '218910000099', now, 'phone-a-2');
    assert.equal(first.isOpen, true);
    assert.equal(second.isOpen, false);
});
