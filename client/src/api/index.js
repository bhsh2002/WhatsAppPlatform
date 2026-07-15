import { metaAdminMethods } from './metaAdmin';
import { operationsMethods } from './operations';
import { portalCoreMethods } from './portalCore';
import { tenantFacebookMethods } from './tenantFacebook';
import { tenantMetaMethods } from './tenantMeta';

// Keep browser traffic same-origin by default. In development Vite proxies
// /api/* to Express; in production Nginx does the same. VITE_API_URL remains
// an escape hatch for deployments that intentionally expose the API on a
// separate origin.
export const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

class ApiService {
    constructor(baseUrl = API_BASE) {
        this.baseUrl = baseUrl;
        this._legacyAuthToken = localStorage.getItem('auth_token') || null;
    }

    takeLegacyAuthToken() {
        const token = this._legacyAuthToken;
        this._legacyAuthToken = null;
        localStorage.removeItem('auth_token');
        return token;
    }

    resetSessionCaches() {
        this._mediaToken = null;
        this._mediaTokenExpiry = 0;
    }

    /**
     * Get a short-lived media token for use in <img>/<video> src URLs.
     * Cached and auto-refreshed when expired.
     */
    async getMediaToken() {
        const now = Date.now();
        // Refresh if expired or within 30 seconds of expiry
        if (this._mediaToken && this._mediaTokenExpiry > now + 30000) {
            return this._mediaToken;
        }
        try {
            const data = await this.request('/api/auth/media-token', { method: 'POST' });
            this._mediaToken = data.media_token;
            this._mediaTokenExpiry = now + (data.expires_in * 1000);
            return this._mediaToken;
        } catch (err) {
            console.error('[API] Failed to get media token:', err);
            return null;
        }
    }

    async request(endpoint, options = {}) {
        const { suppressErrorStatuses = [], ...fetchOptions } = options;
        let url;
        const queryIndex = endpoint.indexOf('?');

        if (queryIndex !== -1) {
            const path = endpoint.substring(0, queryIndex);
            const query = endpoint.substring(queryIndex);
            url = `${this.baseUrl}${path}${path.endsWith('/') ? '' : '/'}${query}`;
        } else {
            url = `${this.baseUrl}${endpoint}${endpoint.endsWith('/') ? '' : '/'}`;
        }
        const isFormData = typeof FormData !== 'undefined' && fetchOptions.body instanceof FormData;
        const headers = {
            ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
            ...fetchOptions.headers,
        };

        const config = {
            credentials: 'include',
            ...fetchOptions,
            headers,
        };

        try {
            const response = await fetch(url, config);
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
        } catch (error) {
            if (!suppressErrorStatuses.includes(error.status)) {
                console.error(`[API] ${endpoint}:`, error);
            }
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

    async getCurrentUser() {
        return this.request('/api/auth/session');
    }

    async adoptLegacySession(token) {
        return this.request('/api/auth/session', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            suppressErrorStatuses: [401, 403],
        });
    }

    async changePassword(currentPassword, newPassword) {
        return this.request('/api/auth/change-password', {
            method: 'POST',
            body: JSON.stringify({ currentPassword, newPassword }),
        });
    }

    async logout() {
        return this.request('/api/auth/logout', {
            method: 'POST',
        });
    }

    async getSseToken() {
        return this.request('/api/auth/sse-token', {
            method: 'POST',
        });
    }

    // Get SSE connection URL with one-time token
    async getSseUrl(endpoint) {
        const { token } = await this.getSseToken();
        return `${this.baseUrl}${endpoint}?token=${token}`;
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

    async updateTenantMetaSettings(id, data) {
        return this.request(`/api/tenants/${id}/meta-settings`, {
            method: 'PATCH',
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

    async getConversations(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/messages/conversations${query ? `?${query}` : ''}`);
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
        if (this._mediaToken) params.append('media_token', this._mediaToken);

        const queryString = params.toString() ? `?${params.toString()}` : '';
        return `${this.baseUrl}/api/messages/media/${mediaId}/download${queryString}`;
    }

    async getMediaDownloadUrlAsync(mediaId, tenantId = null) {
        const mediaToken = await this.getMediaToken();
        const params = new URLSearchParams();
        if (tenantId) params.append('tenant_id', tenantId);
        if (mediaToken) params.append('media_token', mediaToken);

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
        const response = await fetch(`${this.baseUrl}/api/messages/send-media-file`, {
            method: 'POST',
            credentials: 'include',
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

Object.assign(
    ApiService.prototype,
    portalCoreMethods,
    metaAdminMethods,
    operationsMethods,
    tenantFacebookMethods,
    tenantMetaMethods,
);

const api = new ApiService();
export default api;
