export const tenantFacebookMethods = {
    // ============================================
    // Portal: Tenant Page Management
    // ============================================
    async getPortalPages() {
        return this.request('/api/portal/pages');
    },

    async getPortalPageSubscriptionStatus(pageId) {
        return this.request(`/api/portal/pages/${pageId}/subscription-status`);
    },

    // ============================================
    // Portal: Tenant Content Management
    // ============================================
    async getPortalFbPosts(linkedPageId, params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/portal/fb-content/${linkedPageId}/posts${query ? '?' + query : ''}`);
    },

    async createPortalFbPost(linkedPageId, data) {
        return this.request(`/api/portal/fb-content/${linkedPageId}/posts`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async createPortalFbPhotoPostUrl(linkedPageId, data) {
        return this.request(`/api/portal/fb-content/${linkedPageId}/posts/photo`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async createPortalFbPhotoPostFile(linkedPageId, formData) {
        const response = await fetch(`${this.baseUrl}/api/portal/fb-content/${linkedPageId}/posts/photo`, {
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

    async editPortalFbPost(linkedPageId, postId, data) {
        return this.request(`/api/portal/fb-content/${linkedPageId}/posts/${postId}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    },

    async deletePortalFbPost(linkedPageId, postId) {
        return this.request(`/api/portal/fb-content/${linkedPageId}/posts/${postId}`, {
            method: 'DELETE',
        });
    },

    async getPortalFbComments(linkedPageId, postId, params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/portal/fb-content/${linkedPageId}/posts/${postId}/comments${query ? '?' + query : ''}`);
    },

    async getPortalFbCommentReplies(linkedPageId, commentId, params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/portal/fb-content/${linkedPageId}/comments/${commentId}/replies${query ? '?' + query : ''}`);
    },

    async replyPortalFbComment(linkedPageId, commentId, message) {
        return this.request(`/api/portal/fb-content/${linkedPageId}/comments/${commentId}/reply`, {
            method: 'POST',
            body: JSON.stringify({ message }),
        });
    },

    async hidePortalFbComment(linkedPageId, commentId, isHidden = true) {
        return this.request(`/api/portal/fb-content/${linkedPageId}/comments/${commentId}/hide`, {
            method: 'POST',
            body: JSON.stringify({ is_hidden: isHidden }),
        });
    },

    async deletePortalFbComment(linkedPageId, commentId) {
        return this.request(`/api/portal/fb-content/${linkedPageId}/comments/${commentId}`, {
            method: 'DELETE',
        });
    },

    async likePortalFbComment(linkedPageId, commentId) {
        return this.request(`/api/portal/fb-content/${linkedPageId}/comments/${commentId}/like`, {
            method: 'POST',
        });
    },

    async unlikePortalFbComment(linkedPageId, commentId) {
        return this.request(`/api/portal/fb-content/${linkedPageId}/comments/${commentId}/like`, {
            method: 'DELETE',
        });
    },

    async likePortalFbPost(linkedPageId, postId) {
        return this.request(`/api/portal/fb-content/${linkedPageId}/posts/${postId}/like`, {
            method: 'POST',
        });
    },

    async unlikePortalFbPost(linkedPageId, postId) {
        return this.request(`/api/portal/fb-content/${linkedPageId}/posts/${postId}/like`, {
            method: 'DELETE',
        });
    },

    async commentOnPortalFbPost(linkedPageId, postId, message) {
        return this.request(`/api/portal/fb-content/${linkedPageId}/posts/${postId}/comments`, {
            method: 'POST',
            body: JSON.stringify({ message }),
        });
    },

    // ============================================
    // Portal: Facebook Content Studio
    // ============================================
    async getPortalContentStudioReadiness() {
        return this.request('/api/portal/content-studio/readiness');
    },

    async getPortalContentStudioSettings(linkedPageId = null) {
        const query = linkedPageId ? `?linked_page_id=${encodeURIComponent(linkedPageId)}` : '';
        return this.request(`/api/portal/content-studio/settings${query}`);
    },

    async updatePortalContentStudioSettings(data) {
        return this.request('/api/portal/content-studio/settings', {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    },

    async resetPortalContentStudioPageSettings(linkedPageId) {
        return this.request(`/api/portal/content-studio/settings/pages/${linkedPageId}`, {
            method: 'DELETE',
        });
    },

    async getPortalContentStudioProducts(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/portal/content-studio/products${query ? '?' + query : ''}`);
    },

    async getPortalContentStudioItems(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/portal/content-studio/items${query ? '?' + query : ''}`);
    },

    async createPortalContentStudioItem(data) {
        return this.request('/api/portal/content-studio/items', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async createPortalContentStudioItemFromPost(data) {
        return this.request('/api/portal/content-studio/items/from-post', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async createPortalContentStudioItemsFromPosts(data) {
        return this.request('/api/portal/content-studio/items/from-posts', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async createPortalContentStudioItemFromProduct(productId, data = {}) {
        return this.request(`/api/portal/content-studio/items/from-product/${productId}`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async updatePortalContentStudioItem(itemId, data) {
        return this.request(`/api/portal/content-studio/items/${itemId}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    },

    async approvePortalContentStudioItem(itemId) {
        return this.request(`/api/portal/content-studio/items/${itemId}/approve`, {
            method: 'POST',
        });
    },

    async archivePortalContentStudioItem(itemId) {
        return this.request(`/api/portal/content-studio/items/${itemId}`, {
            method: 'DELETE',
        });
    },

    async generatePortalContentStudioAi(data) {
        return this.request('/api/portal/content-studio/ai/generate', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async getPortalContentStudioAiHistory(limit = 25) {
        return this.request(`/api/portal/content-studio/ai/history?limit=${limit}`);
    },

    async getPortalContentStudioCampaigns(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/portal/content-studio/campaigns${query ? '?' + query : ''}`);
    },

    async createPortalContentStudioCampaign(data) {
        return this.request('/api/portal/content-studio/campaigns', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async updatePortalContentStudioCampaign(campaignId, data) {
        return this.request(`/api/portal/content-studio/campaigns/${campaignId}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    },

    async togglePortalContentStudioCampaign(campaignId) {
        return this.request(`/api/portal/content-studio/campaigns/${campaignId}/toggle`, {
            method: 'POST',
        });
    },

    async runPortalContentStudioCampaignNow(campaignId) {
        return this.request(`/api/portal/content-studio/campaigns/${campaignId}/run-now`, {
            method: 'POST',
        });
    },

    async completePortalContentStudioCampaign(campaignId) {
        return this.request(`/api/portal/content-studio/campaigns/${campaignId}`, {
            method: 'DELETE',
        });
    },

    async getPortalContentStudioPublications(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/portal/content-studio/publications${query ? '?' + query : ''}`);
    },

    async schedulePortalContentStudioPublication(data) {
        return this.request('/api/portal/content-studio/publications', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async retryPortalContentStudioPublication(publicationId) {
        return this.request(`/api/portal/content-studio/publications/${publicationId}/retry`, {
            method: 'POST',
        });
    },

    async publishPortalContentStudioPublicationNow(publicationId) {
        return this.request(`/api/portal/content-studio/publications/${publicationId}/publish-now`, {
            method: 'POST',
        });
    },

    async cancelPortalContentStudioPublication(publicationId) {
        return this.request(`/api/portal/content-studio/publications/${publicationId}`, {
            method: 'DELETE',
        });
    },

    async getPortalContentStudioCommentTemplates(linkedPageId = null) {
        const query = linkedPageId
            ? `?linked_page_id=${encodeURIComponent(linkedPageId)}`
            : '';
        return this.request(`/api/portal/content-studio/comment-templates${query}`);
    },

    async createPortalContentStudioCommentTemplate(data) {
        return this.request('/api/portal/content-studio/comment-templates', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async updatePortalContentStudioCommentTemplate(templateId, data) {
        return this.request(`/api/portal/content-studio/comment-templates/${templateId}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    },

    async deletePortalContentStudioCommentTemplate(templateId) {
        return this.request(`/api/portal/content-studio/comment-templates/${templateId}`, {
            method: 'DELETE',
        });
    },

    async getPortalContentStudioCommentFollowups(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/portal/content-studio/comment-followups${query ? '?' + query : ''}`);
    },

    async updatePortalContentStudioCommentFollowup(commentId, data) {
        return this.request(`/api/portal/content-studio/comment-followups/${encodeURIComponent(commentId)}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    },

    // ============================================
    // Portal: Tenant Automation Rules
    // ============================================
    async getPortalAutomationRules(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/portal/automation/rules${query ? '?' + query : ''}`);
    },

    async getPortalAutomationRule(id) {
        return this.request(`/api/portal/automation/rules/${id}`);
    },

    async createPortalAutomationRule(data) {
        return this.request('/api/portal/automation/rules', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async updatePortalAutomationRule(id, data) {
        return this.request(`/api/portal/automation/rules/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    },

    async togglePortalAutomationRule(id) {
        return this.request(`/api/portal/automation/rules/${id}/toggle`, {
            method: 'PATCH',
        });
    },

    async deletePortalAutomationRule(id) {
        return this.request(`/api/portal/automation/rules/${id}`, {
            method: 'DELETE',
        });
    },

    async getPortalAutomationRuleStats(id) {
        return this.request(`/api/portal/automation/rules/${id}/stats`);
    },

    async getPortalAutomationSummary() {
        return this.request('/api/portal/automation/summary');
    },

    // ============================================
    // Portal: Tenant Facebook Insights
    // ============================================
    async getPortalFbOverview(linkedPageId) {
        return this.request(`/api/portal/fb-insights/${linkedPageId}/overview`);
    },

    async getPortalFbDaily(linkedPageId, params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/portal/fb-insights/${linkedPageId}/daily${query ? '?' + query : ''}`);
    },

    async getPortalFbPostInsights(linkedPageId, params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/portal/fb-insights/${linkedPageId}/posts${query ? '?' + query : ''}`);
    },

    // ============================================
    // Portal: Tenant Utility Messages
    // ============================================
    async getPortalMessageTags() {
        return this.request('/api/portal/fb-messenger/message-tags');
    },

    async sendPortalUtilityMessage(linkedPageId, convId, data) {
        return this.request(`/api/portal/fb-messenger/${linkedPageId}/conversations/${convId}/utility-message`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    // ============================================
    // Messenger Bot (Tenant)
    // ============================================
    async getPortalMessengerBotSummary() {
        return this.request('/api/portal/messenger-bot/summary');
    },

    async getPortalMessengerBotProducts(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/portal/messenger-bot/products${query ? '?' + query : ''}`);
    },

    async createPortalMessengerBotProduct(data) {
        return this.request('/api/portal/messenger-bot/products', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async updatePortalMessengerBotProduct(productId, data) {
        return this.request(`/api/portal/messenger-bot/products/${productId}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    },

    async deletePortalMessengerBotProduct(productId) {
        return this.request(`/api/portal/messenger-bot/products/${productId}`, {
            method: 'DELETE',
        });
    },

    async importPortalMessengerBotProducts(file) {
        const formData = new FormData();
        formData.append('file', file);
        const response = await fetch(`${this.baseUrl}/api/portal/messenger-bot/products/import`, {
            method: 'POST',
            credentials: 'include',
            body: formData,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Import failed');
        return data;
    },

    async uploadPortalMessengerBotAsset(file) {
        const formData = new FormData();
        formData.append('file', file);
        const response = await fetch(`${this.baseUrl}/api/portal/messenger-bot/assets/upload`, {
            method: 'POST',
            credentials: 'include',
            body: formData,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Upload failed');
        return data;
    },

    async getPortalMessengerBotFlows() {
        return this.request('/api/portal/messenger-bot/flows');
    },

    async createPortalMessengerBotFlow(data) {
        return this.request('/api/portal/messenger-bot/flows', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async updatePortalMessengerBotFlow(flowId, data) {
        return this.request(`/api/portal/messenger-bot/flows/${flowId}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    },

    async togglePortalMessengerBotFlow(flowId) {
        return this.request(`/api/portal/messenger-bot/flows/${flowId}/toggle`, {
            method: 'PATCH',
        });
    },

    async deletePortalMessengerBotFlow(flowId) {
        return this.request(`/api/portal/messenger-bot/flows/${flowId}`, {
            method: 'DELETE',
        });
    },

    async testPortalMessengerBotFlow(flowId) {
        return this.request(`/api/portal/messenger-bot/flows/${flowId}/test`, {
            method: 'POST',
        });
    },

    async getPortalMessengerBotFlowEvents(flowId, limit = 50) {
        return this.request(`/api/portal/messenger-bot/flows/${flowId}/events?limit=${limit}`);
    },

    async getPortalMessengerBotSessions(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/portal/messenger-bot/sessions${query ? '?' + query : ''}`);
    },

    async updatePortalMessengerBotSession(sessionId, status) {
        return this.request(`/api/portal/messenger-bot/sessions/${sessionId}`, {
            method: 'PATCH',
            body: JSON.stringify({ status }),
        });
    },

};
