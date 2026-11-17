import express from 'express';
import { localReadPrincipal, SharedProductReadError } from '../services/centralProductRead.js';

const messages = {
    shared_product_reads_disabled: 'قراءة المنتجات المشتركة غير مفعّلة؛ تبقى هذه القدرة ظاهرة دون تنفيذ.',
    shared_product_read_session_required: 'يلزم ربط جلسة قراءة مركزية موثوقة بهذا المستخدم والنشاط من الخادم.',
    shared_product_verification_unavailable: 'تعذر التحقق من القراءة الحالية؛ لم تُحذف أي نسخة ولم تُستخدم قراءة سابقة كتفويض.',
    integration_authorization_changed: 'تغيّر التفويض. أعد القراءة من البداية؛ لم تُحذف المنتجات.',
    record_not_found: 'المنتج غير متاح لهذه القراءة؛ لا تعني هذه النتيجة أرشفته أو حذفه.',
};
const number = (value, fallback) => value === undefined ? fallback : (/^\d+$/.test(String(value)) ? Number(value) : NaN);

export const createSharedProductReadsRouter = ({ service }) => {
    const router = express.Router();
    const handle = (allowed, run) => async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
            if (Object.keys(req.query).some(key => !allowed.includes(key))
                || Object.values(req.query).some(value => typeof value !== 'string')) {
                throw new SharedProductReadError('integration_request_invalid', 422);
            }
            return res.json(await run(localReadPrincipal(req.user), req));
        } catch (error) {
            const known = error instanceof SharedProductReadError;
            const code = known ? error.code : 'shared_product_verification_unavailable';
            return res.status(known ? error.status : 503).json({
                error: { code, message: messages[code] || 'تعذر تأكيد أهلية القراءة الحالية. راجع الربط والصلاحيات ثم أعد المحاولة.' },
                clear_previous: true, read_only: true, execution_ready: false, pricing_use_allowed: false,
            });
        }
    };
    router.get('/shared-products', handle(['q', 'limit', 'cursor'], (principal, req) => service.search(principal, {
        q: req.query.q ?? '', limit: number(req.query.limit, 50), cursor: req.query.cursor ?? null,
    })));
    router.get('/shared-product-changes', handle(['after', 'limit'], (principal, req) => service.changes(principal, {
        after: number(req.query.after, 0), limit: number(req.query.limit, 50),
    })));
    router.get('/shared-products/:entityId', handle(['domain'], (principal, req) => service.record(principal, {
        entityId: req.params.entityId, domain: req.query.domain ?? 'product.core',
    })));
    return router;
};
