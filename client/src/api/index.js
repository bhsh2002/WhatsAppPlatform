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
        const url = `${this.baseUrl}${endpoint}/`;
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

    async getMediaDownloadUrl(mediaId, tenantId = null) {
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
}

const api = new ApiService();
export default api;

