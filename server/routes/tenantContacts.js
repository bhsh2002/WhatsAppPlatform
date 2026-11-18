import express from 'express';
import fs from 'node:fs';
import db from '../db/database.js';
import { cleanupFile, csvUpload } from '../config/upload.js';
import {
    InvalidContactError,
    normalizeContactFilters,
} from '../services/contactValidation.js';
import { createNativeContact,changeNativeContact,removeNativeContact,NativeContactError } from '../services/nativeContacts.js';
import { parsePagePagination } from '../services/pagination.js';
import {
    ContactTransferError,
    parseContactsCsv,
    serializeContactsCsv,
    upsertImportedContacts,
} from '../services/contactTransfer.js';

const CONTACT_COLUMNS = `
    id, tenant_id, phone, profile_name, profile_picture_url,
    label, notes, last_customer_message_at,
    last_ctwa_clid, last_ctwa_received_at, updated_at
`;

const sendContactError = (res, error, fallbackMessage) => {
    if (error instanceof InvalidContactError || error instanceof ContactTransferError) {
        return res.status(400).json({ error: error.message, code: error.code });
    }
    if (error instanceof NativeContactError) return res.status(error.status).json({error: error.status === 404 ? 'جهة الاتصال غير موجودة' : 'جهة الاتصال موجودة بالفعل أو تغيرت بياناتها',code:error.code});
    console.error(`[TenantContacts] ${fallbackMessage}:`, error);
    return res.status(500).json({ error: fallbackMessage });
};

export function createTenantContactsRouter({
    database = db,
    csvUploadMiddleware = csvUpload.single('file'),
    cleanupUploadedFile = cleanupFile,
} = {}) {
const router = express.Router();

router.get('/export', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const { search, label } = normalizeContactFilters(req.query);
        const where = ['tenant_id = ?'];
        const params = [tenantId];
        if (search) {
            where.push('(phone LIKE ? OR profile_name LIKE ?)');
            params.push(`%${search}%`, `%${search}%`);
        }
        if (label) {
            where.push('label = ?');
            params.push(label);
        }
        const contacts = database.prepare(`
            SELECT phone, profile_name, label, notes, updated_at
            FROM contacts
            WHERE ${where.join(' AND ')}
            ORDER BY updated_at DESC, id DESC
            LIMIT 10000
        `).all(...params);
        const csv = serializeContactsCsv(contacts);
        res.set({
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="contacts-${new Date().toISOString().slice(0, 10)}.csv"`,
            'Cache-Control': 'no-store',
        });
        return res.send(csv);
    } catch (error) {
        return sendContactError(res, error, 'فشل تصدير جهات الاتصال');
    }
});

router.post('/import', csvUploadMiddleware, (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'ملف CSV مطلوب' });
        const tenantId = req.user.tenant_id;
        const parsed = parseContactsCsv(fs.readFileSync(req.file.path, 'utf8'));
        if (parsed.contacts.length === 0) {
            return res.status(400).json({
                error: 'لم يتم العثور على جهات اتصال صالحة',
                failed: parsed.errors.length,
                errors: parsed.errors.slice(0, 50),
            });
        }
        const result = upsertImportedContacts(database, { tenantId, contacts: parsed.contacts });
        return res.json({
            imported: result.created + result.updated,
            ...result,
            failed: parsed.errors.length,
            errors: parsed.errors.slice(0, 50),
        });
    } catch (error) {
        return sendContactError(res, error, 'فشل استيراد جهات الاتصال');
    } finally {
        cleanupUploadedFile(req.file?.path);
    }
});

router.get('/', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const { search, label } = normalizeContactFilters(req.query);
        const { page, limit, offset } = parsePagePagination(req.query, {
            defaultLimit: 50,
            maxLimit: 200,
        });

        const where = ['c.tenant_id = ?'];
        const params = [tenantId];

        if (search) {
            where.push('(c.phone LIKE ? OR c.profile_name LIKE ?)');
            params.push(`%${search}%`, `%${search}%`);
        }
        if (label) {
            where.push('c.label = ?');
            params.push(label);
        }

        const whereClause = `WHERE ${where.join(' AND ')}`;
        const contacts = database.prepare(`
            SELECT ${CONTACT_COLUMNS.split(',').map(column => `c.${column.trim()}`).join(', ')},
                (SELECT COUNT(*) FROM messages m WHERE
                    m.tenant_id = c.tenant_id AND (m.sender = c.phone OR m.recipient = c.phone)
                ) AS message_count
            FROM contacts c
            ${whereClause}
            ORDER BY c.updated_at DESC, c.id DESC
            LIMIT ? OFFSET ?
        `).all(...params, limit, offset);

        const total = database.prepare(
            `SELECT COUNT(*) AS count FROM contacts c ${whereClause}`
        ).get(...params).count;

        res.json({ contacts, total, page, limit });
    } catch (error) {
        return sendContactError(res, error, 'فشل جلب جهات الاتصال');
    }
});

const contactResponse = row => Object.fromEntries([...CONTACT_COLUMNS.split(',').map(key=>key.trim()),
    ...(row.source_revision !== undefined ? ['source_revision'] : [])].map(key=>[key,row[key]]));
router.put('/:id', (req,res) => {
    try {return res.json(contactResponse(changeNativeContact(database,{tenantId:req.user.tenant_id,contactId:req.params.id,body:req.body})));}
    catch(error){return sendContactError(res,error,'فشل تحديث جهة الاتصال');}
});
router.post('/', (req,res) => {
    try {return res.status(201).json(contactResponse(createNativeContact(database,{tenantId:req.user.tenant_id,body:req.body})));}
    catch(error){return sendContactError(res,error,'فشل إنشاء جهة الاتصال');}
});
router.delete('/:id', (req,res) => {
    try {removeNativeContact(database,{tenantId:req.user.tenant_id,contactId:req.params.id});return res.json({success:true,message:'تم حذف جهة الاتصال'});}
    catch(error){return sendContactError(res,error,'فشل حذف جهة الاتصال');}
});

return router;
}

export default createTenantContactsRouter();
