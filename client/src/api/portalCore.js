export const portalCoreMethods = {
    // ============================================
    // Admin - Tenant Account Management
    // ============================================
    async getTenantAccount(tenantId) {
        return this.request(`/api/tenants/${tenantId}/account`);
    },

    async createTenantAccount(tenantId, data) {
        return this.request(`/api/tenants/${tenantId}/create-account`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async updateTenantPassword(tenantId, password) {
        return this.request(`/api/tenants/${tenantId}/account/password`, {
            method: 'PUT',
            body: JSON.stringify({ password }),
        });
    },

    async toggleTenantAccount(tenantId) {
        return this.request(`/api/tenants/${tenantId}/account/toggle`, {
            method: 'PUT',
        });
    },

    async getTenantTemplates(tenantId) {
        return this.request(`/api/tenants/${tenantId}/templates`);
    },

    // ============================================
    // Tenant Portal APIs
    // ============================================
    async getPortalDashboard() {
        return this.request('/api/portal/dashboard');
    },

    async getPortalConversations(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/portal/conversations${query ? `?${query}` : ''}`);
    },

    async getPortalMessages(phone, params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/portal/conversations/${phone}/messages${query ? `?${query}` : ''}`);
    },

    async uploadPortalMediaToMeta(file) {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch(`${this.baseUrl}/api/portal/media/upload-to-meta`, {
            method: 'POST',
            credentials: 'include',
            headers: this.getWhatsAppRequestHeaders(),
            body: formData,
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Upload failed');
        }
        return data; // { id: '...' }
    },

    async uploadAdminMediaToMeta(tenantId, file) {
        const formData = new FormData();
        formData.append('tenant_id', tenantId);
        formData.append('file', file);

        const response = await fetch(`${this.baseUrl}/api/messages/media/upload-to-meta`, {
            method: 'POST',
            credentials: 'include',
            body: formData,
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Upload failed');
        }
        return data;
    },

    async sendPortalMessage(data) {
        return this.request('/api/portal/messages/send', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async sendPortalDocument(formData) {
        const response = await fetch(`${this.baseUrl}/api/portal/messages/send-document`, {
            method: 'POST',
            credentials: 'include',
            headers: this.getWhatsAppRequestHeaders(),
            body: formData
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to send document');
        }
        return data;
    },

    async getPortalTemplates() {
        return this.request('/api/portal/templates');
    },

    async getPortalTemplate(id) {
        return this.request(`/api/portal/templates/${id}`);
    },

    async createPortalTemplate(data) {
        return this.request('/api/portal/templates', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async updatePortalTemplate(id, data) {
        return this.request(`/api/portal/templates/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    },

    async deletePortalTemplate(id) {
        return this.request(`/api/portal/templates/${id}`, {
            method: 'DELETE',
        });
    },

    async syncPortalTemplates() {
        return this.request('/api/portal/templates/sync', {
            method: 'POST',
        });
    },

    async sendPortalImage(formData) {
        const response = await fetch(`${this.baseUrl}/api/portal/messages/send-image`, {
            method: 'POST',
            credentials: 'include',
            headers: this.getWhatsAppRequestHeaders(),
            body: formData
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to send image');
        }
        return data;
    },

    getPortalMediaDownloadUrl(mediaId) {
        const params = new URLSearchParams();
        if (this._mediaToken) params.append('media_token', this._mediaToken);
        if (this._whatsappPhoneNumberId) params.append('phone_number_id', this._whatsappPhoneNumberId);
        const queryString = params.toString() ? `?${params.toString()}` : '';
        return `${this.baseUrl}/api/portal/media/${mediaId}/download${queryString}`;
    },

    async getPortalMediaDownloadUrlAsync(mediaId) {
        const mediaToken = await this.getMediaToken();
        const params = new URLSearchParams();
        if (mediaToken) params.append('media_token', mediaToken);
        if (this._whatsappPhoneNumberId) params.append('phone_number_id', this._whatsappPhoneNumberId);
        const queryString = params.toString() ? `?${params.toString()}` : '';
        return `${this.baseUrl}/api/portal/media/${mediaId}/download${queryString}`;
    },

    async sendPortalInteractiveMessage(data) {
        return this.request('/api/portal/messages/send-interactive', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    // ============================================
    // Portal Unified Inbox (WhatsApp + Messenger)
    // ============================================

    async getPortalUnifiedConversations(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/portal/unified/conversations${query ? '?' + query : ''}`);
    },

    async getPortalUnifiedMessages(channel, contactId, params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/portal/unified/${channel}/${encodeURIComponent(contactId)}/messages${query ? '?' + query : ''}`);
    },

    async sendPortalUnifiedMessage(channel, contactId, data) {
        return this.request(`/api/portal/unified/${channel}/${encodeURIComponent(contactId)}/send`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async syncPortalMessenger() {
        return this.request('/api/portal/unified/messenger/sync', {
            method: 'POST',
        });
    },

    async sendInteractiveMessage(data) {
        return this.request('/api/messages/send-interactive', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async importPortalTemplate(templateData) {
        return this.request('/api/portal/templates/import', {
            method: 'POST',
            body: JSON.stringify(templateData),
        });
    },

    async createPortalTemplateMeta(data) {
        return this.request('/api/portal/templates/create-meta', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async deletePortalTemplateMeta(name) {
        return this.request(`/api/portal/templates/delete-meta?name=${encodeURIComponent(name)}`, {
            method: 'DELETE',
        });
    },

    async getPortalApiSettings() {
        return this.request('/api/portal/settings/api');
    },

    async updatePortalApiSettings(data) {
        return this.request('/api/portal/settings/api', {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    },

    async regeneratePortalApiKey() {
        return this.request('/api/portal/settings/api/regenerate-key', {
            method: 'POST',
        });
    },

    async regeneratePortalWebhookSecret() {
        return this.request('/api/portal/settings/api/regenerate-webhook-secret', {
            method: 'POST',
        });
    },

    async getSmsAccounts() {
        return this.request('/api/portal/sms-gateway');
    },

    async createSmsAccount(data) {
        return this.request('/api/portal/sms-gateway', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async updateSmsAccount(accountId, data) {
        return this.request(`/api/portal/sms-gateway/${accountId}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    },

    async disableSmsAccount(accountId) {
        return this.request(`/api/portal/sms-gateway/${accountId}`, {
            method: 'DELETE',
        });
    },

    async checkSmsAccount(accountId) {
        return this.request(`/api/portal/sms-gateway/${accountId}/health`, {
            method: 'POST',
        });
    },

    async getSmsAccountDevices(accountId) {
        return this.request(`/api/portal/sms-gateway/${accountId}/devices`);
    },

    async getUssdRequests({ accountId, limit = 100 } = {}) {
        const params = new URLSearchParams();
        if (accountId) params.set('account_id', accountId);
        params.set('limit', String(limit));
        return this.request(`/api/portal/sms-gateway/ussd?${params.toString()}`);
    },

    async sendUssdRequest(accountId, data, idempotencyKey) {
        return this.request(`/api/portal/sms-gateway/${accountId}/ussd`, {
            method: 'POST',
            headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
            body: JSON.stringify(data),
        });
    },

    async refreshUssdRequest(accountId, ussdId) {
        return this.request(`/api/portal/sms-gateway/${accountId}/ussd/${ussdId}/refresh`, {
            method: 'POST',
        });
    },

    async testSmsAccount(accountId, data) {
        return this.request(`/api/portal/sms-gateway/${accountId}/test`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async getPortalProfile() {
        return this.request('/api/portal/profile');
    },

    async getPortalAnalytics() {
        return this.request('/api/portal/analytics/summary');
    },

    async getPortalQRCodes() {
        return this.request('/api/portal/qr-codes');
    },

    async createPortalQRCode(data) {
        return this.request('/api/portal/qr-codes', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async deletePortalQRCode(qrCodeId) {
        return this.request(`/api/portal/qr-codes/${qrCodeId}`, { method: 'DELETE' });
    },

    async getPortalConversionHistory() {
        return this.request('/api/portal/conversions/history');
    },

    async getPortalConversionDatasets() {
        return this.request('/api/portal/conversions/datasets');
    },

    async updatePortalMetaSettings(data) {
        return this.request('/api/portal/meta-settings', {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    },

    async logPortalConversionEvent(data) {
        return this.request('/api/portal/conversions/log-event', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

};
