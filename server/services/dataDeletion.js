import crypto from 'node:crypto';

const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const subjectHash = (value, secret) => crypto.createHmac('sha256', secret).update(String(value)).digest('hex');

const tableExists = (db, table) => Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
).get(table));

const jsonContains = (value, subject) => {
    if (value === subject) return true;
    if (Array.isArray(value)) return value.some(item => jsonContains(item, subject));
    if (value && typeof value === 'object') return Object.values(value).some(item => jsonContains(item, subject));
    return false;
};

const parseJson = (value) => {
    if (typeof value !== 'string' || !value) return null;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
};

const redactJson = (value, subject) => {
    if (value === subject) return '[deleted]';
    if (Array.isArray(value)) return value.map(item => redactJson(item, subject));
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactJson(item, subject)]));
    }
    return value;
};

const deleteJsonRows = (db, table, columns, subject) => {
    if (!tableExists(db, table)) return 0;
    const rows = db.prepare(`SELECT id, ${columns.join(', ')} FROM ${table}`).all();
    const ids = rows.filter(row => columns.some(column => {
        const parsed = parseJson(row[column]);
        return parsed ? jsonContains(parsed, subject) : false;
    })).map(row => row.id);
    if (ids.length === 0) return 0;
    return db.prepare(`DELETE FROM ${table} WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids).changes;
};

const redactJsonRows = (db, table, columns, subject) => {
    if (!tableExists(db, table)) return 0;
    const rows = db.prepare(`SELECT id, ${columns.join(', ')} FROM ${table}`).all();
    let redacted = 0;

    for (const row of rows) {
        const updates = {};
        for (const column of columns) {
            const parsed = parseJson(row[column]);
            if (parsed && jsonContains(parsed, subject)) {
                updates[column] = JSON.stringify(redactJson(parsed, subject));
            }
        }
        const names = Object.keys(updates);
        if (names.length === 0) continue;
        db.prepare(`UPDATE ${table} SET ${names.map(name => `${name} = ?`).join(', ')} WHERE id = ?`)
            .run(...names.map(name => updates[name]), row.id);
        redacted += 1;
    }

    return redacted;
};

const deleteByIds = (db, table, column, ids) => {
    if (!tableExists(db, table) || ids.length === 0) return 0;
    return db.prepare(`DELETE FROM ${table} WHERE ${column} IN (${ids.map(() => '?').join(',')})`)
        .run(...ids).changes;
};

export const processDataDeletion = (db, userId, { confirmationCode, identitySecret }) => {
    const subject = String(userId);
    const codeHash = hash(confirmationCode);
    const request = db.prepare(`
        INSERT INTO data_deletion_requests (confirmation_code_hash, subject_hash)
        VALUES (?, ?)
    `).run(codeHash, subjectHash(subject, identitySecret));

    try {
        const result = db.transaction(() => {
            let deleted = 0;
            let redacted = 0;

            const conversations = tableExists(db, 'fb_conversations')
                ? db.prepare('SELECT id FROM fb_conversations WHERE user_psid = ?').all(subject).map(row => row.id)
                : [];
            const sessions = tableExists(db, 'bot_sessions')
                ? db.prepare('SELECT id FROM bot_sessions WHERE user_psid = ?').all(subject).map(row => row.id)
                : [];

            deleted += deleteByIds(db, 'bot_events', 'session_id', sessions);
            deleted += deleteByIds(db, 'bot_events', 'conversation_id', conversations);
            deleted += deleteJsonRows(db, 'bot_events', ['payload_json'], subject);
            if (tableExists(db, 'bot_sessions')) {
                deleted += db.prepare('DELETE FROM bot_sessions WHERE user_psid = ?').run(subject).changes;
            }
            if (tableExists(db, 'fb_messages')) {
                deleted += db.prepare('DELETE FROM fb_messages WHERE sender_id = ?').run(subject).changes;
            }
            if (tableExists(db, 'fb_conversations')) {
                deleted += db.prepare('DELETE FROM fb_conversations WHERE user_psid = ?').run(subject).changes;
            }

            deleted += deleteJsonRows(db, 'webhook_logs', ['payload'], subject);
            deleted += deleteJsonRows(db, 'webhook_failures', ['payload'], subject);

            redacted += redactJsonRows(db, 'billing_usage_events', [
                'metadata_json', 'meta_status_payload_json', 'billing_formula_json',
            ], subject);
            redacted += redactJsonRows(db, 'billing_ledger', ['metadata_json'], subject);
            redacted += redactJsonRows(db, 'billing_meta_message_costs', [
                'status_payload_json', 'metadata_json',
            ], subject);

            if (tableExists(db, 'billing_meta_message_costs')) {
                redacted += db.prepare(`
                    UPDATE billing_meta_message_costs SET recipient = '[deleted]'
                    WHERE recipient = ?
                `).run(subject).changes;
            }

            // Remove legacy logs that embedded the raw identifier before this workflow existed.
            if (tableExists(db, 'activity_logs')) {
                const legacyRows = db.prepare(`
                    SELECT id, description FROM activity_logs WHERE event_type = 'data_deletion'
                `).all().filter(row => String(row.description || '').includes(subject));
                deleted += deleteByIds(db, 'activity_logs', 'id', legacyRows.map(row => row.id));
            }

            db.prepare(`
                UPDATE data_deletion_requests
                SET status = 'completed', records_deleted = ?, records_redacted = ?,
                    completed_at = datetime('now', 'localtime')
                WHERE id = ?
            `).run(deleted, redacted, request.lastInsertRowid);

            return { deleted, redacted };
        })();
        return { id: request.lastInsertRowid, status: 'completed', ...result };
    } catch (error) {
        db.prepare(`
            UPDATE data_deletion_requests
            SET status = 'failed', error_code = 'PROCESSING_FAILED', completed_at = datetime('now', 'localtime')
            WHERE id = ?
        `).run(request.lastInsertRowid);
        throw error;
    }
};

export const findDataDeletionStatus = (db, confirmationCode) => {
    if (typeof confirmationCode !== 'string' || !/^[0-9a-f]{32}$/.test(confirmationCode)) return null;
    return db.prepare(`
        SELECT status, records_deleted, records_redacted, requested_at, completed_at
        FROM data_deletion_requests WHERE confirmation_code_hash = ?
    `).get(hash(confirmationCode)) || null;
};
