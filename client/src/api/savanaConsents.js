const intentHeaders = { 'X-Savana-Owner-Intent': 'connections-data-v1' };
const string = value => typeof value === 'string' && value.length > 0 && value.length <= 16_384;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
const invalid = () => { throw new Error('Current consent selection is required'); };

// Native-owned consent evidence is a separately reviewed business record. The
// browser supplies no actor, organization, scope or capability permission.
export const savanaConsentMethods = {
    async createPortalConsentRecord(input) {
        if (!exact(input, ['activity_ref', 'channel', 'account_ref', 'recipient_ref', 'purpose', 'evidence', 'valid_until', 'idempotency_key'])
            || !['activity_ref', 'channel', 'account_ref', 'recipient_ref', 'purpose', 'valid_until', 'idempotency_key'].every(key => string(input[key]))
            || !exact(input.evidence, ['kind', 'reference', 'note', 'recorded_at'])) invalid();
        return this.request('/api/portal/integrations/collaborative/consents', {
            method: 'POST', headers: intentHeaders, body: JSON.stringify(input),
        });
    },
    async lookupPortalConsentRecord({ activity_ref, idempotency_key } = {}) {
        if (!string(activity_ref) || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotency_key || '')) invalid();
        const query = new URLSearchParams({ activity_ref, idempotency_key });
        return this.request(`/api/portal/integrations/collaborative/consents/lookup?${query}`);
    },
    async listPortalConsentRecords({ activity_ref, channel, account_ref, recipient_ref, purpose } = {}) {
        if (![activity_ref, channel, account_ref, recipient_ref, purpose].every(string)) invalid();
        const query = new URLSearchParams({ activity_ref, channel, account_ref, recipient_ref, purpose });
        return this.request(`/api/portal/integrations/collaborative/consents?${query}`);
    },
    async revokePortalConsentRecord(reference, { activity_ref, expected_version } = {}) {
        if (!/^consent:[a-f0-9-]{36}$/.test(reference || '') || !string(activity_ref)
            || !Number.isSafeInteger(expected_version) || expected_version < 1) invalid();
        return this.request(`/api/portal/integrations/collaborative/consents/${encodeURIComponent(reference)}/revoke`, {
            method: 'POST', headers: intentHeaders, body: JSON.stringify({ activity_ref, expected_version }),
        });
    },
};
