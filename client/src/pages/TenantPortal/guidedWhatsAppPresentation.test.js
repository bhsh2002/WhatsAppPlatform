import assert from 'node:assert/strict';
import test from 'node:test';
import { guidedWhatsAppAuthorizationUrl, guidedWhatsAppChoice, guidedWhatsAppPopupMessage, guidedWhatsAppReviewKey, guidedWhatsAppStatusIsValid, matchMetaOAuthPopup, whatsappNumberDisplayName } from './guidedWhatsAppPresentation.js';

const now = Date.parse('2026-11-18T12:00:00Z');
const expires = new Date(now + 600_000).toISOString();
const status = (stage = 'phone') => ({ stage, configured: true, expires_at: expires,
    choices: ['business', 'account', 'phone'].includes(stage) ? [{ value: 'server-only-choice', label: 'المتجر الرئيسي', detail: '+218 91 000 0000' }] : [],
    connection: { connected: false, numbers: [] }, next_action: { code: 'choose_phone', label: 'اختر الرقم', href: '/portal/integrations' }, webhook_status: 'not_checked' });
const authUrl = (origin = 'https://workspace.test', host = 'https://www.facebook.com') => {
    const url = new URL(`${host}/v25.0/dialog/oauth`);
    url.searchParams.set('client_id', 'public-app'); url.searchParams.set('redirect_uri', `${origin}/auth/facebook/callback`);
    url.searchParams.set('response_type', 'code'); url.searchParams.set('state', 'server-pending-state');
    return url;
};

test('named current server choices are required; empty asset lists stay empty without an ID fallback', () => {
    const document = status();
    assert.equal(guidedWhatsAppStatusIsValid(document, now), true);
    assert.equal(guidedWhatsAppChoice(document, 'server-only-choice', 'phone', now)?.label, 'المتجر الرئيسي');
    assert.equal(guidedWhatsAppChoice(document, 'manual-provider-id', 'phone', now), null);
    assert.equal(guidedWhatsAppChoice(document, 'server-only-choice', 'account', now), null);
    const empty = { ...document, choices: [], next_action: { ...document.next_action, code: 'restart_authorization', label: 'أكمل إعداد الرقم لدى Meta' } };
    assert.equal(guidedWhatsAppStatusIsValid(empty, now), true);
    assert.equal(guidedWhatsAppChoice(empty, 'server-only-choice', 'phone', now), null);
    assert.equal(guidedWhatsAppStatusIsValid({ ...document, choices: [{ value: 'raw-id', detail: '' }] }, now), false);
    assert.equal(guidedWhatsAppStatusIsValid(document, now + 600_000), false);
    assert.equal(guidedWhatsAppChoice(document, 'server-only-choice', 'phone', now + 600_000), null);
    assert.notEqual(guidedWhatsAppReviewKey(document), guidedWhatsAppReviewKey({ ...document, choices: [{ ...document.choices[0], label: 'رقم آخر' }] }));
});

test('stored credentials, setup expiry and webhook acknowledgement remain separate facts', () => {
    for (const webhook_status of ['confirmed', 'unknown', 'not_checked']) {
        const value = { ...status('connected'), connection: { connected: true, numbers: [{ label: 'رقم المبيعات', is_default: true }] }, webhook_status };
        assert.equal(guidedWhatsAppStatusIsValid(value, now), true);
        assert.equal(guidedWhatsAppStatusIsValid({ ...value, stage: 'expired', expires_at: new Date(now - 1).toISOString() }, now), true);
    }
    assert.equal(guidedWhatsAppStatusIsValid(status('connected'), now), false);
    assert.equal(guidedWhatsAppStatusIsValid({ ...status(), access_token: 'never-public' }, now), false);
    assert.equal(guidedWhatsAppStatusIsValid({ ...status(), webhook_status: 'ready_to_send' }, now), false);
});

test('authorization opens only the owned Meta OAuth route with exact callback and state', () => {
    const expected = { appOrigin: 'https://workspace.test', state: 'server-pending-state' };
    const url = authUrl();
    assert.equal(guidedWhatsAppAuthorizationUrl(url.href, expected), url.href);
    for (const mutate of [
        value => { value.hostname = 'facebook.com.evil.test'; },
        value => { value.username = 'user'; },
        value => { value.hash = '#code'; },
        value => { value.pathname = '/login'; },
        value => { value.searchParams.set('redirect_uri', 'https://external.test/auth/facebook/callback'); },
        value => { value.searchParams.set('redirect_uri', 'https://workspace.test/auth/facebook/callback?next=evil'); },
        value => { value.searchParams.set('state', 'other-pending-state'); },
        value => { value.searchParams.append('state', 'duplicate'); },
        value => { value.searchParams.set('response_type', 'token'); },
        value => { value.searchParams.set('access_token', 'never-browser'); },
        value => { value.searchParams.set('client_secret', 'never-browser'); },
    ]) { const altered = new URL(url); mutate(altered); assert.equal(guidedWhatsAppAuthorizationUrl(altered.href, expected), null); }
    const local = authUrl('http://127.0.0.1:5000', 'http://127.0.0.1:5001');
    assert.equal(guidedWhatsAppAuthorizationUrl(local.href, { appOrigin: 'http://127.0.0.1:5000', state: expected.state }), local.href);
    assert.equal(guidedWhatsAppAuthorizationUrl(local.href, expected), null);
});

test('same-origin unrelated popups, wrong states, expired attempts and legacy listener cross-consumption are rejected', () => {
    const popup = {}, otherPopup = {};
    const event = { origin: 'https://workspace.test', source: popup, data: { type: 'FB_OAUTH_CALLBACK', code: 'single-use-code', state: 'guided-state' } };
    const pending = { event, origin: event.origin, popup, state: 'guided-state', expiresAt: expires, now };
    assert.deepEqual(guidedWhatsAppPopupMessage(pending), { kind: 'complete', code: 'single-use-code', state: 'guided-state' });
    assert.equal(matchMetaOAuthPopup({ ...pending, popup: otherPopup, state: 'facebook-state' }), false);
    assert.equal(guidedWhatsAppPopupMessage({ ...pending, event: { ...event, source: otherPopup } }), null);
    assert.equal(guidedWhatsAppPopupMessage({ ...pending, event: { ...event, origin: 'https://external.test' } }), null);
    assert.equal(guidedWhatsAppPopupMessage({ ...pending, state: 'older-guided-state' }), null);
    assert.equal(guidedWhatsAppPopupMessage({ ...pending, now: now + 600_000 }), null);
    assert.equal(guidedWhatsAppPopupMessage({ ...pending, event: { ...event, data: { ...event.data, code: '' } } }), null);
    assert.deepEqual(guidedWhatsAppPopupMessage({ ...pending, event: { ...event, data: { type: 'FB_OAUTH_ERROR', state: 'guided-state', error_description: 'unsafe provider detail' } } }), { kind: 'error' });
});

test('number management never renders an internal provider identifier as a missing name', () => {
    assert.equal(whatsappNumberDisplayName({ phone_number_id: '1234567890', waba_id: '0987654321' }), null);
    assert.equal(whatsappNumberDisplayName({ label: 'المبيعات', phone_number_id: '1234567890' }), 'المبيعات');
    assert.equal(whatsappNumberDisplayName({ verified_name: 'متجر المدينة' }), 'متجر المدينة');
    assert.equal(whatsappNumberDisplayName({ display_phone_number: '+218 91 000 0000' }), '+218 91 000 0000');
});
