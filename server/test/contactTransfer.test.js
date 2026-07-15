import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import {
    ContactTransferError,
    parseContactsCsv,
    serializeContactsCsv,
    upsertImportedContacts,
} from '../services/contactTransfer.js';

test('contact CSV parsing handles quoted multiline text, aliases, invalid rows and duplicates', () => {
    const csv = [
        'رقم الهاتف,الاسم,التصنيف,الملاحظات',
        '+218 91 000 0001,"Customer, One",VIP,"Line one',
        'Line two"',
        '123,Bad phone,Lead,Invalid',
        '218910000001,Duplicate,Lead,Duplicate',
        '218920000002,Second,Customer,"""quoted"" note"',
    ].join('\n');

    const result = parseContactsCsv(csv);
    assert.equal(result.contacts.length, 2);
    assert.equal(result.contacts[0].phone, '218910000001');
    assert.equal(result.contacts[0].profileName, 'Customer, One');
    assert.equal(result.contacts[0].notes, 'Line one\nLine two');
    assert.equal(result.contacts[1].notes, '"quoted" note');
    assert.deepEqual(result.errors.map(error => error.row), [3, 4]);
    assert.throws(() => parseContactsCsv('name,notes\nMissing,Phone'), ContactTransferError);
    assert.throws(() => parseContactsCsv('phone,name\n"218910000001,Bad'), ContactTransferError);
});

test('contact imports upsert within one tenant and CSV exports neutralize spreadsheet formulas', () => {
    const database = new Database(':memory:');
    database.exec(`
        CREATE TABLE contacts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER NOT NULL,
            phone TEXT NOT NULL,
            profile_name TEXT,
            label TEXT,
            notes TEXT,
            updated_at TEXT,
            UNIQUE (tenant_id, phone)
        );
        INSERT INTO contacts (tenant_id, phone, profile_name, label, notes)
        VALUES (1, '218910000001', 'Existing', 'VIP', 'Keep me');
    `);

    const { contacts } = parseContactsCsv([
        'phone,profile_name,label,notes',
        '218910000001,Updated,,',
        '218920000002,"=HYPERLINK(""https://evil.test"")",Lead,@formula',
    ].join('\n'));
    assert.deepEqual(upsertImportedContacts(database, { tenantId: 1, contacts }), {
        created: 1,
        updated: 1,
    });
    assert.equal(database.prepare("SELECT profile_name FROM contacts WHERE phone = '218910000001'").get().profile_name, 'Updated');
    assert.equal(database.prepare("SELECT notes FROM contacts WHERE phone = '218910000001'").get().notes, 'Keep me');

    const csv = serializeContactsCsv(database.prepare('SELECT * FROM contacts ORDER BY id').all());
    assert.match(csv, /"'=HYPERLINK/);
    assert.match(csv, /"'@formula"/);
    assert.equal(parseContactsCsv(csv).contacts[1].profileName, '=HYPERLINK("https://evil.test")');
    database.close();
});
