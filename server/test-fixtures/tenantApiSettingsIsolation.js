import assert from 'node:assert/strict';
import db from '../db/database.js';
import tenantApiSettingsRouter from '../routes/tenantApiSettings.js';
import { digestApiKey } from '../security/apiKeys.js';
import { decrypt, initEncryption } from '../services/encryption.js';

initEncryption();

const findRouteHandlers = (method, routePath) => {
    const layer = tenantApiSettingsRouter.stack.find(item => (
        item.route?.path === routePath && item.route.methods?.[method]
    ));
    assert.ok(layer, `Missing ${method.toUpperCase()} ${routePath}`);
    return layer.route.stack.map(item => item.handle);
};

const invokeRoute = (method, routePath, request = {}) => new Promise((resolve, reject) => {
    const req = {
        body: {},
        headers: {},
        params: {},
        query: {},
        ...request,
    };
    const res = {
        statusCode: 200,
        body: undefined,
        status(value) {
            this.statusCode = value;
            return this;
        },
        json(value) {
            this.body = value;
            resolve({ req, res: this });
            return this;
        },
    };
    const handlers = findRouteHandlers(method, routePath);
    let index = 0;
    const next = error => {
        if (error) return reject(error);
        if (index >= handlers.length) return resolve({ req, res });
        try {
            Promise.resolve(handlers[index++](req, res, next)).catch(reject);
        } catch (handlerError) {
            reject(handlerError);
        }
    };
    next();
});

const insertTenant = db.prepare(`
    INSERT INTO tenants (name, phone, status)
    VALUES (?, ?, 'Active')
`);
const tenantA = Number(insertTenant.run('API settings A', '+218910004001').lastInsertRowid);
const tenantB = Number(insertTenant.run('API settings B', '+218910004002').lastInsertRowid);
const tenantWithoutSettings = Number(insertTenant.run('API settings empty', '+218910004003').lastInsertRowid);

const requestFor = (tenantId, values = {}) => ({
    user: { tenant_id: tenantId, role: 'user' },
    ...values,
});

const firstA = await invokeRoute('get', '/', requestFor(tenantA));
assert.equal(firstA.res.statusCode, 200);
assert.match(firstA.res.body.api_key, /^wp_[0-9a-f]{64}$/);
assert.equal(firstA.res.body.api_key_visible_once, true);
assert.match(firstA.res.body.webhook_secret, /^[0-9a-f]{64}$/);
assert.equal(firstA.res.body.webhook_secret_visible_once, true);
const initialApiKey = firstA.res.body.api_key;
const initialWebhookSecret = firstA.res.body.webhook_secret;

const storedA = db.prepare('SELECT * FROM tenant_api_settings WHERE tenant_id = ?').get(tenantA);
assert.equal(storedA.api_key, null);
assert.equal(storedA.api_key_hash, digestApiKey(initialApiKey));
assert.notEqual(storedA.webhook_secret, initialWebhookSecret);
assert.equal(decrypt(storedA.webhook_secret), initialWebhookSecret);

const secondA = await invokeRoute('get', '/', requestFor(tenantA));
assert.equal(secondA.res.statusCode, 200);
assert.equal(secondA.res.body.has_api_key, true);
assert.equal(secondA.res.body.has_webhook_secret, true);
assert.equal('api_key' in secondA.res.body, false);
assert.equal('api_key_hash' in secondA.res.body, false);
assert.equal('webhook_secret' in secondA.res.body, false);

const firstB = await invokeRoute('get', '/', requestFor(tenantB));
assert.equal(firstB.res.statusCode, 200);
assert.notEqual(firstB.res.body.api_key, initialApiKey);
assert.notEqual(firstB.res.body.webhook_secret, initialWebhookSecret);
const storedBBefore = db.prepare('SELECT * FROM tenant_api_settings WHERE tenant_id = ?').get(tenantB);

const invalidActivation = await invokeRoute('put', '/', requestFor(tenantA, {
    body: { is_active: 'false' },
}));
assert.equal(invalidActivation.res.statusCode, 400);
assert.equal(invalidActivation.res.body.code, 'INVALID_API_SETTINGS');

const unsafeWebhook = await invokeRoute('put', '/', requestFor(tenantA, {
    body: { webhook_url: 'http://127.0.0.1/internal' },
}));
assert.equal(unsafeWebhook.res.statusCode, 400);
assert.equal(unsafeWebhook.res.body.code, 'UNSAFE_OUTBOUND_URL');

const disabled = await invokeRoute('put', '/', requestFor(tenantA, {
    body: { webhook_url: null, callback_url: null, is_active: false },
}));
assert.equal(disabled.res.statusCode, 200);
assert.equal(disabled.res.body.is_active, 0);

const preservedDisabledState = await invokeRoute('put', '/', requestFor(tenantA, {
    body: {},
}));
assert.equal(preservedDisabledState.res.statusCode, 200);
assert.equal(preservedDisabledState.res.body.is_active, 0);

const regeneratedKey = await invokeRoute('post', '/regenerate-key', requestFor(tenantA));
assert.equal(regeneratedKey.res.statusCode, 200);
assert.match(regeneratedKey.res.body.api_key, /^wp_[0-9a-f]{64}$/);
assert.notEqual(regeneratedKey.res.body.api_key, initialApiKey);
assert.equal(regeneratedKey.res.body.api_key_visible_once, true);
const storedAfterKeyRotation = db.prepare(
    'SELECT api_key, api_key_hash FROM tenant_api_settings WHERE tenant_id = ?'
).get(tenantA);
assert.equal(storedAfterKeyRotation.api_key, null);
assert.equal(storedAfterKeyRotation.api_key_hash, digestApiKey(regeneratedKey.res.body.api_key));

const regeneratedSecret = await invokeRoute('post', '/regenerate-webhook-secret', requestFor(tenantA));
assert.equal(regeneratedSecret.res.statusCode, 200);
assert.match(regeneratedSecret.res.body.webhook_secret, /^[0-9a-f]{64}$/);
assert.notEqual(regeneratedSecret.res.body.webhook_secret, initialWebhookSecret);
assert.equal(regeneratedSecret.res.body.webhook_secret_visible_once, true);
const storedAfterSecretRotation = db.prepare(
    'SELECT webhook_secret FROM tenant_api_settings WHERE tenant_id = ?'
).get(tenantA);
assert.equal(decrypt(storedAfterSecretRotation.webhook_secret), regeneratedSecret.res.body.webhook_secret);

const missingRotation = await invokeRoute('post', '/regenerate-key', requestFor(tenantWithoutSettings));
assert.equal(missingRotation.res.statusCode, 404);

const storedBAfter = db.prepare('SELECT * FROM tenant_api_settings WHERE tenant_id = ?').get(tenantB);
assert.equal(storedBAfter.api_key_hash, storedBBefore.api_key_hash);
assert.equal(storedBAfter.webhook_secret, storedBBefore.webhook_secret);
assert.equal(storedBAfter.is_active, storedBBefore.is_active);

db.close();
console.log(JSON.stringify({
    digestOnlyApiKeys: true,
    encryptedWebhookSecrets: true,
    oneTimeCredentialReveal: true,
    tenantIsolation: true,
    ssrfAndInputValidation: true,
    activationStatePreserved: true,
}));
