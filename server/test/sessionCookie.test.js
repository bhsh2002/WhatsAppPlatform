import assert from 'node:assert/strict';
import test from 'node:test';
import {
    SESSION_COOKIE_NAME,
    getSessionCookie,
    getSessionCookieOptions,
    parseCookieHeader,
} from '../security/sessionCookie.js';

test('browser session cookies are HttpOnly, scoped and secure in production', () => {
    assert.deepEqual(getSessionCookieOptions({ production: true, maxAge: 1234 }), {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/api',
        maxAge: 1234,
        priority: 'high',
    });
    assert.equal(getSessionCookieOptions({ production: false }).secure, false);
});

test('session cookie parsing tolerates unrelated and encoded values', () => {
    const cookies = parseCookieHeader('theme=dark; wa_session=header.payload.signature; encoded=a%20b');
    assert.equal(cookies.theme, 'dark');
    assert.equal(cookies.encoded, 'a b');
    assert.equal(cookies[SESSION_COOKIE_NAME], 'header.payload.signature');
    assert.equal(getSessionCookie({ headers: { cookie: 'wa_session=test-token' } }), 'test-token');
});
