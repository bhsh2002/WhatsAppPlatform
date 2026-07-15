import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import db from '../db/database.js';
import { createTenantContactsRouter } from '../routes/tenantContacts.js';

const cleanedImports = [];
const tenantContactsRouter = createTenantContactsRouter({
    database: db,
    csvUploadMiddleware: (req, res, next) => next(),
    cleanupUploadedFile: value => cleanedImports.push(value),
});

const findRouteHandlers = (method, routePath) => {
    const layer = tenantContactsRouter.stack.find(item => (
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
        headers: {},
        status(value) {
            this.statusCode = value;
            return this;
        },
        json(value) {
            this.body = value;
            resolve({ req, res: this });
            return this;
        },
        set(values) {
            Object.assign(this.headers, values);
            return this;
        },
        send(value) {
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
const tenantA = Number(insertTenant.run('Contacts tenant A', '+218910005001').lastInsertRowid);
const tenantB = Number(insertTenant.run('Contacts tenant B', '+218910005002').lastInsertRowid);
const requestFor = (tenantId, values = {}) => ({
    user: { tenant_id: tenantId, role: 'user' },
    ...values,
});

const createdA = await invokeRoute('post', '/', requestFor(tenantA, {
    body: {
        phone: '+218 91-111-2222',
        profile_name: '  Shared customer A  ',
        label: ' VIP ',
        notes: '  Initial notes  ',
    },
}));
assert.equal(createdA.res.statusCode, 201);
assert.equal(createdA.res.body.phone, '218911112222');
assert.equal(createdA.res.body.profile_name, 'Shared customer A');
assert.equal(createdA.res.body.tenant_id, tenantA);
const contactA = Number(createdA.res.body.id);

const duplicateA = await invokeRoute('post', '/', requestFor(tenantA, {
    body: { phone: '218-911-112-222', profile_name: 'Duplicate' },
}));
assert.equal(duplicateA.res.statusCode, 409);

const createdB = await invokeRoute('post', '/', requestFor(tenantB, {
    body: { phone: '218911112222', profile_name: 'Shared customer B', label: 'Supplier' },
}));
assert.equal(createdB.res.statusCode, 201);
const contactB = Number(createdB.res.body.id);

const invalidPhone = await invokeRoute('post', '/', requestFor(tenantA, {
    body: { phone: '123' },
}));
assert.equal(invalidPhone.res.statusCode, 400);
assert.equal(invalidPhone.res.body.code, 'INVALID_CONTACT');

const emptyUpdate = await invokeRoute('put', '/:id', requestFor(tenantA, {
    params: { id: String(contactA) },
    body: {},
}));
assert.equal(emptyUpdate.res.statusCode, 400);

const hiddenUpdate = await invokeRoute('put', '/:id', requestFor(tenantA, {
    params: { id: String(contactB) },
    body: { label: 'Cross-tenant' },
}));
assert.equal(hiddenUpdate.res.statusCode, 404);

const hiddenDelete = await invokeRoute('delete', '/:id', requestFor(tenantA, {
    params: { id: String(contactB) },
}));
assert.equal(hiddenDelete.res.statusCode, 404);

const malformedId = await invokeRoute('delete', '/:id', requestFor(tenantA, {
    params: { id: 'not-an-id' },
}));
assert.equal(malformedId.res.statusCode, 400);

const updatedA = await invokeRoute('put', '/:id', requestFor(tenantA, {
    params: { id: String(contactA) },
    body: { label: 'Customer', notes: 'Updated notes' },
}));
assert.equal(updatedA.res.statusCode, 200);
assert.equal(updatedA.res.body.label, 'Customer');
assert.equal(updatedA.res.body.notes, 'Updated notes');

const clearedA = await invokeRoute('put', '/:id', requestFor(tenantA, {
    params: { id: String(contactA) },
    body: { label: null },
}));
assert.equal(clearedA.res.statusCode, 200);
assert.equal(clearedA.res.body.label, null);

const createAContact = async (phone, profileName, label) => {
    const response = await invokeRoute('post', '/', requestFor(tenantA, {
        body: { phone, profile_name: profileName, label },
    }));
    assert.equal(response.res.statusCode, 201);
    return response.res.body;
};
await createAContact('218922223333', 'Second A', 'Customer');
await createAContact('218933334444', 'Third A', 'Support');

const insertMessage = db.prepare(`
    INSERT INTO messages (tenant_id, direction, sender, recipient, message_type, content, status)
    VALUES (?, 'incoming', ?, NULL, 'text', ?, 'received')
`);
insertMessage.run(tenantA, '218911112222', 'Tenant A message 1');
insertMessage.run(tenantA, '218911112222', 'Tenant A message 2');
insertMessage.run(tenantB, '218911112222', 'Tenant B message');

const pageOne = await invokeRoute('get', '/', requestFor(tenantA, {
    query: { page: '1', limit: '2' },
}));
assert.equal(pageOne.res.statusCode, 200);
assert.equal(pageOne.res.body.total, 3);
assert.equal(pageOne.res.body.contacts.length, 2);
assert.ok(pageOne.res.body.contacts.every(contact => contact.tenant_id === tenantA));
assert.ok(pageOne.res.body.contacts.every(contact => !('last_ctwa_source_url' in contact)));

const searchA = await invokeRoute('get', '/', requestFor(tenantA, {
    query: { search: 'Shared customer A' },
}));
assert.equal(searchA.res.body.total, 1);
assert.equal(searchA.res.body.contacts[0].id, contactA);
assert.equal(searchA.res.body.contacts[0].message_count, 2);

const tenantBList = await invokeRoute('get', '/', requestFor(tenantB));
assert.equal(tenantBList.res.body.total, 1);
assert.equal(tenantBList.res.body.contacts[0].id, contactB);
assert.equal(tenantBList.res.body.contacts[0].message_count, 1);

const importDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-contact-import-'));
const importPath = path.join(importDirectory, 'contacts.csv');
fs.writeFileSync(importPath, [
    'phone,profile_name,label,notes',
    '218922223333,Updated second,Customer,Imported update',
    '218944445555,Imported fourth,Lead,Imported create',
].join('\n'));
const imported = await invokeRoute('post', '/import', requestFor(tenantA, {
    file: { path: importPath },
}));
assert.equal(imported.res.statusCode, 200);
assert.deepEqual(imported.res.body, {
    imported: 2,
    created: 1,
    updated: 1,
    failed: 0,
    errors: [],
});
assert.deepEqual(cleanedImports, [importPath]);
assert.equal(db.prepare("SELECT profile_name FROM contacts WHERE tenant_id = ? AND phone = '218922223333'").get(tenantA).profile_name, 'Updated second');
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM contacts WHERE tenant_id = ? AND phone = '218944445555'").get(tenantB).count, 0);

const exported = await invokeRoute('get', '/export', requestFor(tenantA));
assert.equal(exported.res.statusCode, 200);
assert.match(exported.res.headers['Content-Type'], /text\/csv/);
assert.match(exported.res.body, /Imported fourth/);
assert.doesNotMatch(exported.res.body, /Shared customer B/);
fs.rmSync(importDirectory, { recursive: true, force: true });

const deletedA = await invokeRoute('delete', '/:id', requestFor(tenantA, {
    params: { id: String(contactA) },
}));
assert.equal(deletedA.res.statusCode, 200);
assert.equal(db.prepare('SELECT COUNT(*) count FROM contacts WHERE id = ?').get(contactA).count, 0);
assert.equal(db.prepare('SELECT COUNT(*) count FROM contacts WHERE id = ?').get(contactB).count, 1);

db.close();
console.log(JSON.stringify({
    normalizedAndBoundedInputs: true,
    atomicDuplicatePrevention: true,
    tenantCrudIsolation: true,
    scopedMessageCounts: true,
    paginationAndSearch: true,
    responseAllowlist: true,
    csvImportExportIsolation: true,
}));
