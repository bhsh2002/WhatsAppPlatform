export const savanaIntegrationMethods = {
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
