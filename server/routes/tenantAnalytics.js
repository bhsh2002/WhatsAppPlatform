import express from 'express';
import {readNativeMessageAnalytics} from '../services/nativeMessageAnalytics.js';
import {
    hasWhatsAppNumbersTable,
    resolveTenantWhatsAppContext,
    selectedWhatsAppPhoneNumberId,
} from '../services/whatsappNumbers.js';

export function createTenantAnalyticsRouter({ database } = {}) {
    if (!database) throw new TypeError('Tenant analytics router requires database');
    const router = express.Router();

    router.get('/summary', (req, res) => {
        try {
            const tenantId = req.user.tenant_id;
            const requestedPhoneNumberId = selectedWhatsAppPhoneNumberId(req);
            let phoneNumberId = null;
            if (requestedPhoneNumberId || hasWhatsAppNumbersTable(database)) {
                const context = resolveTenantWhatsAppContext({
                    database,
                    tenantId,
                    phoneNumberId: requestedPhoneNumberId,
                    requireToken: false,
                });
                if (context.error) {
                    if (context.code !== 'WHATSAPP_NUMBER_REQUIRED' || requestedPhoneNumberId) {
                        return res.status(context.status).json({ error: context.error, code: context.code });
                    }
                } else {
                    phoneNumberId = context.phoneNumberId;
                }
            }
            return res.json(readNativeMessageAnalytics({database,tenantId,phoneNumberId}));
        } catch (error) {
            console.error('[TenantAnalytics] Summary error:', error);
            return res.status(500).json({ error: 'فشل جلب الإحصائيات' });
        }
    });

    return router;
}

export default createTenantAnalyticsRouter;
