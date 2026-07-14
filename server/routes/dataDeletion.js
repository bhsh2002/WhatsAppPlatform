import crypto from 'node:crypto';
import express from 'express';
import db from '../db/database.js';
import { verifyMetaSignedRequest } from '../security/metaSignedRequest.js';
import { findDataDeletionStatus, processDataDeletion } from '../services/dataDeletion.js';

const router = express.Router();

const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
})[character]);

router.post('/data-deletion', (req, res) => {
    const appSecret = process.env.FB_APP_SECRET || process.env.META_APP_SECRET || '';
    try {
        const data = verifyMetaSignedRequest(req.body?.signed_request, appSecret);
        const confirmationCode = crypto.randomBytes(16).toString('hex');
        processDataDeletion(db, data.user_id, { confirmationCode, identitySecret: appSecret });

        const publicBaseUrl = (process.env.PUBLIC_APP_URL || 'https://wa.savana.ly').replace(/\/$/, '');
        return res.json({
            url: `${publicBaseUrl}/deletion-status?code=${encodeURIComponent(confirmationCode)}`,
            confirmation_code: confirmationCode,
        });
    } catch (error) {
        const invalidRequest = /signed_request|algorithm|app secret/i.test(error.message);
        if (invalidRequest) return res.status(appSecret ? 403 : 503).json({ error: 'Invalid deletion request' });
        console.error('[DataDeletion] Processing failed:', error.message);
        return res.status(500).json({ error: 'Failed to process deletion request' });
    }
});

router.get('/deletion-status', (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const record = findDataDeletionStatus(db, code);
    const state = record?.status || 'not_found';
    const messages = {
        completed: ['✅ اكتملت معالجة طلب الحذف', 'حُذفت البيانات التشغيلية المرتبطة بالمعرّف، ونُقحت الإشارات منه في السجلات المالية المحتفظ بها.'],
        pending: ['⏳ طلب الحذف قيد المعالجة', 'يرجى إعادة المحاولة لاحقًا.'],
        failed: ['⚠️ تعذرت معالجة طلب الحذف', 'تواصل مع privacy@savana.ly واذكر رمز التأكيد.'],
        not_found: ['لم يتم العثور على الطلب', 'تحقق من رمز التأكيد أو تواصل مع privacy@savana.ly.'],
    };
    const [title, detail] = messages[state];

    res.status(record ? 200 : 404).setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>حالة حذف البيانات — Wa Savana</title><style>body{font-family:'Segoe UI',Tahoma,sans-serif;max-width:600px;margin:80px auto;padding:0 20px;text-align:center;color:#333;background:#fafafa}.card{background:#fff;padding:40px;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.08)}h1{color:#075E54}.code{background:#f0f0f0;padding:12px 24px;border-radius:8px;font-family:monospace;display:inline-block;margin:16px 0}.status{font-size:1.2em;font-weight:bold}</style></head>
<body><div class="card"><h1>حالة حذف البيانات</h1><p class="status">${escapeHtml(title)}</p><p>${escapeHtml(detail)}</p><p>رمز التأكيد:</p><div class="code">${escapeHtml(code || 'N/A')}</div><p style="color:#888;font-size:.9em;margin-top:30px">للاستفسارات: privacy@savana.ly</p></div></body></html>`);
});

export default router;
