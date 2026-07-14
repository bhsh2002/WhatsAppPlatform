import express from 'express';
import {
    getBillingSummary,
    getInvoices as getBillingInvoices,
    getLedger as getBillingLedger,
    handleBillingError,
} from '../services/billing.js';
import { parseListPagination } from '../services/pagination.js';

const router = express.Router();
const MAX_FILTER_LENGTH = 64;

class InvalidBillingQueryError extends Error {
    constructor(message) {
        super(message);
        this.name = 'InvalidBillingQueryError';
        this.code = 'INVALID_BILLING_QUERY';
    }
}

const normalizeFilter = (value, fieldName) => {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string') {
        throw new InvalidBillingQueryError(`${fieldName} يجب أن يكون نصًا`);
    }
    const normalized = value.trim();
    if (normalized.length > MAX_FILTER_LENGTH) {
        throw new InvalidBillingQueryError(`${fieldName} يجب ألا يتجاوز ${MAX_FILTER_LENGTH} حرفًا`);
    }
    return normalized || null;
};

const sendQueryError = (res, error, fallbackMessage) => {
    if (error instanceof InvalidBillingQueryError) {
        return res.status(400).json({ error: error.message, code: error.code });
    }
    console.error(`[TenantBilling] ${fallbackMessage}:`, error);
    return res.status(500).json({ error: fallbackMessage });
};

router.get('/summary', (req, res) => {
    try {
        const summary = getBillingSummary(req.user.tenant_id, {
            includeInternal: false,
            periodStart: req.query.period_start || null,
            periodEnd: req.query.period_end || null,
        });
        res.json(summary);
    } catch (error) {
        if (handleBillingError(res, error)) return;
        return sendQueryError(res, error, 'فشل جلب بيانات الرصيد والفوترة');
    }
});

router.get('/ledger', (req, res) => {
    try {
        const { limit, offset } = parseListPagination(req.query, {
            defaultLimit: 10,
            maxLimit: 100,
        });
        const ledger = getBillingLedger(req.user.tenant_id, {
            limit,
            offset,
            channel: normalizeFilter(req.query.channel, 'القناة'),
            operation: normalizeFilter(req.query.operation, 'العملية'),
        });
        res.json({ ledger });
    } catch (error) {
        return sendQueryError(res, error, 'فشل جلب سجل الرصيد');
    }
});

router.get('/invoices', (req, res) => {
    try {
        const { limit, offset } = parseListPagination(req.query, {
            defaultLimit: 20,
            maxLimit: 100,
        });
        const invoices = getBillingInvoices(req.user.tenant_id, { limit, offset });
        res.json({ invoices });
    } catch (error) {
        return sendQueryError(res, error, 'فشل جلب الفواتير');
    }
});

export default router;
