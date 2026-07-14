import db from '../db/database.js';

const TENANT_STATUS_ERRORS = Object.freeze({
    Pending: { error: 'حسابك قيد المراجعة', code: 'ACCOUNT_PENDING' },
    Rejected: { error: 'تم رفض حسابك', code: 'ACCOUNT_REJECTED' },
    Suspended: { error: 'حسابك موقوف', code: 'ACCOUNT_SUSPENDED' },
});

export const tenantMiddleware = (req, res, next) => {
    if (!req.user?.tenant_id || req.user.role === 'admin') {
        return res.status(403).json({ error: 'صلاحية الوصول مقتصرة على العملاء فقط' });
    }

    const tenant = db.prepare('SELECT status FROM tenants WHERE id = ?').get(req.user.tenant_id);
    if (!tenant) return res.status(404).json({ error: 'العميل غير موجود' });

    const statusError = TENANT_STATUS_ERRORS[tenant.status];
    if (statusError) return res.status(403).json(statusError);

    return next();
};
