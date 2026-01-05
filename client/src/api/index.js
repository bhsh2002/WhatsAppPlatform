const API_BASE = import.meta.env.PROD ? '' : 'http://localhost:3031';

class ApiService {
    constructor(baseUrl = API_BASE) {
        this.baseUrl = baseUrl;
        this.authToken = localStorage.getItem('auth_token') || null;
    }

    setAuthToken(token) {
        this.authToken = token;
    }

    async request(endpoint, options = {}) {
        let url;
        const queryIndex = endpoint.indexOf('?');

        if (queryIndex !== -1) {
            const path = endpoint.substring(0, queryIndex);
            const query = endpoint.substring(queryIndex);
            url = `${this.baseUrl}${path}${path.endsWith('/') ? '' : '/'}${query}`;
        } else {
            url = `${this.baseUrl}${endpoint}${endpoint.endsWith('/') ? '' : '/'}`;
        }
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers,
        };

        // Add auth token if available
        if (this.authToken) {
            headers['Authorization'] = `Bearer ${this.authToken}`;
        }

        const config = {
            ...options,
            headers,
        };

        try {
            const response = await fetch(url, config);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || `HTTP ${response.status}`);
            }

            return data;
        } catch (error) {
            console.error(`[API] ${endpoint}:`, error);
            throw error;
        }
    }

    // Auth
    async login(username, password) {
        return this.request('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username, password }),
        });
    }

    async register(userData) {
        return this.request('/api/auth/register', {
            method: 'POST',
            body: JSON.stringify(userData),
        });
    }

    async getCurrentUser(token) {
        const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
        return this.request('/api/auth/me', { headers });
    }

    async changePassword(currentPassword, newPassword) {
        return this.request('/api/auth/change-password', {
            method: 'POST',
            body: JSON.stringify({ currentPassword, newPassword }),
        });
    }

    // Tenants
    async getTenants() {
        return this.request('/api/tenants');
    }

    async getTenant(id) {
        return this.request(`/api/tenants/${id}`);
    }

    async createTenant(data) {
        return this.request('/api/tenants', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async updateTenant(id, data) {
        return this.request(`/api/tenants/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    }

    async deleteTenant(id) {
        return this.request(`/api/tenants/${id}`, {
            method: 'DELETE',
        });
    }

    // Stats
    async getDashboardStats() {
        return this.request('/api/stats/dashboard');
    }

    async getActivity(limit = 10) {
        return this.request(`/api/stats/activity?limit=${limit}`);
    }

    // Messages
    async sendMessage(data) {
        return this.request('/api/messages/send', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async getMessageLogs(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/messages/logs${query ? '?' + query : ''}`);
    }

    async getWebhookLogs(limit = 50) {
        return this.request(`/api/messages/webhook-logs?limit=${limit}`);
    }

    async getConversations() {
        return this.request('/api/messages/conversations');
    }

    async getThreadMessages(phoneNumber, limit = 50, tenantId = null) {
        const query = tenantId ? `&tenant_id=${tenantId}` : '';
        return this.request(`/api/messages/conversations/${phoneNumber}/messages?limit=${limit}${query}`);
    }

    // Media
    async getMediaUrl(mediaId, tenantId = null) {
        const query = tenantId ? `?tenant_id=${tenantId}` : '';
        return this.request(`/api/messages/media/${mediaId}${query}`);
    }

    getMediaDownloadUrl(mediaId, tenantId = null) {
        const params = new URLSearchParams();
        if (tenantId) params.append('tenant_id', tenantId);
        if (this.authToken) params.append('token', this.authToken);

        const queryString = params.toString() ? `?${params.toString()}` : '';
        return `${this.baseUrl}/api/messages/media/${mediaId}/download${queryString}`;
    }

    async sendMediaMessage(data) {
        return this.request('/api/messages/send-media', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async sendMediaFile(formData) {
        // Use fetch directly for FormData to avoid Content-Type header issues with automatic JSON stringification in request() wrapper
        const headers = {};
        if (this.authToken) {
            headers['Authorization'] = `Bearer ${this.authToken}`;
        }

        const response = await fetch(`${this.baseUrl}/api/messages/send-media-file`, {
            method: 'POST',
            headers,
            body: formData,
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to send media file');
        }
        return data;
    }

    // Health
    async checkHealth() {
        return this.request('/api/health');
    }

    // ============================================
    // Admin - Tenant Account Management
    // ============================================
    async getTenantAccount(tenantId) {
        return this.request(`/api/tenants/${tenantId}/account`);
    }

    async createTenantAccount(tenantId, data) {
        return this.request(`/api/tenants/${tenantId}/create-account`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async updateTenantPassword(tenantId, password) {
        return this.request(`/api/tenants/${tenantId}/account/password`, {
            method: 'PUT',
            body: JSON.stringify({ password }),
        });
    }

    async toggleTenantAccount(tenantId) {
        return this.request(`/api/tenants/${tenantId}/account/toggle`, {
            method: 'PUT',
        });
    }

    async getTenantTemplates(tenantId) {
        return this.request(`/api/tenants/${tenantId}/templates`);
    }

    // ============================================
    // Tenant Portal APIs
    // ============================================
    async getPortalDashboard() {
        return this.request('/api/portal/dashboard');
    }

    async getPortalConversations() {
        return this.request('/api/portal/conversations');
    }

    async getPortalMessages(phone) {
        return this.request(`/api/portal/conversations/${phone}/messages`);
    }

    async sendPortalMessage(data) {
        return this.request('/api/portal/messages/send', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async getPortalTemplates() {
        return this.request('/api/portal/templates');
    }

    async getPortalTemplate(id) {
        return this.request(`/api/portal/templates/${id}`);
    }

    async createPortalTemplate(data) {
        return this.request('/api/portal/templates', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async updatePortalTemplate(id, data) {
        return this.request(`/api/portal/templates/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    }

    async deletePortalTemplate(id) {
        return this.request(`/api/portal/templates/${id}`, {
            method: 'DELETE',
        });
    }

    async syncPortalTemplates() {
        return this.request('/api/portal/templates/sync', {
            method: 'POST',
        });
    }

    async importPortalTemplate(templateData) {
        return this.request('/api/portal/templates/import', {
            method: 'POST',
            body: JSON.stringify(templateData),
        });
    }

    async getPortalApiSettings() {
        return this.request('/api/portal/settings/api');
    }

    async updatePortalApiSettings(data) {
        return this.request('/api/portal/settings/api', {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    }

    async regeneratePortalApiKey() {
        return this.request('/api/portal/settings/api/regenerate-key', {
            method: 'POST',
        });
    }

    async getPortalProfile() {
        return this.request('/api/portal/profile');
    }

    // ============================================
    // Admin Template Management
    // ============================================

    async getAdminTemplates(tenantId) {
        return this.request(`/api/tenants/${tenantId}/templates`);
    }

    async createAdminTemplate(tenantId, data) {
        return this.request(`/api/tenants/${tenantId}/templates`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async updateAdminTemplate(tenantId, templateId, data) {
        return this.request(`/api/tenants/${tenantId}/templates/${templateId}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    }

    async deleteAdminTemplate(tenantId, templateId) {
        return this.request(`/api/tenants/${tenantId}/templates/${templateId}`, {
            method: 'DELETE',
        });
    }

    async syncTemplatesFromMeta(tenantId) {
        return this.request(`/api/tenants/${tenantId}/templates/sync`, {
            method: 'POST',
        });
    }

    async importTemplateFromMeta(tenantId, templateData) {
        return this.request(`/api/tenants/${tenantId}/templates/import`, {
            method: 'POST',
            body: JSON.stringify(templateData),
        });
    }
}

const api = new ApiService();
export default api;



