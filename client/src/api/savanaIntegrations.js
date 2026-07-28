export const savanaIntegrationMethods = {
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
