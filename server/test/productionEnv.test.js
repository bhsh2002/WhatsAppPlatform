import assert from 'node:assert/strict';
import test from 'node:test';

import { validateProductionEnv } from '../config/productionEnv.js';

const validEnvironment = () => ({
    NODE_ENV: 'production',
    JWT_SECRET: 'j'.repeat(48),
    CRYPTO_KEY: 'a'.repeat(64),
    METRICS_TOKEN: 'm'.repeat(48),
    WEBHOOK_VERIFY_TOKEN: 'w'.repeat(48),
    META_APP_ID: '1234567890',
    META_APP_SECRET: 'p'.repeat(48),
    META_WEBHOOK_CALLBACK_URL: 'https://wa.savana.ly/api/webhook',
    FACEBOOK_REDIRECT_URI: 'https://wa.savana.ly/auth/facebook/callback',
    WA_EMBEDDED_SIGNUP_CONFIG_ID: '9876543210',
    PUBLIC_APP_URL: 'https://wa.savana.ly',
    CORS_ORIGINS: 'https://wa.savana.ly',
    SMS_GATEWAY_CALLBACK_BASE_URL: 'https://wa.savana.ly/api/integrations/sms-gateway/events',
    SMS_GATEWAY_PROVISIONING_SECRET: 'g'.repeat(48),
    SAVANA_INTEGRATIONS_ENABLED: 'false',
});

test('production environment accepts the canonical Wa Savana endpoints', () => {
    assert.doesNotThrow(() => validateProductionEnv(validEnvironment()));
});

test('non-production runtime keeps optional local settings', () => {
    assert.doesNotThrow(() => validateProductionEnv({ NODE_ENV: 'test' }));
});

test('production environment rejects missing and reused secrets without exposing values', () => {
    const environment = validEnvironment();
    environment.METRICS_TOKEN = environment.JWT_SECRET;
    delete environment.META_APP_SECRET;

    assert.throws(
        () => validateProductionEnv(environment),
        error => {
            assert.match(error.message, /META_APP_SECRET/);
            assert.match(error.message, /must be distinct/);
            assert.doesNotMatch(error.message, new RegExp(environment.JWT_SECRET));
            return true;
        },
    );
});

test('production environment rejects HTTP, foreign-origin and incorrect callback routes', () => {
    const environment = validEnvironment();
    environment.CORS_ORIGINS = 'http://wa.savana.ly';
    environment.META_WEBHOOK_CALLBACK_URL = 'https://other.example/api/webhook';
    environment.FACEBOOK_REDIRECT_URI = 'https://wa.savana.ly/api/auth/facebook/callback';
    environment.SMS_GATEWAY_CALLBACK_BASE_URL = 'https://wa.savana.ly/api/sms';

    assert.throws(
        () => validateProductionEnv(environment),
        error => {
            assert.match(error.message, /CORS_ORIGINS entry 1 must use HTTPS/);
            assert.match(error.message, /META_WEBHOOK_CALLBACK_URL must use the PUBLIC_APP_URL origin/);
            assert.match(error.message, /FACEBOOK_REDIRECT_URI must end with/);
            assert.match(error.message, /SMS_GATEWAY_CALLBACK_BASE_URL must end with/);
            return true;
        },
    );
});
