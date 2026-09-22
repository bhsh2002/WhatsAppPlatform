import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import Database from 'better-sqlite3';

import { runMigrationsSync } from '../db/migrator.js';
import { initEncryption } from '../services/encryption.js';
import { SmsGatewayError, SmsGatewayService } from '../services/smsGateway.js';

process.env.CRYPTO_KEY = process.env.CRYPTO_KEY || 'c'.repeat(64);
process.env.SMS_GATEWAY_CALLBACK_BASE_URL = 'https://wa.example.test/api/integrations/sms-gateway/events';
initEncryption();

const createDatabase = () => {
    const database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    runMigrationsSync(database);
    database.prepare(`
        INSERT INTO tenants (id, name, status) VALUES (1, 'Managed tenant', 'Active')
    `).run();
    database.prepare(`
        INSERT INTO users (username, email, password_hash, tenant_id, is_active)
        VALUES ('owner', 'owner@example.test', 'unused-hash', 1, 1)
    `).run();
    return database;
};

const managedPayload = (overrides = {}) => ({
    action: 'upsert',
    assignment_id: 'gateway-assignment-0001',
    tenant_email: 'owner@example.test',
    account: {
        name: 'Primary SMS',
        base_url: 'https://sms.example.test',
        api_key: 'dedicated-managed-key',
        default_devices: ['91'],
        default_sim_slot: 0,
        is_default: true,
        managed_resources: {
            devices: [{ id: '91', name: 'Office phone', model: 'SM-A065F' }],
            sim: { slot: 0, name: 'SIM 1', carrier: 'ALMADAR', number: '0910000000' },
        },
    },
    ...overrides,
});

test('managed provisioning is idempotent, tenant-scoped and hides technical credentials', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const requests = [];
    const service = new SmsGatewayService({
        database,
        outboundUrlValidator: async url => url,
        gatewayRequest: async (account, path, options) => {
            requests.push({ account, path, options });
            return path.endsWith('health.php') ? { status: 'ok' } : { data: {} };
        },
    });
    const payload = managedPayload();
    const requestHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const first = await service.acceptProvisioningDelivery({
        deliveryId: 'provision-delivery-0001',
        requestHash,
        payload,
    });
    const duplicate = await service.acceptProvisioningDelivery({
        deliveryId: 'provision-delivery-0001',
        requestHash,
        payload,
    });

    assert.equal(first.success, true);
    assert.equal(first.duplicate, false);
    assert.equal(duplicate.duplicate, true);
    assert.equal(first.account.management_mode, 'managed');
    assert.equal(first.account.managed, true);
    assert.equal(first.account.base_url, undefined);
    assert.equal(first.account.default_devices, undefined);
    assert.deepEqual(first.account.managed_resources, {
        devices: [{ name: 'Office phone', model: 'SM-A065F' }],
        sim: { name: 'SIM 1', carrier: 'ALMADAR', number: '0910000000' },
    });
    assert.equal(requests.filter(item => item.path.endsWith('webhook.php')).length, 1);
    assert.equal(requests.filter(item => item.path.endsWith('health.php')).length, 1);
    assert.equal(database.prepare('SELECT COUNT(*) count FROM sms_gateway_accounts').get().count, 1);
    assert.equal(database.prepare('SELECT COUNT(*) count FROM sms_gateway_management_audit').get().count, 1);

    await assert.rejects(
        () => service.configure(1, { name: 'Hijacked' }, first.account.id),
        error => error instanceof SmsGatewayError && error.code === 'SMS_ACCOUNT_MANAGED',
    );
    await assert.rejects(
        () => service.acceptProvisioningDelivery({
            deliveryId: 'provision-delivery-0001',
            requestHash: 'f'.repeat(64),
            payload,
        }),
        error => error instanceof SmsGatewayError
            && error.code === 'SMS_PROVISION_IDEMPOTENCY_CONFLICT',
    );
});

test('managed provisioning preserves multiple SMS accounts and revocation is repeatable', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const service = new SmsGatewayService({
        database,
        outboundUrlValidator: async url => url,
        gatewayRequest: async (_account, path) => (
            path.endsWith('health.php') ? { status: 'ok' } : { data: {} }
        ),
    });
    const first = await service.provisionManaged(managedPayload());
    const second = await service.provisionManaged(managedPayload({
        assignment_id: 'gateway-assignment-0002',
        account: {
            ...managedPayload().account,
            name: 'Backup SMS',
            api_key: 'another-dedicated-managed-key',
            is_default: false,
        },
    }));

    assert.notEqual(first.account.id, second.account.id);
    assert.equal(service.listAccounts(1).length, 2);
    const revoked = await service.provisionManaged({
        action: 'revoke',
        assignment_id: 'gateway-assignment-0002',
    });
    const repeated = await service.provisionManaged({
        action: 'revoke',
        assignment_id: 'missing-assignment-0003',
    });
    assert.equal(revoked.account.enabled, false);
    assert.equal(revoked.account.status, 'disabled');
    assert.equal(repeated.revoked, true);
});

test('failed managed credential rotation restores the last working WA credential', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const service = new SmsGatewayService({
        database,
        outboundUrlValidator: async url => url,
        gatewayRequest: async (_account, path) => (
            path.endsWith('health.php') ? { status: 'ok' } : { data: {} }
        ),
    });
    const original = await service.provisionManaged(managedPayload());
    const before = service.getAccount(1, original.account.id);
    service.gatewayRequest = async (_account, path) => {
        if (path.endsWith('health.php')) {
            throw new SmsGatewayError('new credential rejected', 401, 'invalid_api_key');
        }
        return { data: {} };
    };

    await assert.rejects(
        () => service.provisionManaged(managedPayload({
            account: { ...managedPayload().account, api_key: 'rotated-managed-key' },
        })),
        error => error.code === 'invalid_api_key',
    );
    const restored = service.getAccount(1, original.account.id);
    assert.equal(restored.api_key_encrypted, before.api_key_encrypted);
    assert.equal(restored.credential_fingerprint, before.credential_fingerprint);
    assert.equal(restored.status, 'active');
    assert.equal(restored.gateway_assignment_id, 'gateway-assignment-0001');
    assert.equal(database.prepare(`
        SELECT status FROM sms_gateway_management_audit ORDER BY id DESC LIMIT 1
    `).get().status, 'error');
});

test('SMS statistics aggregate healthy accounts and identify partial failures', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const gatewayRequest = async (account, path) => {
        assert.match(path, /^services\/v1\/statistics\.php\?/);
        assert.match(path, /(?:\?|&)range=custom(?:&|$)/);
        if (account.name === 'Unavailable') {
            throw new SmsGatewayError('offline', 502, 'SMS_GATEWAY_UNAVAILABLE');
        }
        return {
            data: {
                summary: {
                    pending: 2,
                    sent: 3,
                    delivered: 4,
                    failed: 1,
                    canceled: 0,
                    received: 5,
                    total_outgoing: 10,
                },
                series: [{
                    date: '2026-09-20', pending: 2, sent: 3, delivered: 4,
                    failed: 1, canceled: 0, received: 5, total_outgoing: 10,
                }],
            },
        };
    };
    const service = new SmsGatewayService({ database, gatewayRequest });
    const insert = database.prepare(`
        INSERT INTO sms_gateway_accounts (
            tenant_id, name, base_url, api_key_encrypted, credential_fingerprint,
            webhook_secret_encrypted, webhook_key, enabled, is_default, status
        ) VALUES (1, ?, 'https://sms.example.test', 'encrypted', ?, 'encrypted', ?, 1, ?, 'active')
    `);
    insert.run('Available', 'fingerprint-a', crypto.randomUUID(), 1);
    insert.run('Unavailable', 'fingerprint-b', crypto.randomUUID(), 0);

    const result = await service.stats(1, {
        range: 'custom', from: '2026-09-20', to: '2026-09-20', groupBy: 'day',
    });
    assert.equal(result.partial, true);
    assert.equal(result.available_accounts, 1);
    assert.equal(result.unavailable_accounts, 1);
    assert.equal(result.summary.delivered, 4);
    assert.equal(result.summary.total_outgoing, 10);
    assert.equal(result.series[0].received, 5);
    assert.equal(result.accounts[1].error.code, 'SMS_GATEWAY_UNAVAILABLE');
});

test('SMS history reconciliation imports the latest page, backfills, then advances incrementally', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    database.prepare(`
        INSERT INTO sms_gateway_accounts (
            id, tenant_id, name, base_url, api_key_encrypted, credential_fingerprint,
            webhook_secret_encrypted, webhook_key, enabled, is_default, status
        ) VALUES (
            31, 1, 'History', 'https://sms.example.test', 'encrypted', 'history-fingerprint',
            'encrypted', ?, 1, 1, 'active'
        )
    `).run(crypto.randomUUID());
    const message = id => ({
        message_id: String(id),
        external_id: `external-${id}`,
        direction: 'outgoing',
        recipient: `2189100000${id}`,
        message: `message-${id}`,
        status: id === 4 ? 'delivered' : 'sent',
        sent_at: `2026-09-${String(16 + id).padStart(2, '0')}T10:00:00+02:00`,
    });
    const paths = [];
    const service = new SmsGatewayService({
        database,
        gatewayRequest: async (_account, path) => {
            paths.push(path);
            const query = new URL(`https://gateway.test/${path}`).searchParams;
            if (query.get('after_id') === '3') {
                return {
                    success: true,
                    data: {
                        messages: [message(4)],
                        pagination: {
                            has_more: false, next_after_id: null, sync_cursor: '4',
                        },
                    },
                };
            }
            if (query.get('before_id') === '2') {
                return {
                    success: true,
                    data: {
                        messages: [message(1)],
                        pagination: {
                            has_more: false, next_before_id: null, sync_cursor: '3',
                        },
                    },
                };
            }
            return {
                success: true,
                data: {
                    messages: [message(3), message(2)],
                    pagination: {
                        has_more: true, next_before_id: '2', sync_cursor: '3',
                    },
                },
            };
        },
    });

    const initial = await service.syncHistory(1, 31, {
        incrementalPages: 2, backfillPages: 2, limit: 100,
    });
    assert.equal(initial.imported, 3);
    assert.equal(initial.backfill_complete, true);
    assert.equal(database.prepare('SELECT COUNT(*) count FROM sms_messages').get().count, 3);
    const incremental = await service.syncHistory(1, 31, {
        incrementalPages: 2, backfillPages: 2, limit: 100,
    });
    assert.equal(incremental.imported, 1);
    assert.equal(database.prepare('SELECT COUNT(*) count FROM sms_messages').get().count, 4);
    assert.equal(database.prepare(`
        SELECT history_cursor FROM sms_gateway_accounts WHERE id = 31
    `).get().history_cursor, '4');
    assert.match(paths[0], /services\/v1\/messages\.php\?/);
    assert.match(paths.at(-1), /after_id=3/);
});

test('failed provisioning of a new default account removes it and restores the working default', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const service = new SmsGatewayService({
        database,
        outboundUrlValidator: async url => url,
        gatewayRequest: async (_account, path) => (
            path.endsWith('health.php') ? { status: 'ok' } : { data: {} }
        ),
    });
    const primary = await service.provisionManaged(managedPayload());
    service.gatewayRequest = async (_account, path) => {
        if (path.endsWith('health.php')) {
            const visibleAccounts = service.listAccounts(1);
            assert.equal(visibleAccounts.length, 1);
            assert.equal(visibleAccounts[0].id, primary.account.id);
            assert.equal(visibleAccounts[0].is_default, 1);
            assert.equal(visibleAccounts[0].status, 'active');
            throw new SmsGatewayError('health failed', 502, 'SMS_GATEWAY_UNAVAILABLE');
        }
        return { data: {} };
    };

    await assert.rejects(
        () => service.provisionManaged(managedPayload({
            assignment_id: 'gateway-assignment-new-default',
            account: {
                ...managedPayload().account,
                name: 'Broken default',
                api_key: 'broken-default-key',
            },
        })),
        error => error.code === 'SMS_GATEWAY_UNAVAILABLE',
    );
    const accounts = service.listAccounts(1);
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].id, primary.account.id);
    assert.equal(accounts[0].is_default, 1);
    assert.equal(accounts[0].status, 'active');
});

test('managed account adoption preserves the WA row and its existing message history', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const service = new SmsGatewayService({
        database,
        outboundUrlValidator: async url => url,
        gatewayRequest: async (_account, path) => (
            path.endsWith('health.php') ? { status: 'ok' } : { data: {} }
        ),
    });
    const manual = await service.configure(1, {
        name: 'Savana',
        base_url: 'https://sms.example.test',
        api_key: 'legacy-manual-key',
        default_devices: ['91'],
        default_sim_slot: 0,
        is_default: true,
    });
    const manualAccount = service.getAccount(1, manual.id);
    service.storeMessage(manualAccount, {
        message_id: 'legacy-message-1',
        external_id: 'legacy-external-1',
        direction: 'outgoing',
        recipient: '218910000001',
        message: 'Existing history',
        status: 'delivered',
    });

    const adopted = await service.provisionManaged(managedPayload({
        account: {
            ...managedPayload().account,
            name: 'Savana',
            existing_wa_account_id: manual.id,
        },
    }));
    assert.equal(adopted.account.id, manual.id);
    assert.equal(adopted.account.management_mode, 'managed');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sms_gateway_accounts').get().count, 1);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sms_messages').get().count, 1);
});

test('stale provisioning deliveries are reclaimed while active deliveries remain locked', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const service = new SmsGatewayService({ database });
    let calls = 0;
    service.provisionManaged = async payload => {
        calls += 1;
        return { success: true, assignment_id: payload.assignment_id };
    };
    const payload = managedPayload();
    const hash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    database.prepare(`
        INSERT INTO sms_gateway_provision_deliveries (
            delivery_id, request_hash, assignment_id, action, status
        ) VALUES (?, ?, ?, 'upsert', 'processing')
    `).run('stale-delivery-0001', hash, payload.assignment_id);
    database.prepare(`
        UPDATE sms_gateway_provision_deliveries
        SET created_at = datetime(created_at, '-3 minutes')
        WHERE delivery_id = 'stale-delivery-0001'
    `).run();

    const recovered = await service.acceptProvisioningDelivery({
        deliveryId: 'stale-delivery-0001',
        requestHash: hash,
        payload,
    });
    assert.equal(recovered.success, true);
    assert.equal(calls, 1);

    database.prepare(`
        INSERT INTO sms_gateway_provision_deliveries (
            delivery_id, request_hash, assignment_id, action, status
        ) VALUES (?, ?, ?, 'upsert', 'processing')
    `).run('active-delivery-0002', hash, payload.assignment_id);
    await assert.rejects(
        () => service.acceptProvisioningDelivery({
            deliveryId: 'active-delivery-0002',
            requestHash: hash,
            payload,
        }),
        error => error.code === 'SMS_PROVISION_IN_PROGRESS',
    );
});

test('case-insensitive duplicate tenant emails are rejected as ambiguous', (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    database.prepare("INSERT INTO tenants (id, name, status) VALUES (2, 'Other tenant', 'Active')").run();
    database.prepare(`
        INSERT INTO users (username, email, password_hash, tenant_id, is_active)
        VALUES ('other-owner', 'OWNER@example.test', 'unused-hash', 2, 1)
    `).run();
    const service = new SmsGatewayService({ database });

    assert.throws(
        () => service.resolveProvisioningTenant({ tenant_email: 'owner@example.test' }),
        error => error.code === 'TENANT_REFERENCE_AMBIGUOUS',
    );
});

test('managed routing cannot be overridden and tenant presenters hide technical ids', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const service = new SmsGatewayService({
        database,
        outboundUrlValidator: async url => url,
        gatewayRequest: async (_account, path) => (
            path.endsWith('health.php') ? { status: 'ok' } : { data: {} }
        ),
    });
    const provisioned = await service.provisionManaged(managedPayload());
    const account = service.getAccount(1, provisioned.account.id);

    await assert.rejects(
        () => service.send(1, {
            accountId: account.id,
            recipient: '218910000001',
            message: 'No override',
            idempotencyKey: 'managed-routing-0001',
            devices: ['999'],
        }),
        error => error.code === 'SMS_MANAGED_ROUTING_OVERRIDE',
    );
    await assert.rejects(
        () => service.sendUssd(1, {
            accountId: account.id,
            request: '*100#',
            idempotencyKey: 'managed-routing-0002',
            deviceId: '999',
        }),
        error => error.code === 'SMS_MANAGED_ROUTING_OVERRIDE',
    );
    assert.deepEqual(service.presentMessage({
        tenant_id: 1,
        sms_account_id: account.id,
        device_id: '91',
        sim_slot: 0,
        status: 'sent',
    }, { account }), {
        tenant_id: 1,
        sms_account_id: account.id,
        status: 'sent',
    });
});

test('SMS status storage is monotonic when Gateway deliveries arrive out of order', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const service = new SmsGatewayService({
        database,
        outboundUrlValidator: async url => url,
        gatewayRequest: async (_account, path) => (
            path.endsWith('health.php') ? { status: 'ok' } : { data: {} }
        ),
    });
    const provisioned = await service.provisionManaged(managedPayload());
    const account = service.getAccount(1, provisioned.account.id);
    service.storeMessage(account, {
        message_id: 'monotonic-1',
        external_id: 'monotonic-external-1',
        direction: 'outgoing',
        recipient: '218910000001',
        message: 'Status test',
        status: 'delivered',
        delivered_at: '2026-09-20T09:05:00Z',
    });
    const stored = service.storeMessage(account, {
        message_id: 'monotonic-1',
        external_id: 'monotonic-external-1',
        direction: 'outgoing',
        recipient: '218910000001',
        message: 'Status test',
        status: 'sent',
        delivered_at: null,
    });
    assert.equal(stored.status, 'delivered');
    assert.equal(stored.delivered_at, '2026-09-20T09:05:00Z');
});

test('empty history keeps a null cursor and never sends after_id=0', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    database.prepare(`
        INSERT INTO sms_gateway_accounts (
            id, tenant_id, name, base_url, api_key_encrypted, credential_fingerprint,
            webhook_secret_encrypted, webhook_key, enabled, is_default, status
        ) VALUES (
            41, 1, 'Empty history', 'https://sms.example.test', 'encrypted',
            'empty-history-fingerprint', 'encrypted', ?, 1, 1, 'active'
        )
    `).run(crypto.randomUUID());
    const paths = [];
    const service = new SmsGatewayService({
        database,
        gatewayRequest: async (_account, path) => {
            paths.push(path);
            return {
                data: {
                    messages: [],
                    pagination: { has_more: false, sync_cursor: '0', next_before_id: null },
                },
            };
        },
    });
    await service.syncHistory(1, 41);
    await service.syncHistory(1, 41);
    assert.equal(service.getAccount(1, 41).history_cursor, null);
    assert.ok(paths.every(path => !path.includes('after_id=0')));
});
