export const tenantMetaMethods = {
    // ============================================
    // Meta Self-Service Integration (Tenant)
    // ============================================
    async getMetaConfig() {
        return this.request('/api/portal/meta/config');
    },

    async getFacebookAuthUrl() {
        return this.request('/api/portal/facebook/auth-url');
    },

    async getFacebookDiagnostics() {
        return this.request('/api/portal/facebook/diagnostics');
    },

    async getMetaReviewReadiness() {
        return this.request('/api/portal/meta-review/readiness');
    },

    async getMetaReviewSnapshots(limit = 10) {
        return this.request(`/api/portal/meta-review/snapshots?limit=${limit}`);
    },

    async saveMetaReviewSnapshot() {
        return this.request('/api/portal/meta-review/snapshot', {
            method: 'POST',
        });
    },

    async connectFacebook(code, state) {
        return this.request('/api/portal/facebook/connect', {
            method: 'POST',
            body: JSON.stringify({ code, state }),
        });
    },

    async linkFacebookPages(linkState, pageIds) {
        return this.request('/api/portal/facebook/link-pages', {
            method: 'POST',
            body: JSON.stringify({ link_state: linkState, page_ids: pageIds }),
        });
    },

    async disconnectFacebookPage(linkedPageId) {
        return this.request(`/api/portal/facebook/disconnect/${linkedPageId}`, {
            method: 'DELETE',
        });
    },

    async getPortalWhatsAppStatus() {
        return this.request('/api/portal/whatsapp/status');
    },

    async getPortalWhatsAppNumbers() {
        return this.request('/api/portal/whatsapp/numbers');
    },

    async updatePortalWhatsAppNumber(phoneNumberId, data) {
        return this.request(`/api/portal/whatsapp/numbers/${encodeURIComponent(phoneNumberId)}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    },

    async setDefaultPortalWhatsAppNumber(phoneNumberId) {
        return this.request(`/api/portal/whatsapp/numbers/${encodeURIComponent(phoneNumberId)}/default`, {
            method: 'POST',
        });
    },

    async deletePortalWhatsAppNumber(phoneNumberId) {
        return this.request(`/api/portal/whatsapp/numbers/${encodeURIComponent(phoneNumberId)}`, {
            method: 'DELETE',
        });
    },

    async connectWhatsApp(code, phoneNumberId, wabaId, businessId, forceReconnect = false, setDefault = false) {
        return this.request('/api/portal/whatsapp/connect', {
            method: 'POST',
            body: JSON.stringify({
                code,
                phone_number_id: phoneNumberId,
                waba_id: wabaId,
                business_id: businessId,
                force_reconnect: forceReconnect,
                set_default: setDefault,
            }),
        });
    },
};
