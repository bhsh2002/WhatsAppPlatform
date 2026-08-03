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

    async acceptPortalMessageRequest(requestId) {
        return this.request(`/api/portal/integrations/message-requests/${requestId}/accept`, {
            method: 'POST',
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
