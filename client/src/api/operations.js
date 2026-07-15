const parseApiResponse = async response => {
    const text = await response.text();
    let data = {};
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = { error: text };
        }
    }
    if (!response.ok) {
        const error = new Error(data.error || `HTTP ${response.status}`);
        error.status = response.status;
        error.data = data;
        throw error;
    }
    return data;
};

const extractDownloadFilename = (response, fallback) => {
    const disposition = response.headers.get('content-disposition') || '';
    const match = disposition.match(/filename="?([^";]+)"?/i);
    return match?.[1] || fallback;
};

export const operationsMethods = {
    // ============================================
    // Contact Management (Admin)
    // ============================================
    async getContacts(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/messages/contacts${query ? '?' + query : ''}`);
    },

    async getContact(id) {
        return this.request(`/api/messages/contacts/${id}`);
    },

    async createContact(data) {
        return this.request('/api/messages/contacts', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async updateContact(id, data) {
        return this.request(`/api/messages/contacts/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    },

    async deleteContact(id) {
        return this.request(`/api/messages/contacts/${id}`, {
            method: 'DELETE',
        });
    },

    async importContactsCsv(file, tenantId) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('tenant_id', tenantId);
        const response = await fetch(`${this.baseUrl}/api/messages/contacts/import`, {
            method: 'POST',
            credentials: 'include',
            body: formData,
        });
        return parseApiResponse(response);
    },

    async exportContactsCsv(params = {}) {
        const query = new URLSearchParams(params).toString();
        const response = await fetch(`${this.baseUrl}/api/messages/contacts/export${query ? `?${query}` : ''}`, {
            credentials: 'include',
        });
        if (!response.ok) await parseApiResponse(response);
        return {
            blob: await response.blob(),
            filename: extractDownloadFilename(response, 'contacts.csv'),
        };
    },

    // ============================================
    // Contact Management (Tenant)
    // ============================================
    async getPortalContacts(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/portal/contacts${query ? '?' + query : ''}`);
    },

    async createPortalContact(data) {
        return this.request('/api/portal/contacts', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async updatePortalContact(id, data) {
        return this.request(`/api/portal/contacts/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    },

    async deletePortalContact(id) {
        return this.request(`/api/portal/contacts/${id}`, {
            method: 'DELETE',
        });
    },

    async importPortalContactsCsv(file) {
        const formData = new FormData();
        formData.append('file', file);
        const response = await fetch(`${this.baseUrl}/api/portal/contacts/import`, {
            method: 'POST',
            credentials: 'include',
            body: formData,
        });
        return parseApiResponse(response);
    },

    async exportPortalContactsCsv(params = {}) {
        const query = new URLSearchParams(params).toString();
        const response = await fetch(`${this.baseUrl}/api/portal/contacts/export${query ? `?${query}` : ''}`, {
            credentials: 'include',
        });
        if (!response.ok) await parseApiResponse(response);
        return {
            blob: await response.blob(),
            filename: extractDownloadFilename(response, 'contacts.csv'),
        };
    },

    // ============================================
    // Broadcast
    // ============================================
    async broadcastMessage(data) {
        return this.request('/api/messages/broadcast', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async portalBroadcast(data) {
        return this.request('/api/portal/broadcast', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    // ============================================
    // Tenant Self-Registration
    // ============================================
    async registerTenant(data) {
        return this.request('/api/auth/register-tenant', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

// ============================================
    // 24h Window status (Tenant)
    // ============================================
    async getWindowStatus(phone) {
        return this.request(`/api/portal/messages/window/${encodeURIComponent(phone)}`);
    },

    // 24h Window status (Admin — for unified inbox)
    async getAdminWindowStatus(phone, tenantId) {
        const params = new URLSearchParams();
        if (tenantId) params.append('tenant_id', tenantId);
        const qs = params.toString() ? `?${params.toString()}` : '';
        return this.request(`/api/messages/window-status/${encodeURIComponent(phone)}${qs}`);
    },

    // ============================================
    // Credits Management (Admin)
    // ============================================
    async addTenantCredits(tenantId, amount) {
        return this.request(`/api/tenants/${tenantId}/credits`, {
            method: 'POST',
            body: JSON.stringify({ amount }),
        });
    },

    // ============================================
    // Billing / Pricing
    // ============================================
    async getBillingPlans() {
        return this.request('/api/billing/plans');
    },

    async createBillingPlan(data) {
        return this.request('/api/billing/plans', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async updateBillingPlan(id, data) {
        return this.request(`/api/billing/plans/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    },

    async getBillingPrices() {
        return this.request('/api/billing/prices');
    },

    async updateBillingPrice(id, data) {
        return this.request(`/api/billing/prices/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    },

    async getMetaBillingRates(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/billing/meta/rates${query ? '?' + query : ''}`);
    },

    async createMetaBillingRate(data) {
        return this.request('/api/billing/meta/rates', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async updateMetaBillingRate(id, data) {
        return this.request(`/api/billing/meta/rates/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    },

    async importMetaBillingRates(formData) {
        return this.request('/api/billing/meta/rates/import', {
            method: 'POST',
            body: formData,
        });
    },

    async getMetaBillingSummary(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/billing/meta/summary${query ? '?' + query : ''}`);
    },

    async getMetaBillingSettings() {
        return this.request('/api/billing/meta/settings');
    },

    async updateMetaBillingSettings(data) {
        return this.request('/api/billing/meta/settings', {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    },

    async getMetaReconciliation(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/billing/meta/reconciliation${query ? '?' + query : ''}`);
    },

    async syncMetaReconciliation(data) {
        return this.request('/api/billing/meta/reconciliation/sync', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async markMetaReconciliationReviewed(id) {
        return this.request(`/api/billing/meta/reconciliation/${id}/mark-reviewed`, {
            method: 'POST',
        });
    },

    async getMetaBillingUsage(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/billing/meta/usage${query ? '?' + query : ''}`);
    },

    async getMetaUsageSnapshots(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/billing/meta/usage/snapshots${query ? '?' + query : ''}`);
    },

    async getMetaUsageComparison(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/billing/meta/usage/comparison${query ? '?' + query : ''}`);
    },

    async syncMetaUsage(data) {
        return this.request('/api/billing/meta/usage/sync', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async getMetaInvoices(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/billing/meta/invoices${query ? '?' + query : ''}`);
    },

    async createMetaInvoice(data) {
        return this.request('/api/billing/meta/invoices', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async syncMetaInvoices(data) {
        return this.request('/api/billing/meta/invoices/sync', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async getTenantBilling(tenantId, params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/tenants/${tenantId}/billing${query ? '?' + query : ''}`);
    },

    async updateTenantBillingAccount(tenantId, data) {
        return this.request(`/api/tenants/${tenantId}/billing/account`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    },

    async recordTenantPayment(tenantId, data) {
        return this.request(`/api/tenants/${tenantId}/billing/payments`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async recordTenantAdjustment(tenantId, data) {
        return this.request(`/api/tenants/${tenantId}/billing/adjustments`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async renewTenantBillingCycle(tenantId) {
        return this.request(`/api/tenants/${tenantId}/billing/renew-cycle`, {
            method: 'POST',
        });
    },

    async getTenantBillingLedger(tenantId, params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/tenants/${tenantId}/billing/ledger${query ? '?' + query : ''}`);
    },

    async getTenantBillingInvoices(tenantId, params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/tenants/${tenantId}/billing/invoices${query ? '?' + query : ''}`);
    },

    async createTenantBillingInvoice(tenantId, data = {}) {
        return this.request(`/api/tenants/${tenantId}/billing/invoices`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async getPortalBillingSummary(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/portal/billing/summary${query ? '?' + query : ''}`);
    },

    async getPortalBillingLedger(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/portal/billing/ledger${query ? '?' + query : ''}`);
    },

    async getPortalBillingInvoices(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/portal/billing/invoices${query ? '?' + query : ''}`);
    },

    // ============================================
    // Token Health (Admin)
    // ============================================
    async getTokenHealthSummary() {
        return this.request('/api/tenants/token-health');
    },

    async checkTokenHealth(tenantId) {
        return this.request(`/api/tenants/${tenantId}/check-token`, {
            method: 'POST',
        });
    },

    // ============================================
    // Webhook Failures (Admin)
    // ============================================
    async getWebhookFailures(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/webhook-admin/failures${query ? '?' + query : ''}`);
    },

    async retryWebhookFailure(id) {
        return this.request(`/api/webhook-admin/failures/${id}/retry`, {
            method: 'POST',
        });
    },

    async deleteWebhookFailure(id) {
        return this.request(`/api/webhook-admin/failures/${id}`, {
            method: 'DELETE',
        });
    },

    async clearResolvedFailures() {
        return this.request('/api/webhook-admin/failures', {
            method: 'DELETE',
        });
    },

    async getWebhookFailureStats() {
        return this.request('/api/webhook-admin/stats');
    },

    // ============================================
    // Read Receipts
    // ============================================
    async markAsRead(data) {
        return this.request('/api/messages/mark-read', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async markAsReadPortal(data) {
        return this.request('/api/portal/mark-read', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    // ============================================
    // Broadcast Jobs
    // ============================================
    async getBroadcastJobs() {
        return this.request('/api/messages/broadcast-jobs');
    },

    async getBroadcastJob(id) {
        return this.request(`/api/messages/broadcast-jobs/${id}`);
    },

    async getPortalBroadcastJobs() {
        return this.request('/api/portal/broadcast-jobs');
    },

    async getPortalBroadcastJob(id) {
        return this.request(`/api/portal/broadcast-jobs/${id}`);
    },

    // ============================================
    // Unified Inbox (Admin)
    // ============================================
    async getUnifiedConversations(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/unified/conversations${query ? '?' + query : ''}`);
    },

    async getUnifiedMessages(channel, contactId, params = {}) {
        const query = new URLSearchParams(params).toString();
        const encodedId = encodeURIComponent(contactId);
        return this.request(`/api/unified/conversations/${channel}/${encodedId}/messages${query ? '?' + query : ''}`);
    },

    async sendUnifiedMessage(channel, contactId, payload) {
        const encodedId = encodeURIComponent(contactId);
        return this.request(`/api/unified/conversations/${channel}/${encodedId}/send`, {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    },

    async markUnifiedRead(channel, contactId, payload = {}) {
        const encodedId = encodeURIComponent(contactId);
        return this.request(`/api/unified/conversations/${channel}/${encodedId}/read`, {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    },

    // ============================================
    // Automation Rules
    // ============================================

    async getAutomationRules(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/automation/rules${query ? '?' + query : ''}`);
    },

    async getAutomationRule(id) {
        return this.request(`/api/automation/rules/${id}`);
    },

    async createAutomationRule(data) {
        return this.request('/api/automation/rules', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async updateAutomationRule(id, data) {
        return this.request(`/api/automation/rules/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    },

    async toggleAutomationRule(id) {
        return this.request(`/api/automation/rules/${id}/toggle`, {
            method: 'PATCH',
        });
    },

    async deleteAutomationRule(id) {
        return this.request(`/api/automation/rules/${id}`, {
            method: 'DELETE',
        });
    },

    async testAutomationRule(data) {
        return this.request('/api/automation/test', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async getAutomationSummary() {
        return this.request('/api/automation/summary');
    },

};
