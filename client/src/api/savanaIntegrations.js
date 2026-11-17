export const savanaIntegrationMethods = {
    async getPortalPlatformBinding() {
        return this.request('/api/portal/integrations/binding');
    },

    async redeemPortalPlatformBinding(invitationCode) {
        return this.request('/api/portal/integrations/binding/redeem', {
            method: 'POST',
            body: JSON.stringify({ invitation_code: invitationCode }),
        });
    },

    async authorizePortalPlatformBinding(redirectUri, state) {
        return this.request('/api/portal/integrations/binding/authorize', {
            method: 'POST',
            body: JSON.stringify({ redirect_uri: redirectUri, state }),
        });
    },

    async getPortalIncomingConnections() {
        return this.request('/api/portal/integrations/incoming-connections');
    },

    async decidePortalIncomingConnection(connectionId, decision) {
        return this.request(
            `/api/portal/integrations/incoming-connections/${connectionId}/${decision}`,
            { method: 'POST' },
        );
    },
    async checkoutPortalCentralSubscription(data) {
        return this.request('/api/portal/integrations/subscription/checkout', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async quotePortalCentralSubscription(data) {
        return this.request('/api/portal/integrations/subscription/checkout-quote', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async createPortalCentralPaymentIntent(data) {
        return this.request('/api/portal/integrations/subscription/payment-intents', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async getPortalPlatformIntegrations() {
        return this.request('/api/portal/integrations/platforms');
    },

    async connectPortalPlatform(platformCode, data) {
        return this.request(`/api/portal/integrations/platforms/${platformCode}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    },

    async getPortalPlatformCandidates(platformCode) {
        return this.request(`/api/portal/integrations/platforms/${platformCode}/candidates`);
    },

    async actionPortalPlatform(platformCode, action, data = undefined) {
        return this.request(`/api/portal/integrations/platforms/${platformCode}/${action}`, {
            method: 'POST',
            ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        });
    },

    async getPortalPlatformDiagnostics(platformCode) {
        return this.request(`/api/portal/integrations/platforms/${platformCode}/diagnostics`);
    },

    async getPortalPlatformServiceRequests(platformCode, limit = 20) {
        return this.request(
            `/api/portal/integrations/platforms/${platformCode}/service-requests?limit=${limit}`
        );
    },

    async dismissPortalPlatformServiceRequest(platformCode, requestId) {
        return this.request(
            `/api/portal/integrations/platforms/${platformCode}/service-requests/${requestId}/dismiss`,
            { method: 'POST' },
        );
    },

    async getPortalMessageRequests(limit = 20) {
        return this.request(`/api/portal/integrations/message-requests?limit=${limit}`);
    },

    async getPortalIntegrationProducts(limit = 100) {
        return this.request(`/api/portal/integrations/products?limit=${limit}`);
    },

    async getPortalSharedProducts({ q = '', limit = 25, cursor = null } = {}) {
        const params = new URLSearchParams({ q, limit: String(limit) });
        if (cursor !== null) params.set('cursor', cursor);
        return this.request(`/api/portal/integrations/shared-products?${params}`);
    },

    async getPortalSharedReadSetup() {
        return this.request('/api/portal/integrations/shared-read-setup');
    },

    async authorizePortalSharedRead() {
        // Starts identity connection only; owner operations remain in ControlCenter.
        return this.request('/api/portal/integrations/shared-read-setup/authorization', {
            method: 'POST',
            headers: { 'X-Savana-Owner-Intent': 'shared-read-setup-v1' },
        });
    },

    async disconnectPortalSharedRead() {
        return this.request('/api/portal/integrations/shared-read-setup/disconnect', {
            method: 'POST',
            headers: { 'X-Savana-Owner-Intent': 'shared-read-setup-v1' },
        });
    },

    async enrollPortalSharedReadConsumer() {
        return this.request('/api/portal/integrations/shared-read-setup/enrollment', {
            method: 'POST',
            headers: { 'X-Savana-Owner-Intent': 'shared-read-setup-v1' },
        });
    },

    async getPortalSharedReadOwnerStatus() {
        return this.request('/api/portal/integrations/shared-read-setup/owner');
    },

    async loginPortalSharedReadOwner({ username, password, mfa_code } = {}) {
        return this.request('/api/portal/integrations/shared-read-setup/owner/login', {
            method: 'POST',
            headers: { 'X-Savana-Owner-Intent': 'shared-read-setup-v1' },
            body: JSON.stringify({ username, password, ...(mfa_code ? { mfa_code } : {}) }),
        });
    },

    async disconnectPortalSharedReadOwner() {
        return this.request('/api/portal/integrations/shared-read-setup/owner/disconnect', {
            method: 'POST',
            headers: { 'X-Savana-Owner-Intent': 'shared-read-setup-v1' },
            body: JSON.stringify({}),
        });
    },

    async getPortalSharedReadOwnerOverview() {
        return this.request('/api/portal/integrations/shared-read-setup/owner/overview');
    },

    async getPortalSharedReadOwnerIntent(intentId) {
        return this.request(`/api/portal/integrations/shared-read-setup/owner/intents/${encodeURIComponent(intentId)}`);
    },

    async getPortalSharedReadOwnerIntentByKey(key) {
        return this.request(`/api/portal/integrations/shared-read-setup/owner/intents/by-key/${encodeURIComponent(key)}`);
    },

    async submitPortalSharedReadOwnerOperation({ operation, idempotencyKey, body, requestId, targetAccountId }) {
        return this.request('/api/portal/integrations/shared-read-setup/owner/operations', {
            method: 'POST', headers: { 'X-Savana-Owner-Intent': 'shared-read-setup-v1' },
            body: JSON.stringify({ operation, idempotencyKey, body, ...(requestId ? { requestId } : {}), ...(targetAccountId ? { targetAccountId } : {}) }),
        });
    },

    async bindPortalSharedReadConsumer({ consumer_installation_id, activity_id, branch_id = null, warehouse_id = null }) {
        return this.request('/api/portal/integrations/shared-read-setup/reader', {
            method: 'POST', headers: { 'X-Savana-Owner-Intent': 'shared-read-setup-v1' },
            body: JSON.stringify({ consumer_installation_id, activity_id, branch_id, warehouse_id }),
        });
    },

    async getPortalSharedProductChanges(after = 0, limit = 25) {
        const params = new URLSearchParams({ after: String(after), limit: String(limit) });
        return this.request(`/api/portal/integrations/shared-product-changes?${params}`);
    },

    async acceptPortalMessageRequest(requestId) {
        return this.request(`/api/portal/integrations/message-requests/${requestId}/accept`, {
            method: 'POST',
            headers: { 'X-Savana-Review-Mode': 'review-only-v1' },
        });
    },

    async completePortalMessageRequest(requestId, channelMessageId = null) {
        return this.request(`/api/portal/integrations/message-requests/${requestId}/complete`, {
            method: 'POST',
            body: JSON.stringify({ channel_message_id: channelMessageId }),
        });
    },

    async dismissPortalMessageRequest(requestId) {
        return this.request(`/api/portal/integrations/message-requests/${requestId}/dismiss`, {
            method: 'POST',
        });
    },

    async getPortalPosIntegration() {
        return this.request('/api/portal/integrations/pos');
    },

    async connectPortalPos(data) {
        return this.request('/api/portal/integrations/pos', {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    },

    async actionPortalPos(action) {
        return this.request(`/api/portal/integrations/pos/${action}`, { method: 'POST' });
    },

    async getPortalPosDiagnostics() {
        return this.request('/api/portal/integrations/pos/diagnostics');
    },

    async getPortalPosTransactions(limit = 10) {
        return this.request(`/api/portal/integrations/pos/transactions?limit=${limit}`);
    },
};
