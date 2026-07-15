import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import db from '../db/database.js';
import authRouter, { sseAuth } from '../routes/auth.js';
import { adminMiddleware, authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';

const findRouteHandlers = (method, routePath) => {
    const layer = authRouter.stack.find(item => (
        item.route?.path === routePath && item.route.methods?.[method]
    ));
    assert.ok(layer, `Missing ${method.toUpperCase()} ${routePath}`);
    return layer.route.stack.map(item => item.handle);
};

const invokeHandlers = (handlers, request = {}) => new Promise((resolve, reject) => {
    const req = {
        body: {},
        headers: {},
        query: {},
        params: {},
        ...request,
    };
    const response = {
        statusCode: 200,
        body: undefined,
        cookies: [],
        clearedCookies: [],
        status(value) {
            this.statusCode = value;
            return this;
        },
        json(value) {
            this.body = value;
            resolve({ req, res: this, nextCalled: false });
            return this;
        },
        cookie(name, value, options) {
            this.cookies.push({ name, value, options });
            return this;
        },
        clearCookie(name, options) {
            this.clearedCookies.push({ name, options });
            return this;
        },
    };
    let index = 0;
    const next = error => {
        if (error) return reject(error);
        if (index >= handlers.length) {
            return resolve({ req, res: response, nextCalled: true });
        }
        const handler = handlers[index++];
        try {
            Promise.resolve(handler(req, response, next)).catch(reject);
        } catch (handlerError) {
            reject(handlerError);
        }
    };
    next();
});

const invokeRoute = (method, routePath, request) => (
    invokeHandlers(findRouteHandlers(method, routePath), request)
);

const bearer = token => ({ authorization: `Bearer ${token}` });
const sessionCookie = response => {
    const cookie = response.cookies.find(item => item.name === 'wa_session');
    assert.ok(cookie, 'Expected an HttpOnly session cookie');
    return { cookie: `${cookie.name}=${encodeURIComponent(cookie.value)}` };
};

const password = 'ValidPassword!123';
const replacementPassword = 'ReplacementPassword!456';
const passwordHash = await bcrypt.hash(password, 4);

const activeTenantId = Number(db.prepare(`
    INSERT INTO tenants (name, phone, status)
    VALUES ('Active tenant', '+218910000101', 'Active')
`).run().lastInsertRowid);
const pendingTenantId = Number(db.prepare(`
    INSERT INTO tenants (name, phone, status)
    VALUES ('Pending tenant', '+218910000102', 'Pending')
`).run().lastInsertRowid);

const insertUser = db.prepare(`
    INSERT INTO users (username, password_hash, name, role, tenant_id, is_active)
    VALUES (?, ?, ?, ?, ?, 1)
`);
const adminId = Number(insertUser.run('fixture-admin', passwordHash, 'Fixture admin', 'admin', null).lastInsertRowid);
const tenantUserId = Number(insertUser.run(
    'fixture-tenant', passwordHash, 'Fixture tenant', 'user', activeTenantId
).lastInsertRowid);
const pendingUserId = Number(insertUser.run(
    'fixture-pending', passwordHash, 'Fixture pending', 'user', pendingTenantId
).lastInsertRowid);

const login = async (username, suppliedPassword = password) => invokeRoute('post', '/login', {
    body: { username, password: suppliedPassword },
});

const adminLogin = await login('fixture-admin');
assert.equal(adminLogin.res.statusCode, 200);
assert.equal(adminLogin.res.body.user.password_hash, undefined);
assert.ok(adminLogin.res.body.token);
assert.equal(adminLogin.res.cookies[0].options.httpOnly, true);
assert.equal(adminLogin.res.cookies[0].options.sameSite, 'lax');
assert.equal(adminLogin.res.cookies[0].options.path, '/api');
assert.equal((await invokeRoute('get', '/me', {
    headers: sessionCookie(adminLogin.res),
})).res.statusCode, 200);
const anonymousSession = await invokeRoute('get', '/session');
assert.equal(anonymousSession.res.statusCode, 200);
assert.deepEqual(anonymousSession.res.body, {
    authenticated: false,
    user: null,
    tenant: null,
});
const authenticatedSession = await invokeRoute('get', '/session', {
    headers: sessionCookie(adminLogin.res),
});
assert.equal(authenticatedSession.res.statusCode, 200);
assert.equal(authenticatedSession.res.body.authenticated, true);
assert.equal(authenticatedSession.res.body.user.id, adminId);

const tenantLogin = await login('fixture-tenant');
assert.equal(tenantLogin.res.statusCode, 200);
assert.equal(tenantLogin.res.body.tenant.id, activeTenantId);
assert.ok(tenantLogin.res.body.token);

// Logout revokes the exact JWT and the real auth middleware rejects it afterward.
const logout = await invokeRoute('post', '/logout', {
    headers: sessionCookie(tenantLogin.res),
});
assert.equal(logout.res.statusCode, 200);
assert.equal(logout.res.clearedCookies[0].name, 'wa_session');
const revokedMe = await invokeRoute('get', '/me', {
    headers: bearer(tenantLogin.res.body.token),
});
assert.equal(revokedMe.res.statusCode, 401);
const revokedSession = await invokeRoute('get', '/session', {
    headers: bearer(tenantLogin.res.body.token),
});
assert.equal(revokedSession.res.statusCode, 200);
assert.equal(revokedSession.res.body.authenticated, false);

// Password change revokes the old token, returns a usable replacement, and changes login credentials.
const passwordLogin = await login('fixture-tenant');
const changed = await invokeRoute('post', '/change-password', {
    headers: sessionCookie(passwordLogin.res),
    body: { currentPassword: password, newPassword: replacementPassword },
});
assert.equal(changed.res.statusCode, 200);
assert.ok(changed.res.body.token);

const oldTokenMe = await invokeRoute('get', '/me', {
    headers: bearer(passwordLogin.res.body.token),
});
assert.equal(oldTokenMe.res.statusCode, 401);
const newTokenMe = await invokeRoute('get', '/me', {
    headers: sessionCookie(changed.res),
});
assert.equal(newTokenMe.res.statusCode, 200);
assert.equal(newTokenMe.res.body.user.id, tenantUserId);
assert.equal((await login('fixture-tenant', password)).res.statusCode, 401);
assert.equal((await login('fixture-tenant', replacementPassword)).res.statusCode, 200);

// A legacy Bearer token is rotated into a cookie and cannot be reused afterward.
const legacyLogin = await login('fixture-tenant', replacementPassword);
const upgradedSession = await invokeRoute('post', '/session', {
    headers: bearer(legacyLogin.res.body.token),
});
assert.equal(upgradedSession.res.statusCode, 200);
assert.equal((await invokeRoute('get', '/me', {
    headers: bearer(legacyLogin.res.body.token),
})).res.statusCode, 401);
assert.equal((await invokeRoute('get', '/me', {
    headers: sessionCookie(upgradedSession.res),
})).res.statusCode, 200);

// SSE credentials are short-lived, one-time tokens; ordinary JWT query values are rejected.
const sseTokenResponse = await invokeRoute('post', '/sse-token', {
    headers: sessionCookie(upgradedSession.res),
});
assert.equal(sseTokenResponse.res.statusCode, 200);
const sseAccess = await invokeHandlers([sseAuth], {
    query: { token: sseTokenResponse.res.body.token },
});
assert.equal(sseAccess.nextCalled, true);
assert.equal((await invokeHandlers([sseAuth], {
    query: { token: sseTokenResponse.res.body.token },
})).res.statusCode, 401);
assert.equal((await invokeHandlers([sseAuth], {
    query: { token: changed.res.body.token },
})).res.statusCode, 401);

// A demoted admin token must immediately lose admin privileges despite its stale JWT role.
db.prepare("UPDATE users SET role = 'user', tenant_id = ? WHERE id = ?").run(activeTenantId, adminId);
const demoted = await invokeHandlers([authMiddleware, adminMiddleware], {
    headers: bearer(adminLogin.res.body.token),
});
assert.equal(demoted.res.statusCode, 403);
assert.equal(demoted.req.user.role, 'user');
assert.equal(demoted.req.user.tenant_id, activeTenantId);

// Tenant policy accepts active/warning tenants and blocks admin or non-approved states.
const activeTenantAccess = await invokeHandlers([authMiddleware, tenantMiddleware], {
    headers: bearer(changed.res.body.token),
});
assert.equal(activeTenantAccess.nextCalled, true);

db.prepare("UPDATE tenants SET status = 'Warning' WHERE id = ?").run(activeTenantId);
const warningTenantAccess = await invokeHandlers([authMiddleware, tenantMiddleware], {
    headers: bearer(changed.res.body.token),
});
assert.equal(warningTenantAccess.nextCalled, true);

db.prepare("UPDATE tenants SET status = 'Suspended' WHERE id = ?").run(activeTenantId);
const suspendedTenantAccess = await invokeHandlers([authMiddleware, tenantMiddleware], {
    headers: bearer(changed.res.body.token),
});
assert.equal(suspendedTenantAccess.res.statusCode, 403);
assert.equal(suspendedTenantAccess.res.body.code, 'ACCOUNT_SUSPENDED');

const pendingLogin = await login('fixture-pending');
const pendingTenantAccess = await invokeHandlers([authMiddleware, tenantMiddleware], {
    headers: bearer(pendingLogin.res.body.token),
});
assert.equal(pendingTenantAccess.res.statusCode, 403);
assert.equal(pendingTenantAccess.res.body.code, 'ACCOUNT_PENDING');

// Restore admin in the database and prove tenant-only policy still rejects the current admin identity.
db.prepare("UPDATE users SET role = 'admin', tenant_id = NULL WHERE id = ?").run(adminId);
const adminTenantAccess = await invokeHandlers([authMiddleware, tenantMiddleware], {
    headers: bearer(adminLogin.res.body.token),
});
assert.equal(adminTenantAccess.res.statusCode, 403);

console.log(JSON.stringify({
    logoutRevocation: true,
    passwordRotation: true,
    httpOnlySession: true,
    legacySessionUpgrade: true,
    oneTimeSseToken: true,
    currentRoleEnforcement: true,
    tenantStatusPolicy: true,
    publicSessionProbe: true,
}));
process.exit(0);
