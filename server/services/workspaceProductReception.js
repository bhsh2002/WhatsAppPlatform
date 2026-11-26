import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { SharedProductReadError } from './centralProductRead.js';
import { canonicalWorkspaceJson } from './workspaceIntents.js';
import { decodeWorkspaceProviderPrepare } from './workspaceCoreResponses.js';
import { validateWorkspaceCoreModel } from './workspaceCoreModels.js';

const PRODUCT = 'savana.products.sync', COLLABORATION = 'savana.collaboration.v1';
const fail = (code = 'workspace_product_reception_changed', status = 409) => { throw new SharedProductReadError(code, status); };
const hash = value => crypto.createHash('sha256').update(canonicalWorkspaceJson(value)).digest('hex');
const sameScope = (a, b) => ['organization_id', 'activity_id', 'branch_id', 'warehouse_id'].every(key => (a?.[key] ?? null) === (b?.[key] ?? null));
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key));
const identityStamp = identity => hash([identity.actorId, identity.organizationId, identity.nativeAccountId,
    identity.coreAccountId ?? null, identity.generation, identity.expiresAt]);

// The explicit product-reception action uses the published prepare/confirmation
// protocol unchanged. Intent pins are durable; the signed native projection is
// transient and never changes protected enrollment create or local read state.
export class WorkspaceProductReception {
    constructor({ gateway }) { this.g = gateway; }
    requireOwner(context, provider) {
        const activity = context.raw.activities.find(row => row.activity_id === provider?.activity_id);
        if (context.raw.can_create_activity !== true || activity?.can_manage_people !== true
            || provider?.platform !== 'wa_savana' || provider.provider_ref !== context.identity.coreAccountId
            || provider.external_tenant_id !== context.identity.nativeAccountId) fail('workspace_product_reception_owner_required', 403);
        return activity;
    }
    fence(principal, identity) {
        const localStamp = hash(principal), expected = identityStamp(identity);
        return () => {
            const owner = this.g.setup.store.ownerSession(principal);
            if (principal.role !== 'tenant' || hash(principal) !== localStamp || this.g.verify(principal) !== true || !owner
                || !this.g.setup.store.ownerCurrent(principal, owner)
                || owner.actorId !== identity.actorId || owner.organizationId !== identity.organizationId
                || owner.generation !== identity.generation || owner.expiresAt !== identity.expiresAt
                || identityStamp(identity) !== expected || Date.parse(identity.expiresAt) <= this.g.now()) fail('workspace_context_changed', 403);
            return true;
        };
    }
    async retained(principal, context, provider) {
        const activity = this.requireOwner(context, provider), identity = context.identity;
        if (typeof this.g.nativeEnrollment?.read !== 'function') fail('workspace_native_enrollment_unavailable', 503);
        const assertCurrent = this.fence(principal, identity);
        assertCurrent();
        const result = await this.g.nativeEnrollment.read({ actor_id: identity.actorId, ...activity.scope, external_tenant_id: identity.nativeAccountId });
        assertCurrent();
        const rows = result.enrollments.filter(row => row.organization_id === identity.organizationId && row.external_tenant_id === identity.nativeAccountId
            && row.platform === 'wa_savana');
        if (rows.length !== 1 || !rows[0].enrollment_id || !Number.isSafeInteger(rows[0].enrollment_version)
            || rows[0].enrollment_version < 1 || !Array.isArray(rows[0].accepted_scopes)) fail('workspace_product_reception_registration_required');
        const registration = rows[0];
        const fingerprint = crypto.createHash('sha256').update(registration.public_key_pem || '').digest('hex');
        return { registration, expected: { enrollment_id: registration.enrollment_id,
            enrollment_version: registration.enrollment_version, public_key_fingerprint: fingerprint }, activity, assertCurrent };
    }
    async action(principal, context, providerChoice, held) {
        const action = { key: 'provider.products.prepare', label: 'تهيئة استقبال المنتجات', effect: 'read',
            provider: this.g.issue(principal, context, 'providers', providerChoice), enabled: false,
            reason: 'يلزم تسجيل الخدمة والتحقق من مالك الحساب قبل تهيئة استقبال المنتجات.' };
        try {
            const { registration, expected } = await this.retained(principal, context, providerChoice.data);
            if (providerChoice.data.enrollment_id !== expected.enrollment_id || providerChoice.data.enrollment_version !== expected.enrollment_version) {
                return { ...action, reason: 'تغيّر تسجيل الخدمة؛ افحص نتيجة المحاولة السابقة وحدّث الحالة قبل تهيئة استقبال المنتجات.' };
            }
            if (registration.accepted_scopes.includes(PRODUCT)) return { ...action, label: 'استقبال المنتجات مهيأ',
                reason: 'لا يمنح هذا الإعداد قراءة المنتجات. اطلب مشاركة القراءة بصورة مستقلة.' };
            if (registration.accepted_scopes.length !== 1 || registration.accepted_scopes[0] !== COLLABORATION) return action;
            return { ...action, enabled: !held, reason: held ? 'افحص نتيجة المحاولة السابقة قبل طلب تهيئة جديدة.'
                : 'إضافة استقبال المنتجات إلى تسجيل الخدمة الحالي؛ لا ينشئ منحة قراءة أو مشاركة بيانات.' };
        } catch { return action; }
    }
    async review(principal, input) {
        if (!exact(input, ['provider'])) fail('workspace_request_invalid', 422);
        const { option, context } = await this.g.choices.resolve(principal, input.provider, 'providers');
        this.requireOwner(context, option.data);
        await this.g.proofs.capture(principal);
        const { registration, expected, activity, assertCurrent } = await this.retained(principal, context, option.data);
        assertCurrent();
        if (registration.accepted_scopes.length !== 1 || registration.accepted_scopes[0] !== COLLABORATION
            || option.data.enrollment_id !== expected.enrollment_id || option.data.enrollment_version !== expected.enrollment_version) fail();
        const summary = [
            { label: 'النشاط', value: activity.label },
            { label: 'الخدمة', value: option.label }, { label: 'الإجراء', value: 'تهيئة استقبال المنتجات مع الاحتفاظ بتسجيل الخدمة ومفتاحها الحاليين' },
            { label: 'الأذونات', value: 'لا يمنح هذا الإعداد قراءة المنتجات. اطلب مشاركة القراءة بصورة مستقلة.' },
        ];
        if (context.raw.service_registrations.some(row => row.provider_ref === option.data.provider_ref
            && row.organization_id === context.identity.organizationId && row.platform === 'wa_savana'
            && row.enrollment_id === expected.enrollment_id && row.enrollment_version === expected.enrollment_version
            && row.state === 'active' && Date.parse(row.expires_at) > this.g.now())) {
            summary.push({ label: 'تسجيل خدمة الرسائل', value: 'يلزم تجديد تسجيل خدمة الرسائل المرتبط بالإصدار السابق بصورة منفصلة.' });
        }
        return this.g.review(principal, context, 'provider_products', { provider_ref: option.data.provider_ref,
            activity_id: option.data.activity_id, ...expected }, summary);
    }
    expected(principal, identity, key) {
        const saved = this.g.receipts.read(principal, identity, 'operation_expected', key);
        if (saved?.operation !== 'provider_products' || saved.payloadHash !== hash(saved.payload) || !saved.provider || !saved.scope) fail();
        const p = saved.payload;
        if (!exact(p, ['provider_ref', 'activity_id', 'enrollment_id', 'enrollment_version', 'public_key_fingerprint'])
            || p.provider_ref !== identity.coreAccountId || saved.provider.platform !== 'wa_savana'
            || saved.provider.external_tenant_id !== identity.nativeAccountId || p.activity_id !== saved.scope.activity_id
            || saved.scope.organization_id !== identity.organizationId || p.enrollment_id !== saved.provider.enrollment_id
            || p.enrollment_version !== saved.provider.enrollment_version || !/^[a-f0-9]{64}$/.test(p.public_key_fingerprint || '')) fail();
        return { saved, pins: { enrollment_id: p.enrollment_id, enrollment_version: p.enrollment_version,
            public_key_fingerprint: p.public_key_fingerprint } };
    }
    decode(principal, identity, key, raw, status) {
        const { saved, pins } = this.expected(principal, identity, key);
        const result = decodeWorkspaceProviderPrepare(raw, identity, { ...this.g.urlPolicy, providerRef: saved.payload.provider_ref,
            activityId: saved.payload.activity_id, scope: saved.scope, platformCode: 'wa_savana', externalTenantId: identity.nativeAccountId,
            enrollmentId: pins.enrollment_id, publicKeyFingerprint: pins.public_key_fingerprint,
            enrollmentVersion: pins.enrollment_version + 1, acceptedScopes: [PRODUCT, COLLABORATION], status });
        return result;
    }
    async project(principal, identity, key, action, { recover = false, expectedRevision = null } = {}) {
        const { saved, pins } = this.expected(principal, identity, key);
        const current = await this.g.loadContext(principal);
        if (identityStamp(current.identity) !== identityStamp(identity)) fail('workspace_context_changed', 403);
        if (expectedRevision !== null && current.revision !== expectedRevision) fail('workspace_context_changed', 403);
        const provider = current.raw.providers.find(row => row.provider_ref === saved.payload.provider_ref && row.activity_id === saved.payload.activity_id);
        const activity = this.requireOwner(current, provider);
        if (!sameScope(activity.scope, saved.scope)) fail();
        if (provider.enrollment_id !== pins.enrollment_id
            || !(provider.enrollment_version === pins.enrollment_version || (recover && provider.enrollment_version === pins.enrollment_version + 1))) fail();
        const assertCurrent = this.fence(principal, identity);
        assertCurrent();
        if (recover) {
            const { registration, expected } = await this.retained(principal, current, provider);
            assertCurrent();
            if (expected.enrollment_id === pins.enrollment_id && expected.enrollment_version === pins.enrollment_version + 1
                && expected.public_key_fingerprint === pins.public_key_fingerprint && registration.accepted_scopes.length === 2
                && registration.accepted_scopes.includes(PRODUCT) && registration.accepted_scopes.includes(COLLABORATION)) {
                // The native ACK may have committed immediately before a crash
                // left the intent unknown. Confirm it without proposing again.
                const result = await action();
                assertCurrent();
                return result;
            }
        }
        const owner = this.g.setup.store.ownerSession(principal);
        // The access token was already RS256 verified by native PKCE setup and
        // fresh userinfo above; its signed session version is never UI input.
        const claims = jwt.decode(owner.accessToken);
        if (claims?.sub !== identity.actorId || claims.organization_id !== identity.organizationId
            || !Number.isSafeInteger(claims.session_version) || claims.session_version < 1) fail('workspace_product_reception_session_required', 403);
        const context = { actor_id: identity.actorId, ...saved.scope, external_tenant_id: identity.nativeAccountId,
            session_version: claims.session_version };
        if (typeof this.g.nativeEnrollment?.withProductScopeProjection !== 'function') fail('workspace_native_enrollment_unavailable', 503);
        return this.g.nativeEnrollment.withProductScopeProjection(context, pins, async () => {
            assertCurrent();
            const result = await action();
            assertCurrent();
            return result;
        }, { assertCurrent });
    }
    async accept(principal, identity, key, result) {
        const { saved, pins } = this.expected(principal, identity, key), assertCurrent = this.fence(principal, identity);
        assertCurrent();
        await this.g.nativeEnrollment.acceptVerifiedRegistration({ actor_id: identity.actorId, ...saved.scope, external_tenant_id: identity.nativeAccountId },
            { registration: result.enrollment, expectedEnrollmentVersion: pins.enrollment_version }, { assertCurrent, productScopeExpected: pins });
        assertCurrent();
    }
    planner() {
        return { includeConsumer: false,
            request: async reviewed => {
                this.expected(reviewed.principal, reviewed.context.identity, reviewed.idempotencyKey);
                const body = { activity_id: reviewed.payload.activity_id };
                validateWorkspaceCoreModel('WorkspaceProviderPrepare', body);
                return { method: 'POST', path: `/v1/integration/workspace/providers/${encodeURIComponent(reviewed.payload.provider_ref)}/prepare`, body };
            },
            dispatch: ({ principal, reviewed, send }) => this.project(principal, reviewed.context.identity, reviewed.idempotencyKey, send,
                { expectedRevision: reviewed.context.revision }),
            result: async ({ principal, reviewed, response }) => {
                const identity = reviewed.context.identity;
                const result = this.decode(principal, identity, reviewed.idempotencyKey, response, 'prepared');
                await this.accept(principal, identity, reviewed.idempotencyKey, result);
                return result;
            },
        };
    }
}
