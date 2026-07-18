export const metaAdminMethods = {
    // ============================================
    // Admin Template Management
    // ============================================

    async getAdminTemplates(tenantId) {
        return this.request(`/api/tenants/${tenantId}/templates`);
    },

    async createAdminTemplate(tenantId, data) {
        return this.request(`/api/tenants/${tenantId}/templates`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async updateAdminTemplate(tenantId, templateId, data) {
        return this.request(`/api/tenants/${tenantId}/templates/${templateId}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    },

    async deleteAdminTemplate(tenantId, templateId) {
        return this.request(`/api/tenants/${tenantId}/templates/${templateId}`, {
            method: 'DELETE',
        });
    },

    async syncTemplatesFromMeta(tenantId) {
        return this.request(`/api/tenants/${tenantId}/templates/sync`, {
            method: 'POST',
        });
    },

    async importTemplateFromMeta(tenantId, templateData) {
        return this.request(`/api/tenants/${tenantId}/templates/import`, {
            method: 'POST',
            body: JSON.stringify(templateData),
        });
    },

    // ============================================
    // Business Profile APIs
    // ============================================
    async getBusinessProfile(phoneNumberId, tenantId = null) {
        const query = tenantId ? `?tenant_id=${tenantId}` : '';
        return this.request(`/api/business-profile/${phoneNumberId}${query}`);
    },

    async updateBusinessProfile(phoneNumberId, data) {
        return this.request(`/api/business-profile/${phoneNumberId}`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async getMyBusinessProfile() {
        return this.request('/api/portal/business-profile');
    },

    async updateMyBusinessProfile(data) {
        return this.request('/api/portal/business-profile', {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    },

    // ============================================
    // Phone Numbers APIs
    // ============================================
    async getPhoneNumbers(wabaId, tenantId = null) {
        const query = tenantId ? `?tenant_id=${tenantId}` : '';
        return this.request(`/api/phone-numbers/${wabaId}${query}`);
    },

    async getPhoneNumberInfo(phoneNumberId, tenantId = null) {
        const query = tenantId ? `?tenant_id=${tenantId}` : '';
        return this.request(`/api/phone-numbers/info/${phoneNumberId}${query}`);
    },

    async registerPhoneNumber(phoneNumberId, data) {
        return this.request(`/api/phone-numbers/register/${phoneNumberId}`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    // ============================================
    // QR Codes APIs
    // ============================================
    async getQRCodes(phoneNumberId, tenantId = null) {
        const query = tenantId ? `?tenant_id=${tenantId}` : '';
        return this.request(`/api/qr-codes/${phoneNumberId}${query}`);
    },

    async createQRCode(phoneNumberId, data) {
        return this.request(`/api/qr-codes/${phoneNumberId}`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async deleteQRCode(phoneNumberId, qrCodeId, tenantId = null) {
        const query = tenantId ? `?tenant_id=${tenantId}` : '';
        return this.request(`/api/qr-codes/${phoneNumberId}/${qrCodeId}${query}`, {
            method: 'DELETE',
        });
    },

    // ============================================
    // Analytics APIs
    // ============================================
    async getConversationAnalytics(wabaId, params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/analytics/conversations/${wabaId}${query ? '?' + query : ''}`);
    },

    async getMessageAnalytics(wabaId, params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/analytics/messages/${wabaId}${query ? '?' + query : ''}`);
    },

    async getLocalAnalytics(tenantId = null) {
        const query = tenantId ? `?tenant_id=${tenantId}` : '';
        return this.request(`/api/analytics/local/summary${query}`);
    },

    // ============================================
    // Business Manager APIs
    // ============================================
    async getBusinessManagerInfo(businessId, tenantId = null) {
        const query = tenantId ? `?tenant_id=${tenantId}` : '';
        return this.request(`/api/business-manager/${businessId}${query}`);
    },

    async getAdAccounts(businessId, tenantId = null) {
        const query = tenantId ? `?tenant_id=${tenantId}` : '';
        return this.request(`/api/business-manager/${businessId}/ad-accounts${query}`);
    },

    async getBusinessAssets(businessId, tenantId = null) {
        const query = tenantId ? `?tenant_id=${tenantId}` : '';
        return this.request(`/api/business-manager/${businessId}/assets${query}`);
    },

    async claimAdAccount(businessId, tenantId, adAccountId) {
        return this.request(`/api/business-manager/${businessId}/claim-ad-account`, {
            method: 'POST',
            body: JSON.stringify({ tenant_id: tenantId, adaccount_id: adAccountId }),
        });
    },

    // ============================================
    // Facebook Pages APIs
    // ============================================
    async getMyPages(tenantId = null) {
        const query = tenantId ? `?tenant_id=${tenantId}` : '';
        return this.request(`/api/pages/me${query}`);
    },

    async getPageInfo(pageId, tenantId = null) {
        const query = tenantId ? `?tenant_id=${tenantId}` : '';
        return this.request(`/api/pages/${pageId}/info${query}`);
    },

    // ============================================
    // Facebook Page Linkage (Admin)
    // ============================================
    async getFbAllPages() {
        return this.request('/api/facebook-pages');
    },

    async getTenantPages(tenantId) {
        return this.request(`/api/facebook-pages/tenant/${tenantId}`);
    },

    async linkTenantPage(tenantId, data) {
        return this.request(`/api/facebook-pages/tenant/${tenantId}`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async updateTenantPage(pageId, data) {
        return this.request(`/api/facebook-pages/${pageId}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    },

    async unlinkTenantPage(pageId) {
        return this.request(`/api/facebook-pages/${pageId}`, {
            method: 'DELETE',
        });
    },

    async verifyTenantPage(pageId) {
        return this.request(`/api/facebook-pages/${pageId}/verify`, {
            method: 'POST',
        });
    },

    async subscribeTenantPage(pageId) {
        return this.request(`/api/facebook-pages/${pageId}/subscribe`, {
            method: 'POST',
        });
    },

    async getFacebookWebhookDiagnostic() {
        return this.request('/api/facebook-pages/webhook-diagnostic');
    },

    async setupFacebookAppWebhook(callbackUrl) {
        return this.request('/api/facebook-pages/setup-app-webhook', {
            method: 'POST',
            body: JSON.stringify(callbackUrl ? { callback_url: callbackUrl } : {}),
        });
    },

    // ============================================
    // Facebook Content Management (Admin)
    // ============================================
    async getFacebookPosts(linkedPageId, params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/fb-content/${linkedPageId}/posts${query ? '?' + query : ''}`);
    },

    async createFacebookPost(linkedPageId, data) {
        return this.request(`/api/fb-content/${linkedPageId}/posts`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async createFacebookPhotoPostUrl(linkedPageId, data) {
        return this.request(`/api/fb-content/${linkedPageId}/posts/photo`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async createFacebookPhotoPostFile(linkedPageId, formData) {
        const response = await fetch(`${this.baseUrl}/api/fb-content/${linkedPageId}/posts/photo`, {
            method: 'POST',
            credentials: 'include',
            body: formData,
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || `HTTP ${response.status}`);
        }
        return result;
    },

    async editFacebookPost(linkedPageId, postId, data) {
        return this.request(`/api/fb-content/${linkedPageId}/posts/${postId}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    },

    async deleteFacebookPost(linkedPageId, postId) {
        return this.request(`/api/fb-content/${linkedPageId}/posts/${postId}`, {
            method: 'DELETE',
        });
    },

    async getFacebookComments(linkedPageId, postId, params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/fb-content/${linkedPageId}/posts/${postId}/comments${query ? '?' + query : ''}`);
    },

    async getFacebookCommentReplies(linkedPageId, commentId, params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/fb-content/${linkedPageId}/comments/${commentId}/replies${query ? '?' + query : ''}`);
    },

    async replyToFacebookComment(linkedPageId, commentId, message) {
        return this.request(`/api/fb-content/${linkedPageId}/comments/${commentId}/reply`, {
            method: 'POST',
            body: JSON.stringify({ message }),
        });
    },

    async hideFacebookComment(linkedPageId, commentId, isHidden = true) {
        return this.request(`/api/fb-content/${linkedPageId}/comments/${commentId}/hide`, {
            method: 'POST',
            body: JSON.stringify({ is_hidden: isHidden }),
        });
    },

    async deleteFacebookComment(linkedPageId, commentId) {
        return this.request(`/api/fb-content/${linkedPageId}/comments/${commentId}`, {
            method: 'DELETE',
        });
    },

    async likeFacebookComment(linkedPageId, commentId) {
        return this.request(`/api/fb-content/${linkedPageId}/comments/${commentId}/like`, {
            method: 'POST',
        });
    },

    async unlikeFacebookComment(linkedPageId, commentId) {
        return this.request(`/api/fb-content/${linkedPageId}/comments/${commentId}/like`, {
            method: 'DELETE',
        });
    },

    async likeFacebookPost(linkedPageId, postId) {
        return this.request(`/api/fb-content/${linkedPageId}/posts/${postId}/like`, {
            method: 'POST',
        });
    },

    async unlikeFacebookPost(linkedPageId, postId) {
        return this.request(`/api/fb-content/${linkedPageId}/posts/${postId}/like`, {
            method: 'DELETE',
        });
    },

    async commentOnFacebookPost(linkedPageId, postId, message) {
        return this.request(`/api/fb-content/${linkedPageId}/posts/${postId}/comments`, {
            method: 'POST',
            body: JSON.stringify({ message }),
        });
    },

    // ============================================
    // Facebook Messenger (Admin)
    // ============================================
    async getMessengerConversations(linkedPageId) {
        return this.request(`/api/fb-messenger/${linkedPageId}/conversations`);
    },

    async getMessengerMessages(linkedPageId, conversationId, limit = 50) {
        return this.request(`/api/fb-messenger/${linkedPageId}/conversations/${conversationId}/messages?limit=${limit}`);
    },

    async sendMessengerReply(linkedPageId, conversationId, message) {
        return this.request(`/api/fb-messenger/${linkedPageId}/conversations/${conversationId}/send`, {
            method: 'POST',
            body: JSON.stringify({ message }),
        });
    },

    async markMessengerRead(linkedPageId, conversationId) {
        return this.request(`/api/fb-messenger/${linkedPageId}/conversations/${conversationId}/read`, {
            method: 'POST',
        });
    },

    async syncMessengerConversations(linkedPageId) {
        return this.request(`/api/fb-messenger/${linkedPageId}/sync`, {
            method: 'POST',
        });
    },

    async getAdminMessageTags() {
        return this.request('/api/fb-messenger/message-tags');
    },

    async sendAdminUtilityMessage(linkedPageId, convId, data) {
        return this.request(`/api/fb-messenger/${linkedPageId}/conversations/${convId}/utility-message`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    // ============================================
    // Facebook Content Studio (Admin)
    // ============================================
    async createContentStudioItemFromPost(tenantId, data) {
        return this.request('/api/content-studio/items/from-post', {
            method: 'POST',
            body: JSON.stringify({ ...data, tenant_id: tenantId }),
        });
    },

    async createContentStudioItemsFromPosts(tenantId, data) {
        return this.request('/api/content-studio/items/from-posts', {
            method: 'POST',
            body: JSON.stringify({ ...data, tenant_id: tenantId }),
        });
    },

    async createContentStudioItem(tenantId, data) {
        return this.request('/api/content-studio/items', {
            method: 'POST',
            body: JSON.stringify({ ...data, tenant_id: tenantId }),
        });
    },

    async approveContentStudioItem(tenantId, itemId) {
        return this.request(`/api/content-studio/items/${itemId}/approve`, {
            method: 'POST',
            body: JSON.stringify({ tenant_id: tenantId }),
        });
    },

    async generateContentStudioAi(tenantId, data) {
        return this.request('/api/content-studio/ai/generate', {
            method: 'POST',
            body: JSON.stringify({ ...data, tenant_id: tenantId }),
        });
    },

    async createContentStudioCampaign(tenantId, data) {
        return this.request('/api/content-studio/campaigns', {
            method: 'POST',
            body: JSON.stringify({ ...data, tenant_id: tenantId }),
        });
    },

    async getContentStudioPublications(tenantId, params = {}) {
        const query = new URLSearchParams({ ...params, tenant_id: tenantId }).toString();
        return this.request(`/api/content-studio/publications?${query}`);
    },

    async scheduleContentStudioPublication(tenantId, data) {
        return this.request('/api/content-studio/publications', {
            method: 'POST',
            body: JSON.stringify({ ...data, tenant_id: tenantId }),
        });
    },

    async getContentStudioCommentTemplates(tenantId, linkedPageId = null) {
        const query = new URLSearchParams({ tenant_id: tenantId });
        if (linkedPageId) query.set('linked_page_id', linkedPageId);
        return this.request(`/api/content-studio/comment-templates?${query}`);
    },

    async createContentStudioCommentTemplate(tenantId, data) {
        return this.request('/api/content-studio/comment-templates', {
            method: 'POST',
            body: JSON.stringify({ ...data, tenant_id: tenantId }),
        });
    },

    async updateContentStudioCommentTemplate(tenantId, templateId, data) {
        return this.request(`/api/content-studio/comment-templates/${templateId}`, {
            method: 'PATCH',
            body: JSON.stringify({ ...data, tenant_id: tenantId }),
        });
    },

    async deleteContentStudioCommentTemplate(tenantId, templateId) {
        return this.request(`/api/content-studio/comment-templates/${templateId}?tenant_id=${tenantId}`, {
            method: 'DELETE',
        });
    },

    async getContentStudioCommentFollowups(tenantId, params = {}) {
        const query = new URLSearchParams({ ...params, tenant_id: tenantId }).toString();
        return this.request(`/api/content-studio/comment-followups?${query}`);
    },

    async updateContentStudioCommentFollowup(tenantId, commentId, data) {
        return this.request(`/api/content-studio/comment-followups/${encodeURIComponent(commentId)}`, {
            method: 'PUT',
            body: JSON.stringify({ ...data, tenant_id: tenantId }),
        });
    },

    // ============================================
    // Messenger Bot (Admin)
    // ============================================
    async getMessengerBotSummary(tenantId) {
        const query = tenantId ? `?tenant_id=${tenantId}` : '';
        return this.request(`/api/messenger-bot/summary${query}`);
    },

    async getMessengerBotProducts(tenantId, params = {}) {
        const query = new URLSearchParams(params);
        if (tenantId) query.append('tenant_id', tenantId);
        return this.request(`/api/messenger-bot/products${query.toString() ? '?' + query.toString() : ''}`);
    },

    async createMessengerBotProduct(tenantId, data) {
        return this.request('/api/messenger-bot/products', {
            method: 'POST',
            body: JSON.stringify({ ...data, tenant_id: tenantId }),
        });
    },

    async updateMessengerBotProduct(tenantId, productId, data) {
        return this.request(`/api/messenger-bot/products/${productId}`, {
            method: 'PATCH',
            body: JSON.stringify({ ...data, tenant_id: tenantId }),
        });
    },

    async deleteMessengerBotProduct(tenantId, productId) {
        return this.request(`/api/messenger-bot/products/${productId}?tenant_id=${tenantId}`, {
            method: 'DELETE',
        });
    },

    async importMessengerBotProducts(tenantId, file) {
        const formData = new FormData();
        formData.append('tenant_id', tenantId);
        formData.append('file', file);
        const response = await fetch(`${this.baseUrl}/api/messenger-bot/products/import`, {
            method: 'POST',
            credentials: 'include',
            body: formData,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Import failed');
        return data;
    },

    async uploadMessengerBotAsset(tenantId, file) {
        const formData = new FormData();
        formData.append('tenant_id', tenantId);
        formData.append('file', file);
        const response = await fetch(`${this.baseUrl}/api/messenger-bot/assets/upload`, {
            method: 'POST',
            credentials: 'include',
            body: formData,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Upload failed');
        return data;
    },

    async getMessengerBotFlows(tenantId) {
        const query = tenantId ? `?tenant_id=${tenantId}` : '';
        return this.request(`/api/messenger-bot/flows${query}`);
    },

    async createMessengerBotFlow(tenantId, data) {
        return this.request('/api/messenger-bot/flows', {
            method: 'POST',
            body: JSON.stringify({ ...data, tenant_id: tenantId }),
        });
    },

    async updateMessengerBotFlow(tenantId, flowId, data) {
        return this.request(`/api/messenger-bot/flows/${flowId}`, {
            method: 'PUT',
            body: JSON.stringify({ ...data, tenant_id: tenantId }),
        });
    },

    async toggleMessengerBotFlow(tenantId, flowId) {
        return this.request(`/api/messenger-bot/flows/${flowId}/toggle`, {
            method: 'PATCH',
            body: JSON.stringify({ tenant_id: tenantId }),
        });
    },

    async deleteMessengerBotFlow(tenantId, flowId) {
        return this.request(`/api/messenger-bot/flows/${flowId}?tenant_id=${tenantId}`, {
            method: 'DELETE',
        });
    },

    async testMessengerBotFlow(tenantId, flowId) {
        return this.request(`/api/messenger-bot/flows/${flowId}/test`, {
            method: 'POST',
            body: JSON.stringify({ tenant_id: tenantId }),
        });
    },

    async getMessengerBotFlowEvents(tenantId, flowId, limit = 50) {
        const query = new URLSearchParams({ tenant_id: tenantId, limit: String(limit) });
        return this.request(`/api/messenger-bot/flows/${flowId}/events?${query.toString()}`);
    },

    async getMessengerBotSessions(tenantId, params = {}) {
        const query = new URLSearchParams(params);
        if (tenantId) query.append('tenant_id', tenantId);
        return this.request(`/api/messenger-bot/sessions${query.toString() ? '?' + query.toString() : ''}`);
    },

    async updateMessengerBotSession(tenantId, sessionId, status) {
        return this.request(`/api/messenger-bot/sessions/${sessionId}`, {
            method: 'PATCH',
            body: JSON.stringify({ tenant_id: tenantId, status }),
        });
    },
    // ============================================
    // Facebook Insights (Admin)
    // ============================================
    async getFbPageOverview(linkedPageId) {
        return this.request(`/api/fb-insights/${linkedPageId}/overview`);
    },

    async getFbPageDaily(linkedPageId, params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/fb-insights/${linkedPageId}/daily${query ? '?' + query : ''}`);
    },

    async getFbPostInsights(linkedPageId, params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/fb-insights/${linkedPageId}/posts${query ? '?' + query : ''}`);
    },

    // ============================================
    // Partner Solutions APIs
    // ============================================
    async getPartnerEvidence(tenantId) {
        const query = new URLSearchParams({ tenant_id: tenantId }).toString();
        return this.request(`/api/partner/evidence?${query}`);
    },

    async getPartnerClients(businessId, tenantId = null) {
        const query = new URLSearchParams({ business_id: businessId });
        if (tenantId) query.append('tenant_id', tenantId);
        return this.request(`/api/partner/clients?${query.toString()}`);
    },

    async addPartnerClient(data) {
        return this.request('/api/partner/clients', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async removePartnerClient(businessId, tenantId, clientBusinessId) {
        const query = new URLSearchParams({ business_id: businessId, tenant_id: tenantId }).toString();
        return this.request(`/api/partner/clients/${clientBusinessId}?${query}`, {
            method: 'DELETE',
        });
    },

    async getPartnerClientWaba(clientBusinessId, tenantId) {
        const query = tenantId ? `?tenant_id=${tenantId}` : '';
        return this.request(`/api/partner/clients/${clientBusinessId}/waba${query}`);
    },

    async createPartnerSystemUser(clientBusinessId, data) {
        return this.request(`/api/partner/clients/${clientBusinessId}/system-user`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    // ============================================
    // Conversions APIs
    // ============================================
    async getDatasets(wabaId, tenantId = null) {
        const query = tenantId ? `?tenant_id=${tenantId}` : '';
        return this.request(`/api/conversions/datasets/${wabaId}${query}`);
    },

    async sendConversionEvents(datasetId, data) {
        return this.request(`/api/conversions/events/${datasetId}`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async getConversionHistory(tenantId = null, params = {}) {
        const query = new URLSearchParams(params);
        if (tenantId) query.append('tenant_id', tenantId);
        return this.request(`/api/conversions/events/history?${query.toString()}`);
    },

    async logConversionEvent(data) {
        return this.request('/api/conversions/log-event', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    // ============================================
    // Meta Template Management (Admin)
    // ============================================
    async createMetaTemplate(tenantId, data) {
        return this.request(`/api/tenants/${tenantId}/templates/create-meta`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async deleteMetaTemplate(tenantId, name) {
        return this.request(`/api/tenants/${tenantId}/templates/delete-meta?name=${encodeURIComponent(name)}`, {
            method: 'DELETE',
        });
    },

    async subscribeWebhook(tenantId) {
        return this.request(`/api/tenants/${tenantId}/subscribe-webhook`, {
            method: 'POST',
        });
    },

    async getWebhookSubscriptions(tenantId) {
        return this.request(`/api/tenants/${tenantId}/webhook-subscriptions`);
    },

    async getSystemStatus() {
        return this.request('/api/settings/system-status');
    },

};
