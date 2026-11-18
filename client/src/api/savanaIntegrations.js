export const savanaIntegrationMethods = {
    async getPortalGuidedWhatsAppSetup() {
        return this.request('/api/portal/whatsapp/setup');
    },
    async startPortalGuidedWhatsAppSetup() {
        return this.request('/api/portal/whatsapp/setup/start', { method: 'POST',
            headers: { 'X-Savana-Owner-Intent': 'guided-whatsapp-setup-v1' }, body: '{}' });
    },
    async completePortalGuidedWhatsAppSetup(code, state) {
        return this.request('/api/portal/whatsapp/setup/complete', { method: 'POST',
            headers: { 'X-Savana-Owner-Intent': 'guided-whatsapp-setup-v1' }, body: JSON.stringify({ code, state }) });
    },
    async choosePortalGuidedWhatsAppSetup(choice) {
        return this.request('/api/portal/whatsapp/setup/choose', { method: 'POST',
            headers: { 'X-Savana-Owner-Intent': 'guided-whatsapp-setup-v1' }, body: JSON.stringify({ choice }) });
    },
    async connectPortalGuidedWhatsAppSetup(choice, setDefault = false) {
        return this.request('/api/portal/whatsapp/setup/connect', { method: 'POST',
            headers: { 'X-Savana-Owner-Intent': 'guided-whatsapp-setup-v1' }, body: JSON.stringify({ choice, setDefault }) });
    },
    async cancelPortalGuidedWhatsAppSetup() {
        return this.request('/api/portal/whatsapp/setup/cancel', { method: 'POST',
            headers: { 'X-Savana-Owner-Intent': 'guided-whatsapp-setup-v1' }, body: '{}' });
    },
    async getPortalPlatformBinding() {
        return this.request('/api/portal/integrations/binding');
    },

    async redeemPortalPlatformBinding(invitationCode) {
        return this.request('/api/portal/integrations/binding/redeem', {
            method: 'POST',
            body: JSON.stringify({ invitation_code: invitationCode }),
        });
    },

    async authorizePortalPlatformBinding(redirectUri, state) {
        return this.request('/api/portal/integrations/binding/authorize', {
            method: 'POST',
            body: JSON.stringify({ redirect_uri: redirectUri, state }),
        });
    },

    async getPortalIncomingConnections() {
        return this.request('/api/portal/integrations/incoming-connections');
    },

    async decidePortalIncomingConnection(connectionId, decision) {
        return this.request(
            `/api/portal/integrations/incoming-connections/${connectionId}/${decision}`,
            { method: 'POST' },
        );
    },
    async checkoutPortalCentralSubscription(data) {
        return this.request('/api/portal/integrations/subscription/checkout', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async quotePortalCentralSubscription(data) {
        return this.request('/api/portal/integrations/subscription/checkout-quote', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async createPortalCentralPaymentIntent(data) {
        return this.request('/api/portal/integrations/subscription/payment-intents', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async getPortalPlatformIntegrations() {
        return this.request('/api/portal/integrations/platforms');
    },

    async getPortalConnectionsWorkspace({ activity, purpose, provider, action } = {}) {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries({ activity, purpose, provider, action })) if (value) params.set(key, value);
        return this.request(`/api/portal/integrations/workspace${params.size ? `?${params}` : ''}`);
    },

    async selectPortalWorkspaceActivity(activity) {
        return this.request('/api/portal/integrations/workspace/selection', {
            method: 'POST', headers: { 'X-Savana-Owner-Intent': 'connections-data-v1' },
            body: JSON.stringify({ activity }),
        });
    },

    async reviewPortalWorkspaceSelection(activity) {
        return this.request('/api/portal/integrations/workspace/selection/review', {
            method: 'POST', headers: { 'X-Savana-Owner-Intent': 'connections-data-v1' },
            body: JSON.stringify({ activity }),
        });
    },

    async getPortalWorkspaceGrantOptions({ activity, grant, person } = {}) {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries({ activity, grant, person })) if (value) params.set(key, value);
        return this.request(`/api/portal/integrations/workspace/grant-options?${params}`);
    },

    async reviewPortalWorkspaceGrant({ activity, grant, person, actions, fields, resources, resourcePolicy, expiresAt, assignSourceAuthority }) {
        return this.request('/api/portal/integrations/workspace/grants/review', { method: 'POST',
            headers: { 'X-Savana-Owner-Intent': 'connections-data-v1' },
            body: JSON.stringify({ activity, grant, person, actions, fields, resources, resourcePolicy, expiresAt, assignSourceAuthority }) });
    },

    async reviewPortalWorkspaceActivity(name) {
        return this.request('/api/portal/integrations/workspace/activity/review', {
            method: 'POST', headers: { 'X-Savana-Owner-Intent': 'connections-data-v1' },
            body: JSON.stringify({ name }),
        });
    },

    async reviewPortalWorkspaceBinding() {
        return this.request('/api/portal/integrations/workspace/binding/review', {
            method: 'POST', headers: { 'X-Savana-Owner-Intent': 'connections-data-v1' },
            body: JSON.stringify({}),
        });
    },

    async reviewPortalWorkspaceProvider(provider) {
        return this.request('/api/portal/integrations/workspace/provider/review', {
            method: 'POST', headers: { 'X-Savana-Owner-Intent': 'connections-data-v1' },
            body: JSON.stringify({ provider }),
        });
    },

    async reviewPortalWorkspaceProviderRefresh(provider) {
        return this.request('/api/portal/integrations/workspace/provider/refresh/review', {
            method: 'POST', headers: { 'X-Savana-Owner-Intent': 'connections-data-v1' }, body: JSON.stringify({ provider }) });
    },

    async reviewPortalWorkspaceConnection({ activity, purpose, provider, fields, people }) {
        return this.request('/api/portal/integrations/workspace/connection/review', {
            method: 'POST', headers: { 'X-Savana-Owner-Intent': 'connections-data-v1' },
            body: JSON.stringify({ activity, purpose, provider, fields, people }),
        });
    },

    async reviewPortalWorkspaceProduct({ activity, provider, record, fields, clearFields }) {
        return this.request('/api/portal/integrations/workspace/products/review', {
            method: 'POST', headers: { 'X-Savana-Owner-Intent': 'connections-data-v1' },
            body: JSON.stringify({ activity, provider, ...(record ? { record } : {}), fields,
                ...(clearFields ? { clearFields } : {}) }),
        });
    },

    async reviewPortalWorkspaceNativeAction({ activity, provider, capability, action, parameters }) {
        return this.request('/api/portal/integrations/workspace/actions/review', {
            method: 'POST', headers: { 'X-Savana-Owner-Intent': 'connections-data-v1' },
            body: JSON.stringify({ activity, provider, capability, action, parameters }),
        });
    },

    async getPortalCollaborativeOptions({ activity_ref, capability, channel, account_ref, recipient_q, recipient_cursor } = {}) {
        const params = new URLSearchParams({ activity_ref });
        for (const [key, value] of Object.entries({ capability, channel, account_ref, recipient_q, recipient_cursor })) if (value) params.set(key, value);
        return this.request(`/api/portal/integrations/collaborative/options?${params}`);
    },

    async previewPortalCollaborativeAction({ activity_ref, capability, action, parameters }) {
        return this.request('/api/portal/integrations/collaborative/preview', {
            method: 'POST', headers: { 'X-Savana-Owner-Intent': 'connections-data-v1' },
            body: JSON.stringify({ activity_ref, capability, action, parameters }),
        });
    },

    async getPortalCollaborativeBusinessOptions({ activity_ref, capability, contact_q, contact_cursor, operation_cursor } = {}) {
        const params = new URLSearchParams({ activity_ref, capability });
        for (const [key, value] of Object.entries({ contact_q, contact_cursor, operation_cursor })) if (value) params.set(key, value);
        return this.request(`/api/portal/integrations/collaborative/business/options?${params}`);
    },

    async getPortalCollaborativeMediaOptions({ activity_ref, account_ref } = {}) {
        const params = new URLSearchParams({ activity_ref });
        if (account_ref) params.set('account_ref', account_ref);
        return this.request(`/api/portal/integrations/collaborative/media/options?${params}`);
    },

    async stagePortalCollaborativeMedia(file, { activity_ref, channel, account_ref, purpose, evidence_reference, rights_note, rights_recorded_at, rights_valid_until, idempotency_key }) {
        const body = new FormData();
        for (const [key, value] of Object.entries({ activity_ref, channel, account_ref, purpose, evidence_reference, rights_note, rights_recorded_at, rights_valid_until, idempotency_key })) body.append(key, value);
        body.append('file', file);
        return this.request('/api/portal/integrations/collaborative/media/assets', { method: 'POST',
            headers: { 'X-Savana-Owner-Intent': 'connections-data-v1' }, body });
    },

    async lookupPortalCollaborativeMediaStage(activity_ref, idempotency_key) {
        return this.request(`/api/portal/integrations/collaborative/media/assets/lookup?${new URLSearchParams({ activity_ref, idempotency_key })}`);
    },

    async previewPortalCollaborativeMedia({ activity_ref, capability, action, parameters }) {
        return this.request('/api/portal/integrations/collaborative/media/preview', { method: 'POST',
            headers: { 'X-Savana-Owner-Intent': 'connections-data-v1' }, body: JSON.stringify({ activity_ref, capability, action, parameters }) });
    },

    async previewPortalCollaborativeBusinessAction({ activity_ref, capability, action, parameters }) {
        return this.request('/api/portal/integrations/collaborative/business/preview', {
            method: 'POST', headers: { 'X-Savana-Owner-Intent': 'connections-data-v1' },
            body: JSON.stringify({ activity_ref, capability, action, parameters }),
        });
    },

    async getPortalCollaborativeConsents({ activity_ref, channel, account_ref, recipient_ref } = {}) {
        const params = new URLSearchParams({ activity_ref });
        for (const [key, value] of Object.entries({ channel, account_ref, recipient_ref })) if (value) params.set(key, value);
        return this.request(`/api/portal/integrations/collaborative/consents?${params}`);
    },

    async submitPortalWorkspaceReview(review) {
        return this.request('/api/portal/integrations/workspace/submit', {
            method: 'POST', headers: { 'X-Savana-Owner-Intent': 'connections-data-v1' },
            body: JSON.stringify({ review }),
        });
    },

    async getPortalWorkspaceRecords({ activity, q = '', cursor } = {}) {
        const params = new URLSearchParams({ activity, q });
        if (cursor) params.set('cursor', cursor);
        return this.request(`/api/portal/integrations/workspace/records?${params}`);
    },

    async getPortalWorkspaceRecord(record, activity) {
        return this.request(`/api/portal/integrations/workspace/records/${encodeURIComponent(record)}?${new URLSearchParams({ activity })}`);
    },

    async getPortalWorkspaceCommands(activity) {
        return this.request(`/api/portal/integrations/workspace/commands?${new URLSearchParams({ activity })}`);
    },

    async getPortalWorkspaceRequests(activity) {
        return this.request(`/api/portal/integrations/workspace/requests?${new URLSearchParams({ activity })}`);
    },

    async getPortalWorkspaceRequest(request) {
        return this.request(`/api/portal/integrations/workspace/requests/${encodeURIComponent(request)}`);
    },

    async approvePortalWorkspaceRequest(request, intent) {
        if (typeof intent !== 'string' || !intent || intent.length > 180_000) throw new TypeError('A current server approval reference is required');
        return this.request(`/api/portal/integrations/workspace/requests/${encodeURIComponent(request)}/approve`, {
            method: 'POST', headers: { 'X-Savana-Owner-Intent': 'connections-data-v1' },
            body: JSON.stringify({ intent }),
        });
    },

    async reviewPortalWorkspaceRequestEdit(request, { activity, purpose, provider, fields, people }) {
        return this.request(`/api/portal/integrations/workspace/requests/${encodeURIComponent(request)}/edit/review`, {
            method: 'POST', headers: { 'X-Savana-Owner-Intent': 'connections-data-v1' },
            body: JSON.stringify({ activity, purpose, provider, fields, people }),
        });
    },

    async reviewPortalWorkspaceRequestRejection(request, reason) {
        return this.request(`/api/portal/integrations/workspace/requests/${encodeURIComponent(request)}/reject/review`, {
            method: 'POST', headers: { 'X-Savana-Owner-Intent': 'connections-data-v1' }, body: JSON.stringify({ reason }),
        });
    },

    async reviewPortalWorkspaceReadGrantRevocation(grant, reason) {
        return this.request(`/api/portal/integrations/workspace/read-grants/${encodeURIComponent(grant)}/revoke/review`, {
            method: 'POST', headers: { 'X-Savana-Owner-Intent': 'connections-data-v1' }, body: JSON.stringify({ reason }),
        });
    },

    async getPortalWorkspaceCommand(command) {
        return this.request(`/api/portal/integrations/workspace/commands/${encodeURIComponent(command)}`);
    },

    async reviewPortalWorkspaceCommandEdit(command, { fields, clearFields }) {
        return this.request(`/api/portal/integrations/workspace/commands/${encodeURIComponent(command)}/edit/review`, {
            method: 'POST', headers: { 'X-Savana-Owner-Intent': 'connections-data-v1' },
            body: JSON.stringify({ fields, ...(clearFields ? { clearFields } : {}) }),
        });
    },

    async reviewPortalWorkspaceCommandRejection(command, reason) {
        return this.request(`/api/portal/integrations/workspace/commands/${encodeURIComponent(command)}/reject/review`, {
            method: 'POST', headers: { 'X-Savana-Owner-Intent': 'connections-data-v1' }, body: JSON.stringify({ reason }),
        });
    },

    async reviewPortalWorkspaceCommandDispatch(command) {
        return this.request(`/api/portal/integrations/workspace/commands/${encodeURIComponent(command)}/dispatch/review`, {
            method: 'POST', headers: { 'X-Savana-Owner-Intent': 'connections-data-v1' }, body: JSON.stringify({}),
        });
    },

    async reviewPortalWorkspaceCommandCancellation(command, reason) {
        return this.request(`/api/portal/integrations/workspace/commands/${encodeURIComponent(command)}/cancel/review`, {
            method: 'POST', headers: { 'X-Savana-Owner-Intent': 'connections-data-v1' }, body: JSON.stringify({ reason }),
        });
    },

    async approvePortalWorkspaceCommand(command, intent) {
        if (typeof intent !== 'string' || !intent || intent.length > 180_000) throw new TypeError('A current server approval reference is required');
        return this.request(`/api/portal/integrations/workspace/commands/${encodeURIComponent(command)}/approve`, {
            method: 'POST', headers: { 'X-Savana-Owner-Intent': 'connections-data-v1' },
            body: JSON.stringify({ intent }),
        });
    },

    async reconcilePortalWorkspaceCommand(command) {
        return this.request(`/api/portal/integrations/workspace/commands/${encodeURIComponent(command)}/reconcile`, {
            method: 'POST', headers: { 'X-Savana-Owner-Intent': 'connections-data-v1' },
        });
    },

    async getPortalWorkspaceIntent(intent) {
        return this.request(`/api/portal/integrations/workspace/intents/${encodeURIComponent(intent)}`);
    },

    async reconcilePortalWorkspaceIntent(intent) {
        return this.request(`/api/portal/integrations/workspace/intents/${encodeURIComponent(intent)}/reconcile`, {
            method: 'POST', headers: { 'X-Savana-Owner-Intent': 'connections-data-v1' },
        });
    },

    async connectPortalPlatform(platformCode, data) {
        return this.request(`/api/portal/integrations/platforms/${platformCode}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    },

    async getPortalPlatformCandidates(platformCode) {
        return this.request(`/api/portal/integrations/platforms/${platformCode}/candidates`);
    },

    async actionPortalPlatform(platformCode, action, data = undefined) {
        return this.request(`/api/portal/integrations/platforms/${platformCode}/${action}`, {
            method: 'POST',
            ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        });
    },

    async getPortalPlatformDiagnostics(platformCode) {
        return this.request(`/api/portal/integrations/platforms/${platformCode}/diagnostics`);
    },

    async getPortalPlatformServiceRequests(platformCode, limit = 20) {
        return this.request(
            `/api/portal/integrations/platforms/${platformCode}/service-requests?limit=${limit}`
        );
    },

    async dismissPortalPlatformServiceRequest(platformCode, requestId) {
        return this.request(
            `/api/portal/integrations/platforms/${platformCode}/service-requests/${requestId}/dismiss`,
            { method: 'POST' },
        );
    },

    async getPortalMessageRequests(limit = 20) {
        return this.request(`/api/portal/integrations/message-requests?limit=${limit}`);
    },

    async getPortalIntegrationProducts(limit = 100) {
        return this.request(`/api/portal/integrations/products?limit=${limit}`);
    },

    async getPortalSharedProducts({ q = '', limit = 25, cursor = null } = {}) {
        const params = new URLSearchParams({ q, limit: String(limit) });
        if (cursor !== null) params.set('cursor', cursor);
        return this.request(`/api/portal/integrations/shared-products?${params}`);
    },

    async getPortalSharedReadSetup() {
        return this.request('/api/portal/integrations/shared-read-setup');
    },

    async authorizePortalSharedRead() {
        // Starts identity connection only; owner operations remain in ControlCenter.
        return this.request('/api/portal/integrations/shared-read-setup/authorization', {
            method: 'POST',
            headers: { 'X-Savana-Owner-Intent': 'shared-read-setup-v1' },
        });
    },

    async disconnectPortalSharedRead() {
        return this.request('/api/portal/integrations/shared-read-setup/disconnect', {
            method: 'POST',
            headers: { 'X-Savana-Owner-Intent': 'shared-read-setup-v1' },
        });
    },

    async enrollPortalSharedReadConsumer() {
        return this.request('/api/portal/integrations/shared-read-setup/enrollment', {
            method: 'POST',
            headers: { 'X-Savana-Owner-Intent': 'shared-read-setup-v1' },
        });
    },

    async getPortalSharedReadOwnerStatus() {
        return this.request('/api/portal/integrations/shared-read-setup/owner');
    },

    async loginPortalSharedReadOwner({ username, password, mfa_code } = {}) {
        return this.request('/api/portal/integrations/shared-read-setup/owner/login', {
            method: 'POST',
            headers: { 'X-Savana-Owner-Intent': 'shared-read-setup-v1' },
            body: JSON.stringify({ username, password, ...(mfa_code ? { mfa_code } : {}) }),
        });
    },

    async disconnectPortalSharedReadOwner() {
        return this.request('/api/portal/integrations/shared-read-setup/owner/disconnect', {
            method: 'POST',
            headers: { 'X-Savana-Owner-Intent': 'shared-read-setup-v1' },
            body: JSON.stringify({}),
        });
    },

    async getPortalSharedReadOwnerOverview() {
        return this.request('/api/portal/integrations/shared-read-setup/owner/overview');
    },

    async getPortalSharedReadOwnerIntent(intentId) {
        return this.request(`/api/portal/integrations/shared-read-setup/owner/intents/${encodeURIComponent(intentId)}`);
    },

    async getPortalSharedReadOwnerIntentByKey(key) {
        return this.request(`/api/portal/integrations/shared-read-setup/owner/intents/by-key/${encodeURIComponent(key)}`);
    },

    async submitPortalSharedReadOwnerOperation({ operation, idempotencyKey, body, requestId, targetAccountId }) {
        return this.request('/api/portal/integrations/shared-read-setup/owner/operations', {
            method: 'POST', headers: { 'X-Savana-Owner-Intent': 'shared-read-setup-v1' },
            body: JSON.stringify({ operation, idempotencyKey, body, ...(requestId ? { requestId } : {}), ...(targetAccountId ? { targetAccountId } : {}) }),
        });
    },

    async bindPortalSharedReadConsumer({ consumer_installation_id, activity_id, branch_id = null, warehouse_id = null }) {
        return this.request('/api/portal/integrations/shared-read-setup/reader', {
            method: 'POST', headers: { 'X-Savana-Owner-Intent': 'shared-read-setup-v1' },
            body: JSON.stringify({ consumer_installation_id, activity_id, branch_id, warehouse_id }),
        });
    },

    async getPortalSharedProductChanges(after = 0, limit = 25) {
        const params = new URLSearchParams({ after: String(after), limit: String(limit) });
        return this.request(`/api/portal/integrations/shared-product-changes?${params}`);
    },

    async acceptPortalMessageRequest(requestId) {
        return this.request(`/api/portal/integrations/message-requests/${requestId}/accept`, {
            method: 'POST',
            headers: { 'X-Savana-Review-Mode': 'review-only-v1' },
        });
    },

    async completePortalMessageRequest(requestId, channelMessageId = null) {
        return this.request(`/api/portal/integrations/message-requests/${requestId}/complete`, {
            method: 'POST',
            body: JSON.stringify({ channel_message_id: channelMessageId }),
        });
    },

    async dismissPortalMessageRequest(requestId) {
        return this.request(`/api/portal/integrations/message-requests/${requestId}/dismiss`, {
            method: 'POST',
        });
    },

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
