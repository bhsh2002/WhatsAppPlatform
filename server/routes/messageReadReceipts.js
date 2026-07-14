import express from 'express';
import { META_API_BASE } from '../config/index.js';
import { resolveCredentials } from '../services/credentials.js';
import { readMetaResponse, sendMetaFailure } from '../services/metaHttp.js';

export function createMessageReadReceiptsRouter({
    credentialResolver = resolveCredentials,
    fetchImpl = globalThis.fetch,
    parseMetaResponse = readMetaResponse,
    sendMetaError = sendMetaFailure,
    apiBase = META_API_BASE,
} = {}) {
    const router = express.Router();

    router.post('/mark-read', async (req, res) => {
        try {
            const {
                message_id: messageId,
                tenant_id: tenantId,
                phone_number_id: phoneNumberIdOverride,
                access_token: accessTokenOverride,
            } = req.body;
            if (!messageId) return res.status(400).json({ error: 'message_id is required' });

            const { phoneNumberId, accessToken, isSuspended } = await credentialResolver({
                tenantId,
                phoneNumberIdOverride,
                accessTokenOverride,
            });
            if (isSuspended) return res.status(403).json({ error: 'Tenant is suspended' });
            if (!phoneNumberId || !accessToken) {
                return res.status(400).json({ error: 'Missing phone_number_id or access_token' });
            }

            const response = await fetchImpl(`${apiBase}/${encodeURIComponent(phoneNumberId)}/messages`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    messaging_product: 'whatsapp',
                    status: 'read',
                    message_id: messageId,
                }),
            });
            const metaResult = await parseMetaResponse(response);
            if (metaResult.ok) return res.json({ success: true });

            console.error('[Messages] Mark read failed:', metaResult.status, metaResult.error?.code);
            return sendMetaError(res, metaResult, 'Failed to mark as read');
        } catch (error) {
            console.error('[Messages] Mark read error:', error);
            return res.status(500).json({ error: 'Failed to mark message as read' });
        }
    });

    return router;
}

export default createMessageReadReceiptsRouter();
