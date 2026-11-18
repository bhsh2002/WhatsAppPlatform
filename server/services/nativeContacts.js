import { normalizeContactCreate, normalizeContactUpdate, parseContactId } from './contactValidation.js';

export class NativeContactError extends Error {
    constructor(code, status) { super(code); this.code = code; this.status = status; }
}
const fail = (code, status) => { throw new NativeContactError(code, status); };
export const NATIVE_CONTACT_COLUMNS = 'id,tenant_id,phone,profile_name,profile_picture_url,label,notes,last_customer_message_at,last_ctwa_clid,last_ctwa_received_at,updated_at';
export const readNativeContact = (database, tenantId, contactId) => {
    const row = database.prepare('SELECT * FROM contacts WHERE id=? AND tenant_id=?').get(parseContactId(contactId), tenantId);
    if (!row) fail('native_contact_not_found', 404);
    return row;
};
const expected = (row, revision) => {
    if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1 || row.source_revision !== revision)) {
        fail('native_contact_revision_conflict', 409);
    }
};
export const createNativeContact = (database, { tenantId, body }) => {
    const contact = normalizeContactCreate(body);
    const result = database.prepare(`INSERT INTO contacts(tenant_id,phone,profile_name,label,notes,updated_at)
        VALUES(?,?,?,?,?,datetime('now','localtime')) ON CONFLICT(tenant_id,phone) DO NOTHING`)
        .run(tenantId,contact.phone,contact.profileName ?? null,contact.label ?? null,contact.notes ?? null);
    if (!result.changes) fail('native_contact_exists',409);
    return readNativeContact(database,tenantId,Number(result.lastInsertRowid));
};
export const changeNativeContact = (database, { tenantId, contactId, body, expectedRevision }) => {
    const contact = readNativeContact(database,tenantId,contactId); expected(contact,expectedRevision);
    const update = normalizeContactUpdate(body); const clauses = []; const values = [];
    for (const key of ['label','notes']) if (update[key] !== undefined) { clauses.push(`${key}=?`); values.push(update[key]); }
    clauses.push("updated_at=datetime('now','localtime')");
    const result=database.prepare(`UPDATE contacts SET ${clauses.join(',')} WHERE id=? AND tenant_id=?${expectedRevision === undefined ? '' : ' AND source_revision=?'}`)
        .run(...values,contact.id,tenantId,...(expectedRevision === undefined ? [] : [expectedRevision]));
    if (!result.changes) fail('native_contact_revision_conflict',409);
    return readNativeContact(database,tenantId,contact.id);
};
export const removeNativeContact = (database, { tenantId, contactId, expectedRevision }) => {
    const contact=readNativeContact(database,tenantId,contactId); expected(contact,expectedRevision);
    const result=database.prepare(`DELETE FROM contacts WHERE id=? AND tenant_id=?${expectedRevision === undefined ? '' : ' AND source_revision=?'}`)
        .run(contact.id,tenantId,...(expectedRevision === undefined ? [] : [expectedRevision]));
    if (!result.changes) fail('native_contact_revision_conflict',409);
    return contact;
};
