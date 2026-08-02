import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import Database from 'better-sqlite3';

import { runMigrationsSync } from '../db/migrator.js';
import { encrypt, initEncryption } from '../services/encryption.js';
import { SmsGatewayError, SmsGatewayService } from '../services/smsGateway.js';

const createDatabase = () => {
    const database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    runMigrationsSync(database);
    database.prepare(`
        INSERT INTO tenants (id, name, phone, status)
        VALUES (1, 'Wa tenant', '218910000001', 'Active')
    `).run();
    return database;
};

const insertAccount = (database, {
    id,
    name,
    key,
    secret,
    isDefault = false,
} = {}) => {
    database.prepare(`
        INSERT INTO sms_gateway_accounts (
            id, tenant_id, name, base_url, api_key_encrypted,
            credential_fingerprint,
            webhook_secret_encrypted, webhook_key, enabled, is_default, status
        ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, 1, ?, 'active')
    `).run(
        id,
        name,
        `https://sms-${id}.example.com`,
        encrypt(`api-key-${id}`),
        `fingerprint-${id}`,
        encrypt(secret),
        key,
        isDefault ? 1 : 0,
    );
};

process.env.CRYPTO_KEY = process.env.CRYPTO_KEY || 'b'.repeat(64);
initEncryption();

test('one Wa tenant keeps multiple SMS accounts and identical gateway ids isolated', (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    insertAccount(database, {
        id: 11,
        name: 'Tripoli gateway',
        key: '11111111-1111-4111-8111-111111111111',
        secret: 'tripoli-webhook-secret',
        isDefault: true,
    });
    insertAccount(database, {
        id: 12,
        name: 'Benghazi gateway',
        key: '22222222-2222-4222-8222-222222222222',
        secret: 'benghazi-webhook-secret',
    });

    const service = new SmsGatewayService({ database });
    assert.deepEqual(service.listAccounts(1).map(account => account.id), [11, 12]);
    assert.equal(service.defaultAccount(1).id, 11);
    assert.equal(service.presentAccount(service.getAccount(1, 11)).api_key_encrypted, undefined);

    const first = service.storeMessage(service.getAccount(1, 11), {
        message_id: 'same-gateway-message-id',
        external_id: 'same-external-id',
        direction: 'outgoing',
        recipient: '218910000011',
        message: 'رسالة من طرابلس',
        status: 'queued',
    });
    const second = service.storeMessage(service.getAccount(1, 12), {
        message_id: 'same-gateway-message-id',
        external_id: 'same-external-id',
        direction: 'outgoing',
        recipient: '218910000012',
        message: 'رسالة من بنغازي',
        status: 'queued',
    });

    assert.notEqual(first.id, second.id);
    assert.equal(database.prepare(`
        SELECT COUNT(*) AS count FROM sms_messages
        WHERE tenant_id = 1 AND gateway_message_id = 'same-gateway-message-id'
    `).get().count, 2);
    assert.equal(database.prepare(`
        SELECT content FROM sms_messages WHERE sms_account_id = 11
    `).get().content, 'رسالة من طرابلس');
    assert.equal(database.prepare(`
        SELECT content FROM sms_messages WHERE sms_account_id = 12
    `).get().content, 'رسالة من بنغازي');
});

test('signed SMS webhooks are deduplicated and cannot cross account boundaries', (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const webhookKey = '33333333-3333-4333-8333-333333333333';
    const deliveryId = '44444444-4444-4444-8444-444444444444';
    const secret = 'account-three-webhook-secret';
    insertAccount(database, { id: 13, name: 'Gateway 3', key: webhookKey, secret, isDefault: true });
    insertAccount(database, {
        id: 14,
        name: 'Gateway 4',
        key: '55555555-5555-4555-8555-555555555555',
        secret: 'another-secret',
    });

    const envelope = {
        delivery_id: deliveryId,
        event: 'sms.message.received.v1',
        data: {
            message_id: 'incoming-1',
            direction: 'incoming',
            sender: 'BANK-LY',
            message: 'رسالة واردة',
            status: 'received',
        },
    };
    const rawBody = Buffer.from(JSON.stringify(envelope));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = `v1=${crypto.createHmac('sha256', secret)
        .update(`${timestamp}.${deliveryId}.`)
        .update(rawBody)
        .digest('hex')}`;
    const service = new SmsGatewayService({ database });
    const accepted = service.acceptWebhook(webhookKey, { timestamp, deliveryId, signature }, rawBody);

    assert.equal(accepted.tenantId, 1);
    assert.equal(accepted.accountId, 13);
    assert.equal(accepted.duplicate, false);
    assert.equal(accepted.message.sms_account_id, 13);
    assert.equal(accepted.message.sender, 'BANK-LY');
    assert.equal(service.acceptWebhook(
        webhookKey,
        { timestamp, deliveryId, signature },
        rawBody,
    ).duplicate, true);
    assert.equal(database.prepare(`
        SELECT COUNT(*) AS count FROM sms_messages WHERE sms_account_id = 14
    `).get().count, 0);

    assert.throws(
        () => service.acceptWebhook(
            webhookKey,
            { timestamp, deliveryId: '66666666-6666-4666-8666-666666666666', signature },
            rawBody,
        ),
        error => error instanceof SmsGatewayError && error.code === 'SMS_WEBHOOK_SIGNATURE_INVALID',
    );
});
