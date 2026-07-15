import { InvalidContactError, normalizeContactCreate } from './contactValidation.js';

export const CONTACT_IMPORT_LIMIT = 10_000;

export class ContactTransferError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ContactTransferError';
        this.code = 'INVALID_CONTACT_CSV';
    }
}

const HEADER_ALIASES = new Map([
    ['phone', 'phone'],
    ['phone_number', 'phone'],
    ['mobile', 'phone'],
    ['الهاتف', 'phone'],
    ['رقم_الهاتف', 'phone'],
    ['profile_name', 'profile_name'],
    ['name', 'profile_name'],
    ['contact_name', 'profile_name'],
    ['الاسم', 'profile_name'],
    ['اسم_جهة_الاتصال', 'profile_name'],
    ['label', 'label'],
    ['tag', 'label'],
    ['التصنيف', 'label'],
    ['notes', 'notes'],
    ['note', 'notes'],
    ['الملاحظات', 'notes'],
]);

const normalizeHeader = value => String(value || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

const decodeSpreadsheetSafeValue = value => {
    const text = String(value || '').trim();
    return /^'[=+\-@\t\r]/.test(text) ? text.slice(1) : text;
};

export function parseCsvTable(value) {
    const text = String(value || '').replace(/^\uFEFF/, '');
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;

    const pushRow = () => {
        row.push(field);
        if (row.some(cell => String(cell).trim() !== '')) rows.push(row);
        row = [];
        field = '';
    };

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        const next = text[index + 1];

        if (quoted) {
            if (char === '"' && next === '"') {
                field += '"';
                index += 1;
            } else if (char === '"') {
                quoted = false;
            } else {
                field += char;
            }
            continue;
        }

        if (char === '"' && field === '') {
            quoted = true;
        } else if (char === ',') {
            row.push(field);
            field = '';
        } else if (char === '\n') {
            pushRow();
        } else if (char !== '\r') {
            field += char;
        }
    }

    if (quoted) throw new ContactTransferError('ملف CSV يحتوي على حقل مقتبس غير مغلق');
    if (field !== '' || row.length > 0) pushRow();
    return rows;
}

export function parseContactsCsv(value, { limit = CONTACT_IMPORT_LIMIT } = {}) {
    const rows = parseCsvTable(value);
    if (rows.length < 2) {
        throw new ContactTransferError('ملف CSV يجب أن يحتوي على رأس وبيانات جهة اتصال واحدة على الأقل');
    }
    if (rows.length - 1 > limit) {
        throw new ContactTransferError(`الحد الأقصى للاستيراد هو ${limit} جهة اتصال في الملف الواحد`);
    }

    const headers = rows[0].map(header => HEADER_ALIASES.get(normalizeHeader(header)) || null);
    if (!headers.includes('phone')) {
        throw new ContactTransferError('عمود phone أو رقم الهاتف مطلوب');
    }

    const contacts = [];
    const errors = [];
    const seenPhones = new Set();

    rows.slice(1).forEach((cells, index) => {
        const rowNumber = index + 2;
        const source = {};
        headers.forEach((header, cellIndex) => {
            if (header && source[header] === undefined) {
                source[header] = decodeSpreadsheetSafeValue(cells[cellIndex]);
            }
        });

        try {
            const contact = normalizeContactCreate(source);
            if (seenPhones.has(contact.phone)) {
                throw new InvalidContactError('رقم الهاتف مكرر داخل الملف');
            }
            seenPhones.add(contact.phone);
            contacts.push({ row: rowNumber, ...contact });
        } catch (error) {
            errors.push({
                row: rowNumber,
                error: error instanceof InvalidContactError ? error.message : 'بيانات جهة الاتصال غير صالحة',
            });
        }
    });

    return { contacts, errors };
}

export function upsertImportedContacts(database, { tenantId, contacts }) {
    const find = database.prepare('SELECT id FROM contacts WHERE tenant_id = ? AND phone = ?');
    const insert = database.prepare(`
        INSERT INTO contacts (tenant_id, phone, profile_name, label, notes, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
    `);
    const update = database.prepare(`
        UPDATE contacts
        SET profile_name = COALESCE(?, profile_name),
            label = COALESCE(?, label),
            notes = COALESCE(?, notes),
            updated_at = datetime('now', 'localtime')
        WHERE id = ? AND tenant_id = ?
    `);

    return database.transaction(() => {
        let created = 0;
        let updated = 0;
        for (const contact of contacts) {
            const existing = find.get(tenantId, contact.phone);
            if (existing) {
                update.run(contact.profileName, contact.label, contact.notes, existing.id, tenantId);
                updated += 1;
            } else {
                insert.run(
                    tenantId,
                    contact.phone,
                    contact.profileName,
                    contact.label,
                    contact.notes,
                );
                created += 1;
            }
        }
        return { created, updated };
    })();
}

const protectSpreadsheetCell = value => {
    const text = value === null || value === undefined ? '' : String(value);
    return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
};

const encodeCsvCell = value => `"${protectSpreadsheetCell(value).replaceAll('"', '""')}"`;

export function serializeContactsCsv(contacts, { includeTenant = false } = {}) {
    const headers = [
        ...(includeTenant ? ['tenant_id', 'tenant_name'] : []),
        'phone',
        'profile_name',
        'label',
        'notes',
        'updated_at',
    ];
    const lines = [headers.map(encodeCsvCell).join(',')];

    for (const contact of contacts) {
        const values = [
            ...(includeTenant ? [contact.tenant_id, contact.tenant_name] : []),
            contact.phone,
            contact.profile_name,
            contact.label,
            contact.notes,
            contact.updated_at,
        ];
        lines.push(values.map(encodeCsvCell).join(','));
    }

    return `\uFEFF${lines.join('\r\n')}\r\n`;
}
