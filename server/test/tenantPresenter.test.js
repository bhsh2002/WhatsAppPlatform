import assert from 'node:assert/strict';
import test from 'node:test';
import { presentTenant, presentTenants } from '../presenters/tenant.js';

test('tenant presenter removes plaintext and encrypted credentials', () => {
    const presented = presentTenant({
        id: 1,
        name: 'Tenant',
        phone_number_id: 'phone-id',
        access_token: 'plaintext',
        access_token_encrypted: 'ciphertext',
        webhook_secret: 'webhook-secret',
        facebook_user_access_token_encrypted: 'facebook-ciphertext',
    });

    assert.deepEqual(presented, {
        id: 1,
        name: 'Tenant',
        phone_number_id: 'phone-id',
    });
});

test('tenant presenter handles collections and null values', () => {
    assert.equal(presentTenant(null), null);
    assert.deepEqual(presentTenants([
        { id: 1, access_token: 'secret' },
        { id: 2, name: 'Safe' },
    ]), [{ id: 1 }, { id: 2, name: 'Safe' }]);
});
