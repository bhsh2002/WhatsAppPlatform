const API_BASE = import.meta.env.PROD ? '' : 'http://localhost:3031';

class ApiService {
    constructor(baseUrl = API_BASE) {
        this.baseUrl = baseUrl;
        this.authToken = localStorage.getItem('auth_token') || null;
    }

    setAuthToken(token) {
        this.authToken = token;
        // Reset media token when auth token changes
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

    async getSseToken() {
        return this.request('/api/auth/sse-token', {
            method: 'POST',
        });
    }

    // Get SSE connection URL with one-time token
    async getSseUrl(endpoint) {
        const { token } = await this.getSseToken();
        const baseUrl = import.meta.env.PROD ? '' : 'http://localhost:3031';
        return `${baseUrl}${endpoint}?token=${token}`;
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

    async uploadPortalMediaToMeta(file) {
        const formData = new FormData();
        formData.append('file', file);
        
        const headers = {};
        if (this.authToken) {
            headers['Authorization'] = `Bearer ${this.authToken}`;
        }
        
        const response = await fetch(`${this.baseUrl}/api/portal/media/upload-to-meta`, {
            method: 'POST',
            headers,
            body: formData,
        });
        
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Upload failed');
        }
        return data; // { id: '...' }
    }

    async uploadAdminMediaToMeta(tenantId, file) {
        const formData = new FormData();
        formData.append('tenant_id', tenantId);
        formData.append('file', file);

        const headers = {};
        if (this.authToken) {
            headers['Authorization'] = `Bearer ${this.authToken}`;
        }

        const response = await fetch(`${this.baseUrl}/api/messages/media/upload-to-meta`, {
            method: 'POST',
            headers,
            body: formData,
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Upload failed');
        }
        return data;
    }

    async sendPortalMessage(data) {
        return this.request('/api/portal/messages/send', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async sendPortalDocument(formData) {
        const headers = {};
        if (this.authToken) {
            headers['Authorization'] = `Bearer ${this.authToken}`;
        }

        const response = await fetch(`${this.baseUrl}/api/portal/messages/send-document`, {
            method: 'POST',
            headers,
            body: formData
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to send document');
        }
        return data;
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

    async sendPortalImage(formData) {
        const headers = {};
        if (this.authToken) {
            headers['Authorization'] = `Bearer ${this.authToken}`;
        }

        const response = await fetch(`${this.baseUrl}/api/portal/messages/send-image`, {
            method: 'POST',
            headers,
            body: formData
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to send image');
        }
        return data;
    }

    getPortalMediaDownloadUrl(mediaId) {
        const params = new URLSearchParams();
        if (this._mediaToken) params.append('media_token', this._mediaToken);
        const queryString = params.toString() ? `?${params.toString()}` : '';
        return `${this.baseUrl}/api/portal/media/${mediaId}/download${queryString}`;
    }

    async getPortalMediaDownloadUrlAsync(mediaId) {
        const mediaToken = await this.getMediaToken();
        const params = new URLSearchParams();
        if (mediaToken) params.append('media_token', mediaToken);
        const queryString = params.toString() ? `?${params.toString()}` : '';
        return `${this.baseUrl}/api/portal/media/${mediaId}/download${queryString}`;
    }

    async sendPortalInteractiveMessage(data) {
        return this.request('/api/portal/messages/send-interactive', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    // ============================================
    // Portal Unified Inbox (WhatsApp + Messenger)
    // ============================================

    async getPortalUnifiedConversations(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/portal/unified/conversations${query ? '?' + query : ''}`);
    }

    async getPortalUnifiedMessages(channel, contactId, params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/portal/unified/${channel}/${encodeURIComponent(contactId)}/messages${query ? '?' + query : ''}`);
    }

    async sendPortalUnifiedMessage(channel, contactId, data) {
        return this.request(`/api/portal/unified/${channel}/${encodeURIComponent(contactId)}/send`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async syncPortalMessenger() {
        return this.request('/api/portal/unified/messenger/sync', {
            method: 'POST',
        });
    }

    async sendInteractiveMessage(data) {
        return this.request('/api/messages/send-interactive', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async importPortalTemplate(templateData) {
        return this.request('/api/portal/templates/import', {
            method: 'POST',
            body: JSON.stringify(templateData),
        });
    }

    async createPortalTemplateMeta(data) {
        return this.request('/api/portal/templates/create-meta', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async deletePortalTemplateMeta(name) {
        return this.request(`/api/portal/templates/delete-meta?name=${encodeURIComponent(name)}`, {
            method: 'DELETE',
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

    async getPortalAnalytics() {
        return this.request('/api/portal/analytics/summary');
    }

    async getPortalQRCodes() {
        return this.request('/api/portal/qr-codes');
    }

    async createPortalQRCode(data) {
        return this.request('/api/portal/qr-codes', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async deletePortalQRCode(qrCodeId) {
        return this.request(`/api/portal/qr-codes/${qrCodeId}`, { method: 'DELETE' });
    }

    async getPortalConversionHistory() {
        return this.request('/api/portal/conversions/history');
    }

    async logPortalConversionEvent(data) {
        return this.request('/api/portal/conversions/log-event', {
            method: 'POST',
            body: JSON.stringify(data),
        });
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

    // ============================================
    // Business Profile APIs
    // ============================================
    async getBusinessProfile(phoneNumberId, tenantId = null) {
        const query = tenantId ? `?tenant_id=${tenantId}` : '';
        return this.request(`/api/business-profile/${phoneNumberId}${query}`);
    }

    async updateBusinessProfile(phoneNumberId, data) {
        return this.request(`/api/business-profile/${phoneNumberId}`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async getMyBusinessProfile() {
        return this.request('/api/portal/business-profile');
    }

    async updateMyBusinessProfile(data) {
        return this.request('/api/portal/business-profile', {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    }

    // ============================================
    // Phone Numbers APIs
    // ============================================
    async getPhoneNumbers(wabaId, tenantId = null) {
        const query = tenantId ? `?tenant_id=${tenantId}` : '';
        return this.request(`/api/phone-numbers/${wabaId}${query}`);
    }

    async getPhoneNumberInfo(phoneNumberId, tenantId = null) {
        const query = tenantId ? `?tenant_id=${tenantId}` : '';
        return this.request(`/api/phone-numbers/info/${phoneNumberId}${query}`);
    }

    async registerPhoneNumber(phoneNumberId, data) {
        return this.request(`/api/phone-numbers/register/${phoneNumberId}`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    // ============================================
    // QR Codes APIs
    // ============================================
    async getQRCodes(phoneNumberId, tenantId = null) {
        const query = tenantId ? `?tenant_id=${tenantId}` : '';
        return this.request(`/api/qr-codes/${phoneNumberId}${query}`);
    }

    async createQRCode(phoneNumberId, data) {
        return this.request(`/api/qr-codes/${phoneNumberId}`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async deleteQRCode(phoneNumberId, qrCodeId, tenantId = null) {
        const query = tenantId ? `?tenant_id=${tenantId}` : '';
        return this.request(`/api/qr-codes/${phoneNumberId}/${qrCodeId}${query}`, {
            method: 'DELETE',
        });
    }

    // ============================================
    // Analytics APIs
    // ============================================
    async getConversationAnalytics(wabaId, params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/analytics/conversations/${wabaId}${query ? '?' + query : ''}`);
    }

    async getMessageAnalytics(wabaId, params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/analytics/messages/${wabaId}${query ? '?' + query : ''}`);
    }

    async getLocalAnalytics(tenantId = null) {
        const query = tenantId ? `?tenant_id=${tenantId}` : '';
        return this.request(`/api/analytics/local/summary${query}`);
    }

    // ============================================
    // Business Manager APIs
    // ============================================
    async getBusinessManagerInfo(businessId, tenantId = null) {
        const query = tenantId ? `?tenant_id=${tenantId}` : '';
        return this.request(`/api/business-manager/${businessId}${query}`);
    }

    async getAdAccounts(businessId, tenantId = null) {
        const query = tenantId ? `?tenant_id=${tenantId}` : '';
        return this.request(`/api/business-manager/${businessId}/ad-accounts${query}`);
    }

    async getBusinessAssets(businessId, tenantId = null) {
        const query = tenantId ? `?tenant_id=${tenantId}` : '';
        return this.request(`/api/business-manager/${businessId}/assets${query}`);
    }

    async claimAdAccount(businessId, tenantId, adAccountId) {
        return this.request(`/api/business-manager/${businessId}/claim-ad-account`, {
            method: 'POST',
            body: JSON.stringify({ tenant_id: tenantId, adaccount_id: adAccountId }),
        });
    }

    // ============================================
    // Facebook Pages APIs
    // ============================================
    async getMyPages(tenantId = null) {
        const query = tenantId ? `?tenant_id=${tenantId}` : '';
        return this.request(`/api/pages/me${query}`);
    }

    async getPageInfo(pageId, tenantId = null) {
        const query = tenantId ? `?tenant_id=${tenantId}` : '';
        return this.request(`/api/pages/${pageId}/info${query}`);
    }

    // ============================================
    // Facebook Page Linkage (Admin)
    // ============================================
    async getFbAllPages() {
        return this.request('/api/facebook-pages');
    }

    async getTenantPages(tenantId) {
        return this.request(`/api/facebook-pages/tenant/${tenantId}`);
    }

    async linkTenantPage(tenantId, data) {
        return this.request(`/api/facebook-pages/tenant/${tenantId}`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async updateTenantPage(pageId, data) {
        return this.request(`/api/facebook-pages/${pageId}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    }

    async unlinkTenantPage(pageId) {
        return this.request(`/api/facebook-pages/${pageId}`, {
            method: 'DELETE',
        });
    }

    async verifyTenantPage(pageId) {
        return this.request(`/api/facebook-pages/${pageId}/verify`, {
            method: 'POST',
        });
    }

    async subscribeTenantPage(pageId) {
        return this.request(`/api/facebook-pages/${pageId}/subscribe`, {
            method: 'POST',
        });
    }

    async getFacebookWebhookDiagnostic() {
        return this.request('/api/facebook-pages/webhook-diagnostic');
    }

    async setupFacebookAppWebhook(callbackUrl) {
        return this.request('/api/facebook-pages/setup-app-webhook', {
            method: 'POST',
            body: JSON.stringify(callbackUrl ? { callback_url: callbackUrl } : {}),
        });
    }

    // ============================================
    // Facebook Content Management (Admin)
    // ============================================
    async getFacebookPosts(linkedPageId, params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/fb-content/${linkedPageId}/posts${query ? '?' + query : ''}`);
    }

    async createFacebookPost(linkedPageId, data) {
        return this.request(`/api/fb-content/${linkedPageId}/posts`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async createFacebookPhotoPostUrl(linkedPageId, data) {
        return this.request(`/api/fb-content/${linkedPageId}/posts/photo`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async createFacebookPhotoPostFile(linkedPageId, formData) {
        const headers = {};
        if (this.authToken) {
            headers['Authorization'] = `Bearer ${this.authToken}`;
        }
        const response = await fetch(`${this.baseUrl}/api/fb-content/${linkedPageId}/posts/photo`, {
            method: 'POST',
            headers,
            body: formData,
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || `HTTP ${response.status}`);
        }
        return result;
    }

    async editFacebookPost(linkedPageId, postId, data) {
        return this.request(`/api/fb-content/${linkedPageId}/posts/${postId}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    }

    async deleteFacebookPost(linkedPageId, postId) {
        return this.request(`/api/fb-content/${linkedPageId}/posts/${postId}`, {
            method: 'DELETE',
        });
    }

    async getFacebookComments(linkedPageId, postId, params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/fb-content/${linkedPageId}/posts/${postId}/comments${query ? '?' + query : ''}`);
    }

    async getFacebookCommentReplies(linkedPageId, commentId, params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/fb-content/${linkedPageId}/comments/${commentId}/replies${query ? '?' + query : ''}`);
    }

    async replyToFacebookComment(linkedPageId, commentId, message) {
        return this.request(`/api/fb-content/${linkedPageId}/comments/${commentId}/reply`, {
            method: 'POST',
            body: JSON.stringify({ message }),
        });
    }

    async hideFacebookComment(linkedPageId, commentId, isHidden = true) {
        return this.request(`/api/fb-content/${linkedPageId}/comments/${commentId}/hide`, {
            method: 'POST',
            body: JSON.stringify({ is_hidden: isHidden }),
        });
    }

    async deleteFacebookComment(linkedPageId, commentId) {
        return this.request(`/api/fb-content/${linkedPageId}/comments/${commentId}`, {
            method: 'DELETE',
        });
    }

    async likeFacebookComment(linkedPageId, commentId) {
        return this.request(`/api/fb-content/${linkedPageId}/comments/${commentId}/like`, {
            method: 'POST',
        });
    }

    async unlikeFacebookComment(linkedPageId, commentId) {
        return this.request(`/api/fb-content/${linkedPageId}/comments/${commentId}/like`, {
            method: 'DELETE',
        });
    }
    // ============================================
    // Facebook Messenger (Admin)
    // ============================================
    async getMessengerConversations(linkedPageId) {
        return this.request(`/api/fb-messenger/${linkedPageId}/conversations`);
    }

    async getMessengerMessages(linkedPageId, conversationId, limit = 50) {
        return this.request(`/api/fb-messenger/${linkedPageId}/conversations/${conversationId}/messages?limit=${limit}`);
    }

    async sendMessengerReply(linkedPageId, conversationId, message) {
        return this.request(`/api/fb-messenger/${linkedPageId}/conversations/${conversationId}/send`, {
            method: 'POST',
            body: JSON.stringify({ message }),
        });
    }

    async markMessengerRead(linkedPageId, conversationId) {
        return this.request(`/api/fb-messenger/${linkedPageId}/conversations/${conversationId}/read`, {
            method: 'POST',
        });
    }

    async syncMessengerConversations(linkedPageId) {
        return this.request(`/api/fb-messenger/${linkedPageId}/sync`, {
            method: 'POST',
        });
    }

    async getAdminMessageTags() {
        return this.request('/api/fb-messenger/message-tags');
    }

    async sendAdminUtilityMessage(linkedPageId, convId, data) {
        return this.request(`/api/fb-messenger/${linkedPageId}/conversations/${convId}/utility-message`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }
    // ============================================
    // Facebook Insights (Admin)
    // ============================================
    async getFbPageOverview(linkedPageId) {
        return this.request(`/api/fb-insights/${linkedPageId}/overview`);
    }

    async getFbPageDaily(linkedPageId, params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/fb-insights/${linkedPageId}/daily${query ? '?' + query : ''}`);
    }

    async getFbPostInsights(linkedPageId, params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/fb-insights/${linkedPageId}/posts${query ? '?' + query : ''}`);
    }

    // ============================================
    // Partner Solutions APIs
    // ============================================
    async getPartnerClients(businessId, tenantId = null) {
        const query = new URLSearchParams({ business_id: businessId });
        if (tenantId) query.append('tenant_id', tenantId);
        return this.request(`/api/partner/clients?${query.toString()}`);
    }

    async addPartnerClient(data) {
        return this.request('/api/partner/clients', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async removePartnerClient(businessId, tenantId, clientBusinessId) {
        const query = new URLSearchParams({ business_id: businessId, tenant_id: tenantId }).toString();
        return this.request(`/api/partner/clients/${clientBusinessId}?${query}`, {
            method: 'DELETE',
        });
    }

    async getPartnerClientWaba(clientBusinessId, tenantId) {
        const query = tenantId ? `?tenant_id=${tenantId}` : '';
        return this.request(`/api/partner/clients/${clientBusinessId}/waba${query}`);
    }

    async createPartnerSystemUser(clientBusinessId, data) {
        return this.request(`/api/partner/clients/${clientBusinessId}/system-user`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    // ============================================
    // Conversions APIs
    // ============================================
    async getDatasets(wabaId, tenantId = null) {
        const query = tenantId ? `?tenant_id=${tenantId}` : '';
        return this.request(`/api/conversions/datasets/${wabaId}${query}`);
    }

    async sendConversionEvents(datasetId, data) {
        return this.request(`/api/conversions/events/${datasetId}`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async getConversionHistory(tenantId = null, params = {}) {
        const query = new URLSearchParams(params);
        if (tenantId) query.append('tenant_id', tenantId);
        return this.request(`/api/conversions/events/history?${query.toString()}`);
    }

    async logConversionEvent(data) {
        return this.request('/api/conversions/log-event', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    // ============================================
    // Meta Template Management (Admin)
    // ============================================
    async createMetaTemplate(tenantId, data) {
        return this.request(`/api/tenants/${tenantId}/templates/create-meta`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async deleteMetaTemplate(tenantId, name) {
        return this.request(`/api/tenants/${tenantId}/templates/delete-meta?name=${encodeURIComponent(name)}`, {
            method: 'DELETE',
        });
    }

    async subscribeWebhook(tenantId) {
        return this.request(`/api/tenants/${tenantId}/subscribe-webhook`, {
            method: 'POST',
        });
    }

    async getWebhookSubscriptions(tenantId) {
        return this.request(`/api/tenants/${tenantId}/webhook-subscriptions`);
    }

    async getSystemStatus() {
        return this.request('/api/settings/system-status');
    }

    // ============================================
    // Contact Management (Admin)
    // ============================================
    async getContacts(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/messages/contacts${query ? '?' + query : ''}`);
    }

    async getContact(id) {
        return this.request(`/api/messages/contacts/${id}`);
    }

    async createContact(data) {
        return this.request('/api/messages/contacts', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async updateContact(id, data) {
        return this.request(`/api/messages/contacts/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    }

    async deleteContact(id) {
        return this.request(`/api/messages/contacts/${id}`, {
            method: 'DELETE',
        });
    }

    // ============================================
    // Contact Management (Tenant)
    // ============================================
    async getPortalContacts(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/portal/contacts${query ? '?' + query : ''}`);
    }

    async createPortalContact(data) {
        return this.request('/api/portal/contacts', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async updatePortalContact(id, data) {
        return this.request(`/api/portal/contacts/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    }

    async deletePortalContact(id) {
        return this.request(`/api/portal/contacts/${id}`, {
            method: 'DELETE',
        });
    }

    // ============================================
    // Broadcast
    // ============================================
    async broadcastMessage(data) {
        return this.request('/api/messages/broadcast', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async portalBroadcast(data) {
        return this.request('/api/portal/broadcast', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    // ============================================
    // Tenant Self-Registration
    // ============================================
    async registerTenant(data) {
        return this.request('/api/auth/register-tenant', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

// ============================================
    // 24h Window status (Tenant)
    // ============================================
    async getWindowStatus(phone) {
        return this.request(`/api/portal/messages/window/${encodeURIComponent(phone)}`);
    }

    // 24h Window status (Admin — for unified inbox)
    async getAdminWindowStatus(phone, tenantId) {
        const params = new URLSearchParams();
        if (tenantId) params.append('tenant_id', tenantId);
        const qs = params.toString() ? `?${params.toString()}` : '';
        return this.request(`/api/messages/window-status/${encodeURIComponent(phone)}${qs}`);
    }

    // ============================================
    // Credits Management (Admin)
    // ============================================
    async addTenantCredits(tenantId, amount) {
        return this.request(`/api/tenants/${tenantId}/credits`, {
            method: 'POST',
            body: JSON.stringify({ amount }),
        });
    }

    // ============================================
    // Token Health (Admin)
    // ============================================
    async getTokenHealthSummary() {
        return this.request('/api/tenants/token-health');
    }

    async checkTokenHealth(tenantId) {
        return this.request(`/api/tenants/${tenantId}/check-token`, {
            method: 'POST',
        });
    }

    // ============================================
    // Webhook Failures (Admin)
    // ============================================
    async getWebhookFailures(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/webhook-admin/failures${query ? '?' + query : ''}`);
    }

    async retryWebhookFailure(id) {
        return this.request(`/api/webhook-admin/failures/${id}/retry`, {
            method: 'POST',
        });
    }

    async deleteWebhookFailure(id) {
        return this.request(`/api/webhook-admin/failures/${id}`, {
            method: 'DELETE',
        });
    }

    async clearResolvedFailures() {
        return this.request('/api/webhook-admin/failures', {
            method: 'DELETE',
        });
    }

    async getWebhookFailureStats() {
        return this.request('/api/webhook-admin/stats');
    }

    // ============================================
    // Read Receipts
    // ============================================
    async markAsRead(data) {
        return this.request('/api/messages/mark-read', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async markAsReadPortal(data) {
        return this.request('/api/portal/mark-read', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    // ============================================
    // Broadcast Jobs
    // ============================================
    async getBroadcastJobs() {
        return this.request('/api/messages/broadcast-jobs');
    }

    async getBroadcastJob(id) {
        return this.request(`/api/messages/broadcast-jobs/${id}`);
    }

    async getPortalBroadcastJobs() {
        return this.request('/api/portal/broadcast-jobs');
    }

    async getPortalBroadcastJob(id) {
        return this.request(`/api/portal/broadcast-jobs/${id}`);
    }

    // ============================================
    // Unified Inbox (Admin)
    // ============================================
    async getUnifiedConversations(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/unified/conversations${query ? '?' + query : ''}`);
    }

    async getUnifiedMessages(channel, contactId, params = {}) {
        const query = new URLSearchParams(params).toString();
        const encodedId = encodeURIComponent(contactId);
        return this.request(`/api/unified/conversations/${channel}/${encodedId}/messages${query ? '?' + query : ''}`);
    }

    async sendUnifiedMessage(channel, contactId, payload) {
        const encodedId = encodeURIComponent(contactId);
        return this.request(`/api/unified/conversations/${channel}/${encodedId}/send`, {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    }

    async markUnifiedRead(channel, contactId, payload = {}) {
        const encodedId = encodeURIComponent(contactId);
        return this.request(`/api/unified/conversations/${channel}/${encodedId}/read`, {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    }

    // ============================================
    // Automation Rules
    // ============================================

    async getAutomationRules(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/automation/rules${query ? '?' + query : ''}`);
    }

    async getAutomationRule(id) {
        return this.request(`/api/automation/rules/${id}`);
    }

    async createAutomationRule(data) {
        return this.request('/api/automation/rules', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async updateAutomationRule(id, data) {
        return this.request(`/api/automation/rules/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    }

    async toggleAutomationRule(id) {
        return this.request(`/api/automation/rules/${id}/toggle`, {
            method: 'PATCH',
        });
    }

    async deleteAutomationRule(id) {
        return this.request(`/api/automation/rules/${id}`, {
            method: 'DELETE',
        });
    }

    async testAutomationRule(data) {
        return this.request('/api/automation/test', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async getAutomationSummary() {
        return this.request('/api/automation/summary');
    }

    // ============================================
    // Portal: Tenant Page Management
    // ============================================
    async getPortalPages() {
        return this.request('/api/portal/pages');
    }

    async getPortalPageSubscriptionStatus(pageId) {
        return this.request(`/api/portal/pages/${pageId}/subscription-status`);
    }

    // ============================================
    // Portal: Tenant Content Management
    // ============================================
    async getPortalFbPosts(linkedPageId, params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/portal/fb-content/${linkedPageId}/posts${query ? '?' + query : ''}`);
    }

    async createPortalFbPost(linkedPageId, data) {
        return this.request(`/api/portal/fb-content/${linkedPageId}/posts`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async createPortalFbPhotoPostUrl(linkedPageId, data) {
        return this.request(`/api/portal/fb-content/${linkedPageId}/posts/photo`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async createPortalFbPhotoPostFile(linkedPageId, formData) {
        const headers = {};
        if (this.authToken) {
            headers['Authorization'] = `Bearer ${this.authToken}`;
        }
        const response = await fetch(`${this.baseUrl}/api/portal/fb-content/${linkedPageId}/posts/photo`, {
            method: 'POST',
            headers,
            body: formData,
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || `HTTP ${response.status}`);
        }
        return result;
    }

    async editPortalFbPost(linkedPageId, postId, data) {
        return this.request(`/api/portal/fb-content/${linkedPageId}/posts/${postId}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    }

    async deletePortalFbPost(linkedPageId, postId) {
        return this.request(`/api/portal/fb-content/${linkedPageId}/posts/${postId}`, {
            method: 'DELETE',
        });
    }

    async getPortalFbComments(linkedPageId, postId, params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/portal/fb-content/${linkedPageId}/posts/${postId}/comments${query ? '?' + query : ''}`);
    }

    async getPortalFbCommentReplies(linkedPageId, commentId, params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/portal/fb-content/${linkedPageId}/comments/${commentId}/replies${query ? '?' + query : ''}`);
    }

    async replyPortalFbComment(linkedPageId, commentId, message) {
        return this.request(`/api/portal/fb-content/${linkedPageId}/comments/${commentId}/reply`, {
            method: 'POST',
            body: JSON.stringify({ message }),
        });
    }

    async hidePortalFbComment(linkedPageId, commentId, isHidden = true) {
        return this.request(`/api/portal/fb-content/${linkedPageId}/comments/${commentId}/hide`, {
            method: 'POST',
            body: JSON.stringify({ is_hidden: isHidden }),
        });
    }

    async deletePortalFbComment(linkedPageId, commentId) {
        return this.request(`/api/portal/fb-content/${linkedPageId}/comments/${commentId}`, {
            method: 'DELETE',
        });
    }

    async likePortalFbComment(linkedPageId, commentId) {
        return this.request(`/api/portal/fb-content/${linkedPageId}/comments/${commentId}/like`, {
            method: 'POST',
        });
    }

    async unlikePortalFbComment(linkedPageId, commentId) {
        return this.request(`/api/portal/fb-content/${linkedPageId}/comments/${commentId}/like`, {
            method: 'DELETE',
        });
    }

    // ============================================
    // Portal: Tenant Automation Rules
    // ============================================
    async getPortalAutomationRules(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/portal/automation/rules${query ? '?' + query : ''}`);
    }

    async getPortalAutomationRule(id) {
        return this.request(`/api/portal/automation/rules/${id}`);
    }

    async createPortalAutomationRule(data) {
        return this.request('/api/portal/automation/rules', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async updatePortalAutomationRule(id, data) {
        return this.request(`/api/portal/automation/rules/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    }

    async togglePortalAutomationRule(id) {
        return this.request(`/api/portal/automation/rules/${id}/toggle`, {
            method: 'PATCH',
        });
    }

    async deletePortalAutomationRule(id) {
        return this.request(`/api/portal/automation/rules/${id}`, {
            method: 'DELETE',
        });
    }

    async getPortalAutomationRuleStats(id) {
        return this.request(`/api/portal/automation/rules/${id}/stats`);
    }

    async getPortalAutomationSummary() {
        return this.request('/api/portal/automation/summary');
    }

    // ============================================
    // Portal: Tenant Facebook Insights
    // ============================================
    async getPortalFbOverview(linkedPageId) {
        return this.request(`/api/portal/fb-insights/${linkedPageId}/overview`);
    }

    async getPortalFbDaily(linkedPageId, params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/portal/fb-insights/${linkedPageId}/daily${query ? '?' + query : ''}`);
    }

    async getPortalFbPostInsights(linkedPageId, params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/portal/fb-insights/${linkedPageId}/posts${query ? '?' + query : ''}`);
    }

    // ============================================
    // Portal: Tenant Utility Messages
    // ============================================
    async getPortalMessageTags() {
        return this.request('/api/portal/fb-messenger/message-tags');
    }

    async sendPortalUtilityMessage(linkedPageId, convId, data) {
        return this.request(`/api/portal/fb-messenger/${linkedPageId}/conversations/${convId}/utility-message`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    // ============================================
    // Meta Self-Service Integration (Tenant)
    // ============================================
    async getMetaConfig() {
        return this.request('/api/portal/meta/config');
    }

    async getFacebookAuthUrl() {
        return this.request('/api/portal/facebook/auth-url');
    }

    async getFacebookDiagnostics() {
        return this.request('/api/portal/facebook/diagnostics');
    }

    async getMetaReviewReadiness() {
        return this.request('/api/portal/meta-review/readiness');
    }

    async getMetaReviewSnapshots(limit = 10) {
        return this.request(`/api/portal/meta-review/snapshots?limit=${limit}`);
    }

    async saveMetaReviewSnapshot() {
        return this.request('/api/portal/meta-review/snapshot', {
            method: 'POST',
        });
    }

    async connectFacebook(code, state) {
        return this.request('/api/portal/facebook/connect', {
            method: 'POST',
            body: JSON.stringify({ code, state }),
        });
    }

    async linkFacebookPages(linkState, pageIds) {
        return this.request('/api/portal/facebook/link-pages', {
            method: 'POST',
            body: JSON.stringify({ link_state: linkState, page_ids: pageIds }),
        });
    }

    async disconnectFacebookPage(linkedPageId) {
        return this.request(`/api/portal/facebook/disconnect/${linkedPageId}`, {
            method: 'DELETE',
        });
    }

    async connectWhatsApp(code, phoneNumberId, wabaId, businessId) {
        return this.request('/api/portal/whatsapp/connect', {
            method: 'POST',
            body: JSON.stringify({ code, phone_number_id: phoneNumberId, waba_id: wabaId, business_id: businessId }),
        });
    }
}

const api = new ApiService();
export default api;
