import crypto from 'node:crypto';
import { SharedProductReadError, createSqliteReadPrincipalVerifier } from './centralProductRead.js';
import { WorkspaceCoreTransport } from './workspaceCoreTransport.js';
import { WorkspaceChoices } from './workspaceChoices.js';
import { WorkspaceReferences, workspaceContextReference } from './workspaceReferences.js';
import { WorkspaceIntentStore, canonicalWorkspaceJson } from './workspaceIntents.js';
import { WorkspaceReceipts } from './workspaceReceipts.js';
import { WorkspaceMutations } from './workspaceMutations.js';
import { validateWorkspaceCoreModel } from './workspaceCoreModels.js';
import { validateNativeCommandModel } from './nativeCommandModels.js';
import { validateWorkspaceProductPayload } from './workspaceProductPayload.js';
import { WorkspaceProductReader, workspaceProductOption } from './workspaceProductReader.js';
import { WorkspaceSharedResourceReader } from './workspaceSharedResourceReader.js';
import { WorkspaceSharedResourceViews } from './workspaceSharedResourceViews.js';
import { WorkspaceCapabilityGrants, workspaceGrantChoices } from './workspaceCapabilityGrants.js';
import { workspaceNativeCapabilityCards } from './workspaceNativeCapabilityCards.js';
import { createWorkspaceCommandPresenter } from './workspaceCommandPresentation.js';
import { presentWorkspaceRequest } from './workspaceRequestPresentation.js';
import { decodeWorkspaceContext, decodeWorkspaceSelection, decodeWorkspaceRequest, decodeWorkspaceBinding,
    decodeWorkspaceActivity, decodeWorkspaceProviderPrepare, decodeWorkspaceNamespace } from './workspaceCoreResponses.js';

const BASE = '/v1/integration/workspace';
const fail = (code = 'workspace_choice_changed', status = 409) => { throw new SharedProductReadError(code, status); };
const hash = value => crypto.createHash('sha256').update(canonicalWorkspaceJson(value)).digest('hex');
const text = (value, max = 255) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const exact = (value, keys) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) fail('workspace_request_invalid', 422);
};
const pathId = value => { if (!text(value) || !/^[A-Za-z0-9_:.-]+$/.test(value) || value === '.' || value === '..') fail(); return encodeURIComponent(value); };
const scopeEqual = (a, b) => ['organization_id', 'activity_id', 'branch_id', 'warehouse_id'].every(key => (a?.[key] ?? null) === (b?.[key] ?? null));
const sameInstant = (a, b) => typeof a === 'string' && typeof b === 'string' && Number.isFinite(Date.parse(a)) && Date.parse(a) === Date.parse(b);
const fieldNames = ['name', 'description', 'sku', 'barcodes', 'base_unit', 'price', 'media'];
const fieldLabels = { name: 'اسم المنتج', description: 'الوصف', sku: 'رمز المنتج', barcodes: 'الباركود', base_unit: 'وحدة المنتج', price: 'السعر', media: 'صور المنتج', is_visible: 'إتاحة المنتج' };
const purposeLabels = { read_sharing: 'قراءة المنتجات المشتركة', consumer_registration: 'تجهيز حساب قراءة المنتجات', native_namespace: 'تسجيل خدمة الرسائل لهذا النشاط' };
const actionLabels = { 'product.create': 'إضافة منتج إلى المصدر', 'product.change': 'تغيير المنتج في المصدر', 'messaging.send': 'إرسال رسالة', 'campaigns.execute': 'تنفيذ حملة', 'content.publish': 'نشر محتوى',
    'messaging.review': 'حفظ طلب مراجعة رسالة', 'campaigns.review': 'حفظ طلب مراجعة حملة', 'content.review': 'حفظ طلب مراجعة محتوى',
    'contacts.create': 'إضافة جهة اتصال', 'contacts.change': 'تعديل جهة اتصال', 'contacts.remove': 'حذف جهة اتصال', 'contacts.read': 'عرض بيانات جهة اتصال',
    'measurement.summary': 'عرض نشاط رسائل WhatsApp', 'measurement.export': 'تصدير نشاط رسائل WhatsApp', 'owner.operation_status': 'عرض نتيجة عملية أصلية',
    'media.asset.upload': 'رفع ملف إلى مكتبة WhatsApp', 'media.asset.inspect': 'فحص ملف WhatsApp المرفوع' };
const nativeCommunicationCapabilities = ['messaging.send', 'campaigns.execute', 'content.publish', 'messaging.review', 'campaigns.review', 'content.review'];
const nativeBusinessCapabilities = ['customers.manage', 'measurement.read', 'measurement.export', 'owner.operations'];
const nativeMediaActions = ['media.asset.upload', 'media.asset.inspect'];
const emptySelection = () => ({ activity: '', purpose: '', provider: '', fields: [], people: [] });
const emptyEditor = () => ({ fields: [], units: [], priceChoices: [], mediaChoices: [], provider: null, sourceLabel: null, draft: {} });
const availability = (state, reason_code, message, href = '/portal/integrations', code = 'refresh', label = 'تحديث الحالة') =>
    ({ state, reason_code, message, next_action: { code, label, href } });
const requiredActions = { read_sharing: 'read.request', consumer_registration: 'read.request', native_namespace: 'read.request' };
const approvalAction = kind => kind === 'source_registration' ? 'source.approve' : kind === 'native_origin' ? 'origin.approve' : 'read.approve';
const identityProof = identity => hash([identity.actorId, identity.organizationId, identity.nativeAccountId,
    identity.coreAccountId ?? null, identity.generation, identity.expiresAt]);

// Native owner BFF. It translates named, opaque selections into the published
// Core DTOs; all policy decisions remain current Core/source decisions.
export class OperationalWorkspaceService {
    constructor({ database, encryption, setupService, readService, nativeOwnerProofs, nativeOwnerService = null,
        verifyLocalPrincipal = createSqliteReadPrincipalVerifier(database), fetchImpl = globalThis.fetch, now = () => Date.now(),
        sharedResourceReadsEnabled = true }) {
        this.db = database; this.setup = setupService; this.reader = readService; this.proofs = nativeOwnerProofs;
        this.nativeOwner = nativeOwnerService; this.businessOwner = null; this.nativeEnrollment = null; this.verify = verifyLocalPrincipal; this.fetch = fetchImpl; this.now = now;
        this.transport = new WorkspaceCoreTransport({ setupService, fetchImpl, now });
        this.products = new WorkspaceProductReader({ gateway: this });
        this.sharedResourceReader = new WorkspaceSharedResourceReader({ gateway: this });
        this.urlPolicy = { allowLoopback: setupService.config.allowLoopback === true,
            allowedOrigins: [...new Set([setupService.config.centerOrigin, setupService.config.oidcIssuer, setupService.appOrigin].filter(Boolean))] };
        this.receipts = new WorkspaceReceipts({ database, encryption, verifyLocalPrincipal, now });
        this.refs = new WorkspaceReferences({ encryption, verifyLocalPrincipal, currentIdentity: p => this.transport.currentIdentity(p, { allowUnbound: true }), now });
        // The final retained-read contract is public. Core still authorizes
        // every source/consumer/field read; callers can explicitly opt out.
        this.sharedResourceViews = new WorkspaceSharedResourceViews({ gateway: this, enabled: sharedResourceReadsEnabled });
        this.choices = new WorkspaceChoices({ encryption, verifyLocalPrincipal, loadContext: p => this.loadContext(p), now });
        this.intents = new WorkspaceIntentStore({ database, encryption, verifyLocalPrincipal, now,
            loadOutcome: input => this.loadOutcome(input) });
        this.grants = new WorkspaceCapabilityGrants({ gateway: this });
        this.mutations = new WorkspaceMutations({ choices: this.choices, transport: this.transport,
            intents: this.intents, planners: this.planners() });
        this.presentCommand = createWorkspaceCommandPresenter({ refs: this.refs, now,
            verifyCurrent: input => this.verifyCommandRead(input),
            issueIntentRef: input => this.commandApprovalReview(input),
            formatProductField: input => this.formatProductField(input),
            verifySourceReceipt: input => this.verifySourceReceipt(input) });
    }
    setNativeOwnerService(service) { this.nativeOwner = service; }
    setNativeBusinessOwnerService(service) { this.businessOwner = service; }
    setNativeEnrollmentService(service) { this.nativeEnrollment = service; }
    saveSelection(principal, identity, idempotencyKey, receipt) {
        const saved = { idempotency_key: idempotencyKey, receipt };
        this.receipts.save(principal, identity, 'selection', receipt.scope.activity_id, saved);
        this.receipts.save(principal, identity, 'selection', 'current', saved);
    }
    async currentSelection(principal, identity) {
        if (!identity.coreAccountId) return null;
        const saved = this.receipts.read(principal, identity, 'selection', 'current');
        if (!saved) return null;
        if (!text(saved.idempotency_key) || !saved.receipt?.scope) fail('workspace_receipt_unverified', 403);
        try {
            const response = await this.transport.request(principal, { path: `${BASE}/selection/lookup?${new URLSearchParams({ idempotency_key: saved.idempotency_key })}`,
                expectedIdentity: identity });
            const current = decodeWorkspaceSelection(response.payload, identity, { ...this.urlPolicy, scope: saved.receipt.scope });
            if (current.account.provider_ref !== identity.coreAccountId || current.account.platform !== 'wa_savana'
                || current.selection_id !== saved.receipt.selection_id) fail('workspace_context_changed', 403);
            return current;
        } catch (error) {
            // These current Core outcomes withdraw the selector, never prove
            // that an unresolved selection request had no effect.
            if (error instanceof SharedProductReadError && error.code === 'workspace_rejected' && [403, 404, 409].includes(error.status)) return null;
            throw error;
        }
    }
    async loadContext(principal) {
        const currentIdentity = await this.transport.currentIdentity(principal, { allowUnbound: true });
        const selection = await this.currentSelection(principal, currentIdentity);
        const consumerInstallationId = selection?.consumer_installation_id ?? null;
        const { payload, identity } = await this.transport.request(principal, { path: `${BASE}/discovery`, expectedIdentity: currentIdentity,
            consumerInstallation: consumerInstallationId });
        const raw = decodeWorkspaceContext(payload, identity, this.urlPolicy);
        const revision = hash([raw, selection]);
        const window = this.viewWindow(principal, identity, revision);
        const validUntil = new Date(window.expiresAt).toISOString();
        const rows = (items, key, label, data = row => row) => items.map(row => ({ key: key(row), label: label(row), version: revision, selectable: true, data: data(row) }));
        const providers = raw.providers.filter(row => ['catalog', 'wa_savana', 'sawemly'].includes(row.platform));
        const providerRows = providers.flatMap(row => {
            const installations = row.installations.filter(item => item.activity_id === row.activity_id);
            return (installations.length ? installations : [null]).map(installation => ({
                key: JSON.stringify([row.activity_id, row.provider_ref, installation?.installation_id ?? null]),
                label: installation ? `${row.label} — ${installation.label}` : row.label,
                version: revision, selectable: true, data: { ...row, selectedInstallation: installation?.installation_id ?? null } }));
        });
        const choices = {
            activities: rows(raw.activities, row => row.activity_id, row => row.label),
            purposes: Object.entries(purposeLabels).map(([key, label]) => ({ key, label, version: revision, selectable: true })),
            providers: providerRows,
            fields: rows(raw.policies.fields, row => row.value, row => row.label),
            people: rows(raw.people, row => row.person_ref, row => row.display_name),
            units: rows(raw.policies.unit_codes, row => row.value, row => row.label),
            price_choices: [], media_choices: [],
            ...workspaceGrantChoices(raw, revision),
        };
        // A valid price names all four source policies. A global union of
        // unrelated providers' choices cannot authorize a price at a source.
        for (const provider of providers) {
            const policy = provider.policy_choices;
            if (!policy) continue;
            for (const unit of policy.unit_codes || []) for (const currency of policy.currencies || [])
                for (const list of policy.price_lists || []) for (const channel of policy.channels || []) {
                    if (choices.price_choices.length >= 2000) fail('workspace_response_invalid', 502);
                    const data = { unit_code: unit.value, currency: currency.value, price_list_id: list.value, channel: channel.value,
                        provider_ref: provider.provider_ref, activity_id: provider.activity_id };
                    choices.price_choices.push({ key: JSON.stringify(data), label: `${currency.label} / ${unit.label} / ${list.label} / ${channel.label}`,
                        version: revision, selectable: true, data });
                }
        }
        return { actorId: identity.actorId, organizationId: identity.organizationId, nativeAccountId: identity.nativeAccountId, coreAccountId: identity.coreAccountId,
            identityGeneration: identity.generation, revision, validUntil, viewNonce: window.nonce, choices, raw, identity,
            consumerInstallationId, selection };
    }
    viewWindow(principal, identity, revision) {
        const key = hash([principal.tenantId, principal.userId, principal.sessionId, principal.authVersion, principal.role,
            principal.sessionExpiresAt, principal.issuedAt ?? null, identityProof(identity), revision]);
        const limit = Math.min(Date.parse(identity.expiresAt), principal.sessionExpiresAt * 1000);
        if (!Number.isFinite(limit) || limit <= this.now()) fail('workspace_context_changed', 403);
        return this.db.transaction(() => {
            const prior = this.receipts.read(principal, identity, 'view_current', key);
            if (prior && (!/^[a-f0-9]{32}$/.test(prior.nonce || '') || !Number.isSafeInteger(prior.createdAt)
                || !Number.isSafeInteger(prior.expiresAt) || prior.createdAt > this.now() || prior.expiresAt <= prior.createdAt
                || prior.expiresAt > prior.createdAt + 300_000 || prior.expiresAt > limit)) fail('workspace_view_unverified', 503);
            if (prior && prior.expiresAt > this.now()) return prior;
            const window = { nonce: crypto.randomBytes(16).toString('hex'), createdAt: this.now(), expiresAt: Math.min(this.now() + 300_000, limit) };
            this.receipts.save(principal, identity, 'view_window', window.nonce, window);
            this.receipts.save(principal, identity, 'view_current', key, window);
            return window;
        }).immediate();
    }
    metadata(context) { return { viewKey: hash([context.actorId, context.organizationId, context.nativeAccountId,
        context.identity.coreAccountId ?? null, context.identityGeneration, context.revision, context.viewNonce]), valid_until: context.validUntil }; }
    readMetadata(context, result, latest) {
        // Formatting must not outlive the shorter authorization of the actual read.
        const deadlines = [context.validUntil, result.context.valid_until, latest.validUntil].map(value => Date.parse(value));
        const deadline = Math.min(...deadlines);
        if (deadlines.some(value => !Number.isFinite(value)) || deadline <= this.now()) fail('workspace_context_changed', 403);
        return { ...this.metadata(context), valid_until: new Date(deadline).toISOString() };
    }
    issue(principal, context, kind, option) { return this.choices.issue(principal, context, { kind, key: option.key }); }
    choiceRows(principal, context, kind, predicate = () => true) {
        return context.choices[kind].filter(predicate).map(row => ({ value: this.issue(principal, context, kind, row), label: row.label, enabled: row.selectable === true }));
    }
    async selected(principal, input = {}, suppliedContext = null) {
        const context = suppliedContext || await this.loadContext(principal);
        let activity = null; let provider = null; let purpose = null;
        for (const [kind, token, assign] of [
            ['activities', input.activity, value => { activity = value; }],
            ['providers', input.provider, value => { provider = value; }],
            ['purposes', input.purpose, value => { purpose = value; }],
        ]) if (token) {
            const resolved = await this.choices.resolve(principal, token, kind);
            if (resolved.context.revision !== context.revision) fail();
            assign(resolved.option);
        }
        if (!activity && context.selection) activity = context.choices.activities.find(row => row.key === context.selection.scope.activity_id) ?? null;
        if (!activity && context.choices.activities.length === 1) activity = context.choices.activities[0];
        if (provider && provider.data.activity_id !== activity?.key) fail();
        return { context, activity, provider, purpose };
    }
    disconnected(principal) {
        const configured = this.setup.config.enabled === true;
        return { spec_version: '1.0', context: { verified: false, connect: { enabled: configured,
            code: configured ? 'identity_required' : 'identity_configuration_required', label: configured ? 'ربط هويتي بالمؤسسة' : 'إعداد ربط الهوية مطلوب' },
            reason: configured ? 'اربط هويتك لاختيار المؤسسة والنشاط بالأسماء المعتمدة.' : 'يلزم إكمال إعداد ربط الهوية لهذه الخدمة.' },
        connection: { choices: { activities: [], purposes: [], providers: [], fields: [], people: [] }, selection: emptySelection(), held: true, busy: false, requests: [] },
        capabilities: { capabilities: [] }, sharedData: { records: [], browseAction: { key: 'records.browse', label: 'عرض المنتجات المشتركة', enabled: false,
            effect: 'read', reason: 'اربط هويتك وحدّد النشاط وإذن القراءة أولًا.' } }, commands: [], productEditor: emptyEditor(), intents: [], held: true };
    }
    async overview(principal, input = {}) {
        if (this.setup.config.enabled !== true || !this.setup.store.ownerSession(principal)) return this.disconnected(principal);
        const { context, activity, provider, purpose } = await this.selected(principal, input);
        const { raw, identity } = context; const metadata = this.metadata(context);
        const bound = !!identity.coreAccountId;
        const selection = { activity: activity ? this.issue(principal, context, 'activities', activity) : '',
            provider: provider ? this.issue(principal, context, 'providers', provider) : '',
            purpose: purpose ? this.issue(principal, context, 'purposes', purpose) : '', fields: [], people: [] };
        const intents = this.intents.listForOwner(principal, identity).map(row => this.publicIntent(principal, identity, row));
        const held = intents.some(row => !['completed', 'failed'].includes(row.state));
        const capabilities = this.capabilityCards(principal, context, activity);
        const requests = activity ? await this.requestRows(principal, context, activity.data) : [];
        const editor = await this.productEditor(principal, context, activity?.data, provider?.data);
        const native = activity && raw.providers.find(row => row.activity_id === activity.key && row.provider_ref === identity.coreAccountId && row.platform === 'wa_savana');
        const requested = input.action && nativeCommunicationCapabilities.includes(input.action) ? input.action : null;
        const businessRequested = input.action && nativeBusinessCapabilities.includes(input.action) ? input.action : null;
        const mediaRequested = input.action === 'media.manage';
        const nativeChoice = native && context.choices.providers.find(row => row.data.provider_ref === native.provider_ref && row.data.activity_id === activity.key);
        const sharedResources = this.sharedResourceViews.enabled === true && activity
            ? await this.sharedResourceViews.options(principal, context, activity.data) : null;
        return { spec_version: '1.0', context: { verified: true, ...metadata,
            native_reference: workspaceContextReference(principal, identity), organizationLabel: raw.organization.name,
            actorLabel: raw.actor.display_name, activityLabel: activity?.label || null,
            connect: { enabled: !bound && !held, code: bound ? 'connected' : 'native_binding_required', label: bound ? 'الحساب مربوط بالمؤسسة' : 'ربط هذا الحساب بالمؤسسة' } },
        connection: { choices: {
            activities: this.choiceRows(principal, context, 'activities'),
            purposes: this.choiceRows(principal, context, 'purposes', row => !!activity?.data.my_actions.includes(requiredActions[row.key])),
            providers: this.choiceRows(principal, context, 'providers', row => row.data.activity_id === activity?.key),
            fields: purpose && purpose.key !== 'read_sharing' ? [] : this.choiceRows(principal, context, 'fields'),
            people: purpose && purpose.key !== 'read_sharing' ? [] : this.choiceRows(principal, context, 'people') },
            requirements: { fields: purpose?.key === 'read_sharing', people: purpose?.key === 'read_sharing' },
            selection, held, busy: false, requests }, capabilities: { capabilities }, sharedData: { records: [],
                browseAction: { key: 'records.browse', label: 'عرض المنتجات المشتركة', enabled: !!activity && !!this.readerInstallation(context, activity.data)
                    && this.readerInstallation(context, activity.data) === context.consumerInstallationId && scopeEqual(context.selection?.scope, activity.data.scope),
                    effect: 'read', reason: activity && this.readerInstallation(context, activity.data) === context.consumerInstallationId && context.consumerInstallationId
                        && scopeEqual(context.selection?.scope, activity.data.scope) ? null : 'استخدم هذا النشاط وحدّد إذن القراءة الحالي لهذا الحساب لعرض المنتجات.' },
                ...(editor.provider && editor.fields.some(row => row.enabled) ? { createAction: { key: 'create', label: 'إضافة منتج إلى المصدر', enabled: bound && !held, effect: 'read' } } : {}) },
            commands: [], productEditor: editor, intents, held,
            ...(sharedResources ? { sharedResources: { ...sharedResources, browseAction: { enabled: sharedResources.providers.length > 0,
                label: 'عرض الخدمات والعروض المشتركة' } } } : {}),
            actions: [{ key: 'activity.create', label: 'إضافة نشاط', enabled: raw.can_create_activity && !held, effect: 'read', href: '/portal/integrations?action=activity.create' },
                ...(activity ? [{ key: 'activity.select', label: 'استخدام هذا النشاط', enabled: bound && !!native && !held, effect: 'read' }] : []),
                ...(activity && activity.data.can_manage_people && raw.capability_grant_options.some(row => row.activity_id === activity.key)
                    ? [{ key: 'capability-grants.manage', label: 'الأشخاص وصلاحيات الخدمات', enabled: bound && !held, effect: 'read' }] : []),
                ...(provider ? [{ key: 'provider.prepare', label: 'تجهيز ربط الخدمة', enabled: bound && !held, effect: 'read', href: '/portal/integrations?action=provider.prepare' },
                    { key: 'provider.refresh', label: 'تحديث تجهيز وإمكانات الخدمة',
                        enabled: bound && !held && Number.isSafeInteger(provider.data.enrollment_version) && provider.data.enrollment_version > 0,
                        reason: provider.data.enrollment_version > 0 ? null : 'جهّز ربط الخدمة أولًا ثم أعد فحص حالتها الحالية.', effect: 'read' }] : [])],
            ...(activity && activity.data.can_manage_people && raw.capability_grant_options.some(row => row.activity_id === activity.key)
                ? { grantEditor: { activity: selection.activity } } : {}),
            ...(requested && nativeChoice ? { nativeEditor: { activity: selection.activity, provider: this.issue(principal, context, 'providers', nativeChoice), capability: requested, action: requested } } : {}),
            ...(businessRequested && nativeChoice ? { businessEditor: { activity: selection.activity, provider: this.issue(principal, context, 'providers', nativeChoice), capability: businessRequested } } : {}),
            ...(mediaRequested && nativeChoice ? { mediaEditor: { activity: selection.activity, provider: this.issue(principal, context, 'providers', nativeChoice), capability: 'media.manage',
                selectionKey: hash([workspaceContextReference(principal, identity), identityProof(identity), activity.data.scope, native.provider_ref, 'media.manage']) } } : {}) };
    }
    capabilityCards(principal, context, activity) {
        if (!activity) return [];
        const rows = context.raw.command_options.filter(row => row.activity_id === activity.key);
        const cards = context.raw.capabilities.filter(row => row.activity_id === activity.key).map(row => {
            const availability = { ...row.availability, next_action: { ...row.availability.next_action,
                href: new URL(row.availability.next_action.href, this.setup.config.oidcIssuer).href } };
            return { key: hash([row.activity_id, row.provider_ref ?? null, row.code]), label: row.label, availability,
                actions: [{ key: availability.next_action.code, label: availability.next_action.label,
                    enabled: true, effect: 'read', availability, href: availability.next_action.href }] };
        });
        return [...cards, ...workspaceNativeCapabilityCards({ raw: context.raw, identity: context.identity, activityId: activity.key,
            coreOrigin: this.setup.config.oidcIssuer, urlPolicy: this.urlPolicy }), ...rows.map(row => ({ key: hash([row.activity_id, row.provider_ref, row.capability, row.action]),
            label: actionLabels[row.action] || row.action, description: row.message, actions: [{ key: row.action, label: actionLabels[row.action] || row.action,
                enabled: row.available === true && ['product.create', 'product.change', 'messaging.send', 'campaigns.execute', 'content.publish'].includes(row.action),
                effect: 'read', href: `/portal/integrations?action=${encodeURIComponent(row.action)}`, availability: availability(row.available ? 'review_available' : 'permission_required',
                    row.reason_code || 'explicit_command_review', row.message || 'تحتاج العملية إلى مراجعة واعتماد الصلاحيات الحالية.', `/portal/integrations?action=${encodeURIComponent(row.action)}`, 'review', 'مراجعة الإجراء') }] }))];
    }
    async review(principal, context, operation, payload, summary, extra = {}, before = null) {
        const key = this.choices.issueReview(principal, context, { operation, payload });
        const reviewed = await this.choices.resolveReview(principal, key, operation);
        const identity = await this.transport.currentIdentity(principal, { allowUnbound: ['binding', 'activity'].includes(operation) });
        if (identityProof(identity) !== identityProof(context.identity)) fail();
        this.intents.registerReview(principal, identity, { idempotencyKey: reviewed.idempotencyKey, operation,
            inputHash: reviewed.payloadHash, contextRevision: context.revision, reviewExpiresAt: reviewed.expiresAt });
        this.receipts.save(principal, identity, 'operation_expected', reviewed.idempotencyKey, { operation,
            payloadHash: reviewed.payloadHash, payload, before, scope: before?.scope ?? context.raw.activities.find(row => row.activity_id === (payload.activity_id ?? before?.activity_id))?.scope ?? null,
            provider: context.raw.providers.find(row => row.provider_ref === payload.provider_ref && row.activity_id === payload.activity_id) ?? null,
            namespace: operation === 'namespace' ? context.raw.service_registrations.find(row => row.provider_ref === payload.provider_ref
                && row.scope.activity_id === payload.activity_id) ?? null : null });
        const intentKey = this.refs.issue(principal, identity, { type: 'intent', key: reviewed.idempotencyKey });
        return { review: { key, intentKey, canSubmit: true, valid_until: new Date(reviewed.expiresAt).toISOString(),
            ...this.metadata(context), valid_until: new Date(reviewed.expiresAt).toISOString(), summary, submitLabel: 'إرسال الطلب المراجع', ...extra } };
    }
    async stableApprovalReview(principal, context, { kind, raw, operation, payload, summary }) {
        const currentKey = hash([kind, raw.request_id ?? raw.command_id, raw.version, hash(raw), identityProof(context.identity), this.metadata(context).viewKey,
            context.validUntil, principal.sessionId, principal.authVersion, hash(summary)]);
        const prior = this.receipts.read(principal, context.identity, 'approval_current', currentKey);
        if (prior) {
            const saved = this.receipts.read(principal, context.identity, 'approval', prior.idempotencyKey);
            const reviewed = saved && await this.choices.resolveReview(principal, saved.review, operation);
            if (!saved || reviewed.idempotencyKey !== prior.idempotencyKey || reviewed.payloadHash !== hash(payload)
                || saved.rawHash !== hash(raw) || saved.identityProof !== identityProof(context.identity)
                || saved.contextRevision !== context.revision || !scopeEqual(saved.scope, raw.scope ?? context.raw.activities.find(row => row.activity_id === raw.activity_id)?.scope)) fail();
            return { review: { key: saved.review, intentKey: saved.intent, canSubmit: true, ...this.metadata(context),
                valid_until: new Date(reviewed.expiresAt).toISOString(), summary: saved.summary, submitLabel: 'إرسال الطلب المراجع' } };
        }
        const result = await this.review(principal, context, operation, payload, summary, {}, raw);
        const reviewed = await this.choices.resolveReview(principal, result.review.key, operation);
        const saved = { review: result.review.key, intent: result.review.intentKey, idempotencyKey: reviewed.idempotencyKey,
            operation, payloadHash: reviewed.payloadHash, rawHash: hash(raw), identityProof: identityProof(context.identity),
            contextRevision: context.revision, viewKey: this.metadata(context).viewKey,
            scope: raw.scope ?? context.raw.activities.find(row => row.activity_id === raw.activity_id)?.scope, summary };
        if (!saved.scope) fail();
        // Preserve the issued intent's review even when a later GET prepares
        // a different context. Submission resolves only the explicit intent.
        const winner = this.db.transaction(() => {
            const present = this.receipts.read(principal, context.identity, 'approval_current', currentKey);
            if (present) return present.idempotencyKey;
            this.receipts.save(principal, context.identity, 'approval', reviewed.idempotencyKey, saved);
            this.receipts.save(principal, context.identity, 'approval_current', currentKey, { idempotencyKey: reviewed.idempotencyKey });
            return reviewed.idempotencyKey;
        }).immediate();
        if (winner !== reviewed.idempotencyKey) return this.stableApprovalReview(principal, context, { kind, raw, operation, payload, summary });
        return result;
    }
    async reviewedApproval(principal, context, raw, intent, operation) {
        const resolved = await this.refs.resolve(principal, intent, 'intent');
        if (identityProof({ ...resolved.identity, coreAccountId: context.identity.coreAccountId }) !== identityProof(context.identity)) fail();
        const saved = this.receipts.read(principal, context.identity, 'approval', resolved.key);
        if (!saved || saved.idempotencyKey !== resolved.key || saved.operation !== operation || saved.rawHash !== hash(raw)
            || saved.identityProof !== identityProof(context.identity) || saved.contextRevision !== context.revision
            || saved.viewKey !== this.metadata(context).viewKey || !scopeEqual(saved.scope,
                raw.scope ?? context.raw.activities.find(row => row.activity_id === raw.activity_id)?.scope)) fail();
        const reviewed = await this.choices.resolveReview(principal, saved.review, operation);
        if (reviewed.idempotencyKey !== resolved.key || reviewed.payloadHash !== saved.payloadHash
            || reviewed.payload.target !== (raw.request_id ?? raw.command_id) || reviewed.payload.expected_version !== raw.version) fail();
        return saved.review;
    }
    async reviewActivity(principal, { name }) {
        const context = await this.loadContext(principal);
        if (context.raw.can_create_activity !== true || !text(name, 200) || name.trim().length < 2) fail('workspace_activity_forbidden', 403);
        return this.review(principal, context, 'activity', { name: name.trim() }, [{ label: 'النشاط الجديد', value: name.trim() }]);
    }
    async reviewBinding(principal) {
        const context = await this.loadContext(principal);
        if (context.identity.coreAccountId) fail();
        const displayName = this.db.prepare('SELECT name FROM tenants WHERE id=?').get(principal.tenantId)?.name;
        if (!text(displayName, 200)) fail('workspace_native_account_unavailable', 403);
        const state = crypto.randomBytes(32).toString('base64url');
        this.receipts.save(principal, context.identity, 'binding', state, { state, external_tenant_id: context.nativeAccountId });
        return this.review(principal, context, 'binding', { external_tenant_id: context.nativeAccountId, display_name: displayName,
            redirect_uri: `${this.setup.appOrigin}/portal/integrations`, state, expected_selection_revision: context.raw.selection_revision },
        [{ label: 'الحساب', value: displayName }, { label: 'المؤسسة', value: context.raw.organization.name }, { label: 'الموافقة', value: 'متابعة ربط الحساب في صفحة المؤسسة' }]);
    }
    async reviewProvider(principal, { provider }) {
        const { option, context } = await this.choices.resolve(principal, provider, 'providers');
        if (option.data.platform === 'wa_savana' && option.data.provider_ref === context.identity.coreAccountId) await this.proofs.capture(principal);
        return this.review(principal, context, 'provider', { provider_ref: option.data.provider_ref, activity_id: option.data.activity_id },
            [{ label: 'الخدمة', value: option.label }, { label: 'الإجراء', value: 'تجهيز تسجيل الخدمة مع الاحتفاظ بمفاتيحها الحالية' }]);
    }
    async reviewProviderRefresh(principal, { provider }) {
        const { option, context } = await this.choices.resolve(principal, provider, 'providers');
        if (!option.data.activity_id || !Number.isSafeInteger(option.data.enrollment_version)) fail('workspace_provider_registration_required', 409);
        return this.review(principal, context, 'provider_refresh', { provider_ref: option.data.provider_ref, activity_id: option.data.activity_id },
            [{ label: 'الخدمة', value: option.label }, { label: 'الإجراء', value: 'إعادة فحص الجاهزية والاشتراك الحاليين من الخدمة المسجلة؛ لا يُنشئ صلاحيات أو ينفّذ عملية تجارية' }]);
    }
    grantOptions(principal, input) { return this.grants.options(principal, input); }
    reviewCapabilityGrant(principal, input) { return this.grants.review(principal, input); }
    async resolveMany(principal, context, tokens, kind) {
        if (!Array.isArray(tokens) || tokens.length > 100 || new Set(tokens).size !== tokens.length) fail('workspace_request_invalid', 422);
        const rows = [];
        for (const token of tokens) {
            const value = await this.choices.resolve(principal, token, kind);
            if (value.context.revision !== context.revision) fail();
            rows.push(value.option);
        }
        return rows;
    }
    async connectionPayload(principal, input) {
        const { context, activity, provider, purpose } = await this.selected(principal, input);
        if (!activity || !provider || !purpose || !activity.data.my_actions.includes(requiredActions[purpose.key])) fail('workspace_connection_forbidden', 403);
        const fields = await this.resolveMany(principal, context, input.fields, 'fields');
        const people = await this.resolveMany(principal, context, input.people, 'people');
        const body = { activity_id: activity.key, kind: purpose.key, fields: fields.map(row => row.key), people_refs: people.map(row => row.key) };
        const ownProvider = context.raw.providers.find(row => row.provider_ref === context.identity.coreAccountId && row.activity_id === activity.key && row.platform === 'wa_savana');
        if (!ownProvider) fail('workspace_native_binding_required', 403);
        if (purpose.key === 'read_sharing') {
            const ownInstallations = ownProvider.installations.filter(row => row.activity_id === activity.key);
            if (!fields.length || !people.length || !provider.data.selectedInstallation || ownInstallations.length !== 1) fail('workspace_read_registration_required', 409);
            body.source_installation_ref = provider.data.selectedInstallation;
            body.consumer_installation_ref = ownInstallations[0].installation_id;
        } else if (purpose.key === 'consumer_registration') {
            if (provider.data.provider_ref !== ownProvider.provider_ref || fields.length || people.length) fail('workspace_consumer_selection_invalid', 422);
            body.provider_ref = ownProvider.provider_ref;
        } else if (purpose.key === 'native_namespace') {
            if (provider.data.provider_ref !== ownProvider.provider_ref || fields.length || people.length
                || !activity.data.my_actions.includes('read.approve') || !Number.isSafeInteger(ownProvider.enrollment_version)) fail('workspace_namespace_requirements', 403);
            const previous = context.raw.service_registrations.filter(row => row.scope?.activity_id === activity.key && row.provider_ref === ownProvider.provider_ref);
            if (previous.length > 1) fail();
            return { context, operation: 'namespace', body: { activity_id: activity.key, provider_ref: ownProvider.provider_ref,
                expected_enrollment_version: ownProvider.enrollment_version, expected_version: previous[0]?.version ?? 0,
                expires_at: new Date(this.now() + 30 * 86400_000).toISOString() },
            summary: [{ label: 'الخدمة', value: provider.label }, { label: 'النشاط', value: activity.label },
                { label: 'صلاحية التسجيل', value: 'ثلاثون يومًا؛ صلاحيات كل عملية تُعتمد بصورة مستقلة' }] };
        }
        return { context, operation: 'connection', body, summary: [{ label: 'الغرض', value: purpose.label }, { label: 'النشاط', value: activity.label },
            { label: 'المصدر', value: provider.label }, { label: 'الحقول', value: fields.map(row => row.label).join('، ') || 'بدون مشاركة حقول' },
            { label: 'الأشخاص', value: people.map(row => row.label).join('، ') || 'بدون منح قراءة لأشخاص' }] };
    }
    async reviewConnection(principal, input) {
        const result = await this.connectionPayload(principal, input);
        return this.review(principal, result.context, result.operation, result.body, result.summary,
            { selectionKey: JSON.stringify([input.activity, input.purpose, input.provider, [...input.fields].sort(), [...input.people].sort()]) });
    }
    assertCorrelatedResult(principal, identity, operation, idempotencyKey, result) {
        const expected = this.receipts.read(principal, identity, 'operation_expected', idempotencyKey);
        const invalid = () => fail('workspace_response_invalid', 502);
        if (!expected || expected.operation !== operation || expected.payloadHash !== hash(expected.payload)) invalid();
        const input = expected.payload, before = expected.before;
        const sameList = (left, right) => Array.isArray(left) && Array.isArray(right) && left.length === right.length
            && left.every(item => right.includes(item));
        const requestProposal = () => {
            if (result.kind !== input.kind || !scopeEqual(result.scope, expected.scope)) invalid();
            if (input.kind === 'read_sharing' && (result.proposal.source_installation_id !== input.source_installation_ref
                || result.proposal.consumer_installation_id !== input.consumer_installation_ref
                || !sameList(result.proposal.fields, input.fields) || !sameList(result.proposal.reader_account_ids, input.people_refs)
                || (input.expires_at != null && !sameInstant(result.proposal.expires_at, input.expires_at)))) invalid();
            if (input.kind === 'consumer_registration' && (!expected.provider || expected.provider.provider_ref !== input.provider_ref
                || result.proposal.enrollment_id !== expected.provider.enrollment_id
                || result.proposal.enrollment_version !== expected.provider.enrollment_version)) invalid();
        };
        if (operation.startsWith('command_')) {
            if (operation === 'command_create') {
                if (result.version !== 1 || result.state !== 'pending_review' || result.requested_by !== identity.actorId
                    || result.activity_id !== input.activity_id || result.provider_ref !== input.provider_ref || result.capability !== input.capability
                    || result.action !== input.action || hash(result.payload) !== hash(input.payload)) invalid();
            } else {
                if (!before || result.command_id !== before.command_id || result.command_id !== input.target
                    || ['organization_id', 'activity_id', 'provider_ref', 'capability', 'action', 'requested_by'].some(key => result[key] !== before[key])
                    || input.expected_version !== before.version) invalid();
                if (operation === 'command_edit') {
                    if (result.version !== before.version + 1 || result.state !== 'pending_review' || result.reviewed_by != null
                        || result.approval_fingerprint != null || result.source_result != null || hash(result.payload) !== hash(input.payload)) invalid();
                } else {
                    if (hash(result.payload) !== hash(before.payload)) invalid();
                    if (operation === 'command_approve' && (result.version !== before.version || result.reviewed_by !== identity.actorId
                        || !['approved', 'dispatching', 'outcome_unknown', 'source_pending', 'cancel_requested', 'cancelled', 'source_applied', 'source_partially_applied', 'failed', 'conflict'].includes(result.state))) invalid();
                    if (operation === 'command_reject' && (result.version !== before.version || result.state !== 'rejected'
                        || result.reviewed_by !== identity.actorId || result.source_result != null)) invalid();
                    if (['command_dispatch', 'command_cancel'].includes(operation) && (result.version !== before.version
                        || result.reviewed_by !== before.reviewed_by || result.approval_fingerprint !== before.approval_fingerprint)) invalid();
                    if (operation === 'command_dispatch' && (before.state !== 'approved'
                        || !['approved', 'dispatching', 'outcome_unknown', 'source_pending', 'source_applied', 'source_partially_applied', 'failed', 'conflict'].includes(result.state))) invalid();
                    if (operation === 'command_cancel' && !['cancel_requested', 'cancelled', 'source_applied', 'source_partially_applied'].includes(result.state)) invalid();
                    if (operation === 'command_reconcile' && (result.version < before.version
                        || (before.reviewed_by != null && result.reviewed_by !== before.reviewed_by)
                        || (before.approval_fingerprint != null && result.approval_fingerprint !== before.approval_fingerprint)
                        || (before.state !== 'pending_review' && result.state === 'pending_review'))) invalid();
                }
            }
        } else if (operation === 'connection') {
            if (result.version !== 1 || result.state !== 'pending' || result.requested_by !== identity.actorId) invalid();
            requestProposal();
        } else if (['request_edit', 'request_approve', 'request_reject'].includes(operation)) {
            if (!before || result.request_id !== before.request_id || result.request_id !== input.target || result.organization_id !== before.organization_id
                || result.kind !== before.kind || result.requested_by !== before.requested_by || !scopeEqual(result.scope, before.scope)
                || input.expected_version !== before.version) invalid();
            if (operation === 'request_edit') {
                if (result.version !== before.version + 1 || result.state !== 'pending' || result.reviewed_by !== null) invalid();
                requestProposal();
            } else {
                if (result.version !== before.version || hash(result.proposal) !== hash(before.proposal) || result.reviewed_by !== identity.actorId) invalid();
                if (operation === 'request_approve' && (result.state !== 'approved' || result.effective_version !== result.version)) invalid();
                if (operation === 'request_reject' && (result.state !== 'rejected' || result.reason !== input.reason
                    || result.effective_version !== before.effective_version || hash(result.effective_resource) !== hash(before.effective_resource))) invalid();
            }
        } else if (operation === 'namespace') {
            if (!scopeEqual(result.scope, expected.scope) || result.platform !== 'wa_savana' || result.provider_ref !== input.provider_ref
                || result.external_tenant_id !== identity.nativeAccountId || result.enrollment_version !== input.expected_enrollment_version
                || result.enrollment_id !== expected.provider?.enrollment_id || result.version !== input.expected_version + 1
                || !sameInstant(result.expires_at, input.expires_at) || result.state !== 'active'
                || (expected.namespace && (result.namespace_id !== expected.namespace.namespace_id
                    || result.source_installation_id !== expected.namespace.source_installation_id))) invalid();
        } else if (operation === 'selection') {
            if (!scopeEqual(result.scope, expected.scope) || result.activity.activity_id !== input.activity_id
                || result.account.provider_ref !== input.provider_ref || result.account.external_tenant_id !== input.external_tenant_id
                || result.account.platform !== expected.provider?.platform) invalid();
        } else if (operation === 'grant_revoke') {
            if (result.read_grant_id !== input.target || result.active !== false || !Number.isSafeInteger(result.revision)
                || result.revision !== input.expected_revision + 1) invalid();
        } else if (operation === 'binding' && (result.external_tenant_id !== input.external_tenant_id || result.display_name !== input.display_name
            || result.redirect_uri !== input.redirect_uri || result.created_by_actor !== identity.actorId)) invalid();
        else if (operation === 'activity' && result.label !== input.name) invalid();
        else if (operation === 'provider_refresh' && (!expected.provider || result.provider_ref !== input.provider_ref
            || result.activity_id !== input.activity_id || !scopeEqual(result.scope, expected.scope)
            || result.enrollment_version !== expected.provider.enrollment_version)) invalid();
        else if (operation === 'provider' && (!expected.provider || result.provider_ref !== input.provider_ref
            || result.activity_id !== input.activity_id || !scopeEqual(result.scope, expected.scope)
            || result.enrollment.platform !== expected.provider.platform
            || result.enrollment.external_tenant_id !== expected.provider.external_tenant_id
            || (expected.provider.enrollment_id != null && result.enrollment.enrollment_id !== expected.provider.enrollment_id))) invalid();
        return result;
    }
    providerDecodeOptions(principal, identity, idempotencyKey, status) {
        const expected = this.receipts.read(principal, identity, 'operation_expected', idempotencyKey);
        if (expected?.operation !== 'provider' || !expected.provider || !expected.scope) fail('workspace_receipt_unverified', 403);
        return { ...this.urlPolicy, providerRef: expected.payload.provider_ref, activityId: expected.payload.activity_id,
            scope: expected.scope, platformCode: expected.provider.platform, externalTenantId: expected.provider.external_tenant_id, status };
    }
    async acceptProviderConfirmation(principal, identity, result) {
        if (result.enrollment.platform !== 'wa_savana' || result.provider_ref !== identity.coreAccountId) return;
        if (!this.nativeEnrollment) fail('workspace_native_enrollment_unavailable', 503);
        if (result.enrollment.external_tenant_id !== identity.nativeAccountId) fail('workspace_response_invalid', 502);
        const assertCurrent = () => {
            const owner = this.setup.store.ownerSession(principal);
            if (this.verify(principal) !== true || !owner || !this.setup.store.ownerCurrent(principal, owner)
                || owner.actorId !== identity.actorId || owner.organizationId !== identity.organizationId
                || owner.generation !== identity.generation || owner.expiresAt !== identity.expiresAt) fail('workspace_context_changed', 403);
            return true;
        };
        const fresh = async () => {
            assertCurrent();
            const current = await this.transport.currentIdentity(principal);
            if (identityProof(current) !== identityProof(identity)) fail('workspace_context_changed', 403);
            assertCurrent();
        };
        await fresh();
        await this.proofs.capture(principal);
        await fresh();
        const context = { actor_id: identity.actorId, ...result.scope, external_tenant_id: identity.nativeAccountId };
        const retained = await this.nativeEnrollment.read(context);
        await fresh();
        const rows = retained.enrollments.filter(row => row.external_tenant_id === identity.nativeAccountId && row.organization_id === identity.organizationId);
        if (rows.length !== 1) fail('workspace_native_enrollment_unavailable', 503);
        await this.nativeEnrollment.acceptVerifiedRegistration(context, { registration: result.enrollment,
            expectedEnrollmentVersion: rows[0].enrollment_version }, { assertCurrent });
        await fresh();
    }
    planners() {
        const plan = (operation, method, suffix, model, decode, includeConsumer = true) => ({
            includeConsumer,
            request: async reviewed => {
                const body = structuredClone(reviewed.payload);
                const path = typeof suffix === 'function' ? suffix(body) : suffix;
                delete body.target;
                if (['provider', 'provider_refresh'].includes(operation)) delete body.provider_ref;
                if (['activity', 'selection', 'namespace', 'connection', 'command_create'].includes(operation)) body.idempotency_key = reviewed.idempotencyKey;
                if (model) (model.startsWith('Command') ? validateNativeCommandModel : validateWorkspaceCoreModel)(model, body);
                return { method, path: `${BASE}${path}`, body };
            },
            result: async ({ principal, reviewed, response, request }) => {
                const identity = reviewed.context.identity;
                const result = decode(response, identity, operation === 'provider'
                    ? this.providerDecodeOptions(principal, identity, reviewed.idempotencyKey, 'prepared')
                    : { ...this.urlPolicy, externalTenantId: identity.nativeAccountId });
                this.assertCorrelatedResult(principal, identity, operation, reviewed.idempotencyKey, result);
                if (operation === 'provider') await this.acceptProviderConfirmation(principal, identity, result);
                if (operation === 'namespace') this.receipts.save(principal, identity, 'namespace', result.source_installation_id, result);
                if (operation === 'selection') this.saveSelection(principal, identity, reviewed.idempotencyKey, result);
                if (operation === 'binding') this.receipts.save(principal, identity, 'binding', request.body.state, { state: request.body.state, receipt: result });
                return result;
            },
        });
        const command = (raw, identity) => {
            validateNativeCommandModel('CommandResponse', raw);
            if (raw.organization_id !== identity.organizationId) fail('workspace_response_invalid', 502);
            return raw;
        };
        return {
            activity: plan('activity', 'POST', '/activities', 'WorkspaceActivityCreate', decodeWorkspaceActivity),
            binding: plan('binding', 'POST', '/binding-requests', 'WorkspaceBindingRequest', decodeWorkspaceBinding),
            selection: plan('selection', 'POST', '/selection', 'WorkspaceSelectionRequest', decodeWorkspaceSelection),
            provider: plan('provider', 'POST', body => `/providers/${pathId(body.provider_ref)}/prepare`, 'WorkspaceProviderPrepare', decodeWorkspaceProviderPrepare),
            provider_refresh: plan('provider_refresh', 'POST', body => `/providers/${pathId(body.provider_ref)}/refresh`, 'WorkspaceProviderPrepare', (raw, identity) => {
                validateWorkspaceCoreModel('WorkspaceProviderReadinessRefresh', raw);
                if (raw.scope.organization_id !== identity.organizationId || !text(raw.checked_at) || !Number.isFinite(Date.parse(raw.checked_at))
                    || Date.parse(raw.checked_at) > this.now() || !Number.isSafeInteger(raw.profile_version) || raw.profile_version < 1) fail('workspace_response_invalid', 502);
                return raw;
            }, false),
            capability_grant: this.grants.planner(),
            namespace: plan('namespace', 'POST', '/namespaces', 'NamespaceRegistration', decodeWorkspaceNamespace),
            connection: plan('connection', 'POST', '/requests', 'WorkspaceRequestCreate', decodeWorkspaceRequest),
            request_edit: plan('request_edit', 'PATCH', body => `/requests/${pathId(body.target)}`, 'WorkspaceRequestEdit', decodeWorkspaceRequest),
            request_approve: plan('request_approve', 'POST', body => `/requests/${pathId(body.target)}/approve`, 'CommandVersion', decodeWorkspaceRequest),
            request_reject: plan('request_reject', 'POST', body => `/requests/${pathId(body.target)}/reject`, 'CommandReject', decodeWorkspaceRequest),
            grant_revoke: plan('grant_revoke', 'POST', body => `/read-grants/${pathId(body.target)}/revoke`, null, raw => { exact(raw, ['read_grant_id', 'revision', 'active']); if (raw.active !== false) fail('workspace_response_invalid', 502); return raw; }),
            command_create: plan('command_create', 'POST', '/commands', 'CommandCreate', command),
            command_edit: plan('command_edit', 'PATCH', body => `/commands/${pathId(body.target)}`, 'CommandEdit', command),
            command_approve: plan('command_approve', 'POST', body => `/commands/${pathId(body.target)}/approve`, 'CommandVersion', command),
            command_reject: plan('command_reject', 'POST', body => `/commands/${pathId(body.target)}/reject`, 'CommandReject', command),
            command_reconcile: plan('command_reconcile', 'POST', body => `/commands/${pathId(body.target)}/reconcile`, 'CommandVersion', command),
            command_dispatch: plan('command_dispatch', 'POST', body => `/commands/${pathId(body.target)}/dispatch`, 'CommandVersion', command),
            command_cancel: plan('command_cancel', 'POST', body => `/commands/${pathId(body.target)}/cancel`, 'CommandReject', command),
        };
    }
    publicIntent(principal, identity, row) { return { key: this.refs.issue(principal, identity, { type: 'intent', key: row.idempotencyKey }), state: row.state }; }
    async submit(principal, input) {
        const result = await this.mutations.submit(principal, input);
        return { state: result.intent.state, ...(result.result?.authorization_url ? { authorization_url: result.result.authorization_url } : {}) };
    }
    async reviewSelection(principal, { activity }) {
        const { context, activity: selected } = await this.selected(principal, { activity });
        const provider = context.raw.providers.find(row => row.provider_ref === context.identity.coreAccountId && row.activity_id === selected?.key && row.platform === 'wa_savana');
        if (!provider) fail('workspace_native_binding_required', 403);
        return this.review(principal, context, 'selection', { activity_id: selected.key, provider_ref: provider.provider_ref,
            external_tenant_id: context.nativeAccountId, expected_selection_revision: context.raw.selection_revision },
        [{ label: 'المؤسسة', value: context.raw.organization.name }, { label: 'النشاط', value: selected.label }, { label: 'الحساب', value: provider.label },
            { label: 'الأذونات', value: 'اختيار النشاط لا يمنح صلاحيات قراءة أو تنفيذ جديدة.' }]);
    }
    async select(principal, { activity }) {
        const reviewed = await this.reviewSelection(principal, { activity });
        await this.submit(principal, { review: reviewed.review.key });
        return this.overview(principal);
    }
    async loadOutcome(input) {
        const { principal, identity, operation, idempotencyKey, request } = input;
        const body = request.bodyJson == null ? {} : JSON.parse(request.bodyJson);
        const correlation = { intentId: input.intentId, inputHash: input.inputHash, requestHash: input.requestHash,
            actorId: identity.actorId, organizationId: identity.organizationId, nativeAccountId: identity.nativeAccountId };
        const unknown = () => ({ state: 'unknown', correlation });
        try {
            const expected = this.receipts.read(principal, identity, 'operation_expected', idempotencyKey);
            if (!expected || expected.operation !== operation || expected.payloadHash !== input.inputHash) return unknown();
            if (operation === 'capability_grant') return this.grants.recover(input, expected, correlation);
            let path, decode, result, consumerInstallation = null;
            if (operation === 'binding') {
                path = `/binding-requests/lookup?${new URLSearchParams({ external_tenant_id: identity.nativeAccountId, state: body.state })}`;
                decode = decodeWorkspaceBinding;
            } else if (operation === 'provider') {
                path = `/providers/${pathId(expected.payload.provider_ref)}/enrollment?${new URLSearchParams({ activity_id: expected.payload.activity_id })}`;
                decode = decodeWorkspaceProviderPrepare;
            } else if (['selection', 'connection', 'namespace', 'command_create'].includes(operation)) {
                path = `${{ selection: '/selection', connection: '/requests', namespace: '/namespaces', command_create: '/commands' }[operation]}/lookup?${new URLSearchParams({ idempotency_key: idempotencyKey })}`;
                decode = { selection: decodeWorkspaceSelection, connection: decodeWorkspaceRequest, namespace: decodeWorkspaceNamespace,
                    command_create: raw => validateNativeCommandModel('CommandResponse', raw) }[operation];
                if (operation === 'command_create') consumerInstallation = (await this.currentSelection(principal, identity))?.consumer_installation_id ?? null;
            } else if (['command_edit', 'command_approve', 'command_reject', 'command_reconcile', 'command_dispatch', 'command_cancel', 'request_edit', 'request_approve', 'request_reject'].includes(operation)) {
                const current = await this.loadContext(principal);
                if (identityProof(current.identity) !== identityProof(identity)) return unknown();
                consumerInstallation = current.consumerInstallationId;
                const activity = current.raw.activities.find(row => scopeEqual(row.scope, expected.scope));
                if (!activity) return unknown();
                if (operation.startsWith('command_')) {
                    if (!activity.my_actions.includes('commands.read')) return unknown();
                    path = `/commands/${pathId(expected.before?.command_id)}`;
                    decode = raw => validateNativeCommandModel('CommandResponse', raw);
                } else {
                    result = current.raw.existing.requests.find(row => row.request_id === expected.before?.request_id);
                    if (!result) return unknown();
                }
            } else return unknown(); // No published activity history lookup.
            if (path) {
                const response = await this.transport.request(principal, { path: BASE + path, expectedIdentity: identity, consumerInstallation });
                result = decode(response.payload, identity, operation === 'provider'
                    ? this.providerDecodeOptions(principal, identity, idempotencyKey, 'confirmed')
                    : { ...this.urlPolicy, externalTenantId: identity.nativeAccountId });
            }
            this.assertCorrelatedResult(principal, identity, operation, idempotencyKey, result);
            if (operation === 'provider') await this.acceptProviderConfirmation(principal, identity, result);
            if (operation === 'namespace') this.receipts.save(principal, identity, 'namespace', result.source_installation_id, result);
            if (operation === 'selection') this.saveSelection(principal, identity, idempotencyKey, result);
            return { state: 'completed', result, correlation };
        } catch { return unknown(); }
    }
    async intent(principal, { intent }) {
        const { key, identity: opened } = await this.refs.resolve(principal, intent, 'intent');
        const identity = await this.transport.currentIdentity(principal, { allowUnbound: true });
        if (identity.actorId !== opened.actorId || identity.organizationId !== opened.organizationId || identity.nativeAccountId !== opened.nativeAccountId
            || identity.generation !== opened.generation) fail('workspace_context_changed', 403);
        let result;
        try { result = this.intents.readByKey(principal, identity, key); }
        catch (error) {
            if (error?.code !== 'workspace_intent_not_found') throw error;
            const context = await this.loadContext(principal);
            if (identityProof(identity) !== identityProof(context.identity)) fail('workspace_context_changed', 403);
            result = this.intents.reviewOutcome(principal, identity, key, { contextRevision: context.revision });
            return { intent: { key: intent, state: result.intent.state } };
        }
        if (!['completed', 'failed'].includes(result.intent.state)) result = await this.intents.reconcile(principal, identity, result.intent.id);
        return { intent: { key: intent, state: result.intent.state } };
    }
    reconcileIntent(principal, input) { return this.intent(principal, input); }
    async requestRows(principal, context, activity) {
        return Promise.all(context.raw.existing.requests.filter(row => row.scope.activity_id === activity.activity_id).map(raw => this.presentRequest(principal, context, activity, raw)));
    }
    async verifyRequestRead({ principal, context: previous, activity, request }) {
        const current = await this.loadContext(principal);
        const scope = current.raw.activities.find(row => row.activity_id === activity.activity_id)?.scope;
        const visible = current.raw.existing.requests.find(row => row.request_id === request.request_id);
        return identityProof(current.identity) === identityProof(previous.identity) && current.revision === previous.revision
            && this.metadata(current).viewKey === this.metadata(previous).viewKey && scopeEqual(scope, request.scope)
            && visible != null && hash(visible) === hash(request);
    }
    async presentRequest(principal, context, activity, raw) {
        const result = await presentWorkspaceRequest({ principal, context, activity, raw, refs: this.refs, now: this.now,
            issueChoice: (kind, option) => this.issue(principal, context, kind, option),
            verifyCurrent: input => this.verifyRequestRead(input),
            issueReview: (operation, payload, summary) => this.stableApprovalReview(principal, context,
                { kind: 'request', raw, operation, payload, summary }) });
        return result.request;
    }
    async requests(principal, input = {}) {
        const { context, activity } = await this.selected(principal, input);
        return { ...this.metadata(context), requests: activity ? await this.requestRows(principal, context, activity.data) : [] };
    }
    async currentRequest(principal, reference) {
        const resolved = await this.refs.resolve(principal, reference, 'request');
        const context = await this.loadContext(principal);
        const raw = context.raw.existing.requests.find(row => row.request_id === resolved.key);
        if (!raw) fail('workspace_request_not_found', 404);
        if (raw.version !== resolved.version) fail();
        const activity = context.raw.activities.find(row => row.activity_id === raw.scope.activity_id);
        if (!activity || !scopeEqual(activity.scope, raw.scope)) fail('workspace_request_forbidden', 403);
        return { raw, activity, context };
    }
    async request(principal, { request }) {
        const { raw, activity, context } = await this.currentRequest(principal, request);
        return { ...this.metadata(context), request: await this.presentRequest(principal, context, activity, raw) };
    }
    async approveRequest(principal, { request, intent }) {
        const { raw, activity, context } = await this.currentRequest(principal, request);
        if (raw.state !== 'pending' || !activity.my_actions.includes(approvalAction(raw.kind))) fail('workspace_approval_forbidden', 403);
        const review = await this.reviewedApproval(principal, context, raw, intent, 'request_approve');
        return this.submit(principal, { review });
    }
    async reviewRequestReject(principal, { request, reason }) {
        const { raw, activity, context } = await this.currentRequest(principal, request);
        if (raw.state !== 'pending' || !activity.my_actions.includes(approvalAction(raw.kind)) || !text(reason, 1000)) fail('workspace_approval_forbidden', 403);
        return this.review(principal, context, 'request_reject', { target: raw.request_id, expected_version: raw.version, reason }, [{ label: 'الإجراء', value: 'رفض الطلب الحالي' }, { label: 'السبب', value: reason }], {}, raw);
    }
    async reviewRequestEdit(principal, input) {
        const current = await this.currentRequest(principal, input.request);
        if (current.raw.state !== 'pending' || current.raw.requested_by !== current.context.identity.actorId) fail('workspace_edit_forbidden', 403);
        const updated = await this.connectionPayload(principal, input);
        if (updated.operation !== 'connection' || updated.body.activity_id !== current.raw.scope.activity_id || updated.body.kind !== current.raw.kind) fail();
        const body = { ...updated.body, ...(current.raw.kind === 'read_sharing' ? { expires_at: current.raw.proposal.expires_at } : {}),
            target: current.raw.request_id, expected_version: current.raw.version };
        const labels = (kind, keys) => keys.map(key => {
            const options = updated.context.choices[kind].filter(row => row.key === key && text(row.label, 1000));
            if (options.length !== 1) fail('workspace_request_labels_required', 503);
            return options[0].label;
        });
        const summary = [...updated.summary];
        let removedFields = [], removedPeople = [];
        if (current.raw.kind === 'read_sharing') {
            summary.push({ label: 'حقول الاقتراح قبل التعديل', value: labels('fields', current.raw.proposal.fields).join('، ') },
                { label: 'أشخاص الاقتراح قبل التعديل', value: labels('people', current.raw.proposal.reader_account_ids).join('، ') },
                { label: 'صالح حتى', value: body.expires_at });
            if (current.raw.effective_resource) {
                const effective = current.raw.effective_resource;
                summary.push({ label: 'الحقول المعتمدة حاليًا', value: labels('fields', effective.fields).join('، ') },
                    { label: 'الأشخاص المعتمدون حاليًا', value: labels('people', effective.reader_account_ids).join('، ') });
                removedFields = labels('fields', effective.fields.filter(field => !body.fields.includes(field)));
                removedPeople = labels('people', effective.reader_account_ids.filter(person => !body.people_refs.includes(person)));
            }
        }
        return this.review(principal, updated.context, 'request_edit', body, summary,
            { removedFields, removedPeople, selectionKey: JSON.stringify([input.activity, input.purpose, input.provider, [...input.fields].sort(), [...input.people].sort()]) }, current.raw);
    }
    async reviewGrantRevoke(principal, { grant, reason }) {
        const resolved = await this.refs.resolve(principal, grant, 'read_grant');
        const context = await this.loadContext(principal);
        const raw = context.raw.existing.grants.find(row => row.grant_ref === resolved.key && row.type === 'read');
        const activity = context.raw.activities.find(row => row.activity_id === raw?.scope.activity_id);
        if (!raw || raw.revision !== resolved.version || !raw.active || !activity?.my_actions.includes('read.manage') || !text(reason, 500)) fail('workspace_revocation_forbidden', 403);
        return this.review(principal, context, 'grant_revoke', { target: raw.read_grant_id, expected_revision: raw.revision, reason },
            [{ label: 'الإجراء', value: 'سحب قراءة البيانات المشتركة' }, { label: 'المصدر', value: raw.source_label }, { label: 'السبب', value: reason }], {}, raw);
    }
    readerInstallation(context, activity) {
        const own = context.raw.providers.find(row => row.activity_id === activity.activity_id && row.provider_ref === context.identity.coreAccountId && row.platform === 'wa_savana');
        if (!own) return null;
        const grants = context.raw.existing.grants.filter(row => row.type === 'read' && row.active && !row.expired
            && scopeEqual(row.scope, activity.scope) && Date.parse(row.expires_at) > this.now()
            && row.policy.reader_account_ids.includes(context.identity.actorId));
        const installations = [...new Set(grants.map(row => row.consumer_installation_id))]
            .filter(id => own.installations.some(row => row.activity_id === activity.activity_id && row.installation_id === id));
        return installations.length === 1 ? installations[0] : null;
    }
    async ensureReader(principal, context, activity) {
        const installation = this.readerInstallation(context, activity);
        if (!installation) fail('workspace_read_grant_required', 403);
        const current = this.setup.store.load(principal);
        if (!current || current.consumerInstallationId !== installation || !scopeEqual(current.scope, activity.scope)) {
            await this.setup.bindReader(principal, { consumer_installation_id: installation, activity_id: activity.activity_id,
                branch_id: activity.scope.branch_id, warehouse_id: activity.scope.warehouse_id });
        }
    }
    sourceFor(context, record) {
        const sources = context.raw.providers.filter(provider => provider.activity_id === record.scope.activity_id
            && provider.installations.some(installation => installation.installation_id === record.source.installation_id));
        if (sources.length !== 1) fail('workspace_source_labels_unavailable', 503);
        return sources[0];
    }
    async formatProductField({ context, field, value, provider, command }) {
        const raw = context.raw || context.coreContext?.raw;
        const source = provider || raw?.providers.find(row => row.provider_ref === command?.provider_ref && row.activity_id === command?.activity_id);
        const policy = source?.policy_choices;
        if (field === 'base_unit') return policy?.unit_codes?.find(row => row.value === value)?.label ?? null;
        if (field === 'price' && value && typeof value.amount === 'string' && /^(0|[1-9][0-9]*)(\.[0-9]{1,3})?$/.test(value.amount)) {
            const currency = policy?.currencies?.find(row => row.value === value.currency);
            const unit = policy?.unit_codes?.find(row => row.value === value.unit_code);
            const list = policy?.price_lists?.find(row => row.value === value.price_list_id);
            const channel = policy?.channels?.find(row => row.value === value.channel);
            return currency && unit && list && channel ? `${value.amount} ${currency.label} / ${unit.label} / ${list.label} / ${channel.label}` : null;
        }
        // Only metadata already returned by the current authorized Core read.
        // No asset reference is turned into a URL or a claim to image bytes.
        if (field === 'media' && Array.isArray(value)) return value.length
            ? `ملفات مرفقة مشتركة: ${value.length} — عرض المحتوى غير متاح من هنا` : 'بدون صور';
        return null;
    }
    async productSummary(context, provider, payload) {
        const rows = [];
        for (const [field, value] of Object.entries(payload.fields)) {
            const display = ['name', 'description', 'sku'].includes(field) ? value : field === 'barcodes' ? value.join('، ')
                : await this.formatProductField({ context, provider, field, value });
            if (typeof display !== 'string') fail('workspace_product_labels_required', 503);
            rows.push({ label: fieldLabels[field], value: display || 'قيمة فارغة' });
        }
        for (const field of payload.clear_fields || []) rows.push({ label: fieldLabels[field], value: 'مسح القيمة من المصدر' });
        return rows;
    }
    async presentRecord(principal, context, raw) {
        const source = this.sourceFor(context, raw);
        const label = text(raw.data.name, 200) ? raw.data.name : 'منتج مشترك';
        const fields = [];
        for (const [field, value] of Object.entries(raw.data)) {
            if (!Object.hasOwn(fieldLabels, field)) continue;
            const displayValue = typeof value === 'string' && !['base_unit', 'media', 'price'].includes(field) ? value
                : field === 'barcodes' && Array.isArray(value) ? value.join('، ')
                    : field === 'is_visible' && typeof value === 'boolean' ? value ? 'متاح' : 'مخفي'
                        : await this.formatProductField({ context, provider: source, field, value });
            if (displayValue !== null) fields.push({ key: field, label: fieldLabels[field], displayValue, sourceLabel: source.label,
                authoritative: true, observed_at: raw.observed_at, received_at: raw.received_at });
        }
        const commandOption = workspaceProductOption(context, { activity_id: raw.scope.activity_id, scope: raw.scope }, source, raw);
        return { key: this.refs.issue(principal, context.identity, { type: 'record', key: raw.entity_id, version: raw.version }), label,
            sourceLabel: source.label, fields, stateLabel: raw.state === 'active' ? 'متاح من المصدر' : 'غير متاح حاليًا',
            freshnessLabel: raw.freshness === 'current' ? 'بيانات حديثة' : 'تحتاج تحديثًا',
            freshnessDescription: 'آخر معلومة مؤكدة من المصدر المعتمد ضمن منحة القراءة الحالية.',
            actions: [{ key: 'detail', label: 'عرض التفاصيل', enabled: true, effect: 'read' },
                ...(commandOption ? [{ key: 'edit', label: 'طلب تعديل في المصدر', enabled: true, effect: 'read' }] : [])] };
    }
    async records(principal, input = {}) {
        const { context, activity } = await this.selected(principal, input);
        if (!activity) return { ...this.metadata(context), records: [] };
        if (!this.readerInstallation(context, activity.data)) fail('workspace_read_grant_required', 403);
        const result = await this.products.search(principal, context, activity.data, { q: input.q || '', cursor: input.cursor || null });
        const latest = await this.loadContext(principal);
        if (latest.revision !== context.revision || !scopeEqual(result.context.scope, activity.data.scope)) fail();
        const records = await Promise.all(result.records.map(row => this.presentRecord(principal, context, row)));
        return { ...this.readMetadata(context, result, latest), records, cursor: result.next_cursor };
    }
    async record(principal, input) {
        const resolved = await this.refs.resolve(principal, input.record, 'record');
        const { context, activity } = await this.selected(principal, input);
        if (!activity) fail();
        const result = await this.products.record(principal, context, activity.data, resolved.key);
        if (result.record.version !== resolved.version || !scopeEqual(result.record.scope, activity.data.scope)) fail();
        const latest = await this.loadContext(principal); if (latest.revision !== context.revision) fail();
        const source = this.sourceFor(context, result.record);
        const record = await this.presentRecord(principal, context, result.record);
        const productEditor = await this.productEditor(principal, context, activity.data, source, result.record);
        return { ...this.readMetadata(context, result, latest), record, productEditor };
    }
    resourceOfferings(principal, input) { return this.sharedResourceViews.offerings(principal, input); }
    resourceOffering(principal, input) { return this.sharedResourceViews.offering(principal, input); }
    resourceProduct(principal, input) { return this.sharedResourceViews.product(principal, input); }
    resourcePreview(principal, input) { return this.sharedResourceViews.preview(principal, input); }
    async productEditor(principal, context, activity, provider, record = null) {
        if (!activity || !provider) return emptyEditor();
        const option = workspaceProductOption(context, activity, provider, record);
        if (!option) return emptyEditor();
        const choice = context.choices.providers.find(row => row.data.provider_ref === provider.provider_ref && row.data.activity_id === activity.activity_id
            && (!record || row.data.selectedInstallation === record.source.installation_id));
        if (!choice) fail();
        const fields = option.allowed_fields.filter(field => fieldNames.includes(field));
        const units = this.choiceRows(principal, context, 'units', row => (provider.policy_choices?.unit_codes || []).some(unit => unit.value === row.key));
        const prices = this.choiceRows(principal, context, 'price_choices', row => row.data.provider_ref === provider.provider_ref && row.data.activity_id === activity.activity_id);
        const draft = this.productDraftFor(principal, context, provider, fields, record?.data || {});
        return { provider: this.issue(principal, context, 'providers', choice), sourceLabel: provider.label, mode: record ? 'change' : 'create',
            recordLabel: record?.data.name, fields: fields.map(key => ({ key, label: fieldLabels[key], enabled: key !== 'media', required: !record && key === 'name', clearable: key !== 'name' })),
            units, priceChoices: prices, mediaChoices: [], draft };
    }
    productDraftFor(principal, context, provider, allowedFields, data) {
        const draft = {};
        for (const field of ['name', 'description', 'sku', 'barcodes']) if (allowedFields.includes(field) && Object.hasOwn(data, field)) draft[field] = data[field];
        const unit = context.choices.units.find(row => row.key === data.base_unit
            && (provider.policy_choices?.unit_codes || []).some(option => option.value === row.key));
        if (allowedFields.includes('base_unit') && unit) draft.base_unit = this.issue(principal, context, 'units', unit);
        const price = context.choices.price_choices.find(row => row.data.provider_ref === provider.provider_ref && row.data.activity_id === provider.activity_id
            && ['unit_code', 'currency', 'price_list_id', 'channel'].every(key => row.data[key] === data.price?.[key]));
        if (allowedFields.includes('price') && price && typeof data.price?.amount === 'string') draft.price = { amount: data.price.amount, choice: this.issue(principal, context, 'price_choices', price) };
        if (allowedFields.includes('media') && Array.isArray(data.media) && data.media.length === 0) draft.media = [];
        return draft;
    }
    async resolveProductFields(principal, context, activity, provider, fields) {
        exact(fields, fieldNames);
        const normalized = {};
        for (const field of ['name', 'description', 'sku', 'barcodes']) if (Object.hasOwn(fields, field)) normalized[field] = fields[field];
        if (Object.hasOwn(fields, 'base_unit')) {
            const unit = await this.choices.resolve(principal, fields.base_unit, 'units');
            if (unit.context.revision !== context.revision || !(provider.policy_choices?.unit_codes || []).some(row => row.value === unit.option.key)) fail();
            normalized.base_unit = unit.option.key;
        }
        if (Object.hasOwn(fields, 'price')) {
            exact(fields.price, ['amount', 'choice']);
            const price = await this.choices.resolve(principal, fields.price.choice, 'price_choices');
            if (price.context.revision !== context.revision || price.option.data.provider_ref !== provider.provider_ref || price.option.data.activity_id !== activity.activity_id) fail();
            const { unit_code, currency, price_list_id, channel } = price.option.data;
            normalized.price = { amount: fields.price.amount, unit_code, currency, price_list_id, channel };
        }
        if (Object.hasOwn(fields, 'media')) { if (!Array.isArray(fields.media) || fields.media.length) fail('workspace_media_choices_required', 409); normalized.media = []; }
        return normalized;
    }
    async productPayload(principal, context, activity, provider, fields, clearFields = [], record = null) {
        exact(fields, fieldNames);
        const mode = record ? 'change' : 'create';
        const descriptor = workspaceProductOption(context, activity, provider, record);
        if (!descriptor) fail('workspace_product_permission_required', 403);
        const normalized = await this.resolveProductFields(principal, context, activity, provider, fields);
        return validateWorkspaceProductPayload({ kind: 'goods', fields: normalized, clear_fields: clearFields,
            ...(record ? { entity_id: record.entity_id, expected_record_version: record.version } : {}) },
        { mode, allowedFields: descriptor.allowed_fields.filter(field => fieldNames.includes(field)) });
    }
    async reviewProduct(principal, input) {
        const { context, activity, provider } = await this.selected(principal, input);
        if (!activity || !provider || provider.data.platform !== 'catalog') fail('workspace_product_source_required', 403);
        let record = null;
        if (input.record) {
            const resolved = await this.refs.resolve(principal, input.record, 'record');
            record = (await this.products.record(principal, context, activity.data, resolved.key)).record;
            if (record.version !== resolved.version || !scopeEqual(record.scope, activity.data.scope)
                || record.source.installation_id !== provider.data.selectedInstallation) fail();
        }
        const proposed = await this.productPayload(principal, context, activity.data, provider.data, input.fields, input.clearFields || [], record);
        const preview = await this.previewProduct(principal, context, activity.data, provider.data, proposed, record);
        const payload = preview.payload;
        const summary = [{ label: 'المصدر المعتمد', value: provider.label }, { label: 'النشاط', value: activity.label },
            ...await this.productSummary(context, provider.data, payload)];
        return this.review(principal, { ...context, validUntil: preview.validUntil }, 'command_create', { activity_id: activity.key, provider_ref: provider.data.provider_ref,
            capability: 'products.write', action: record ? 'product.change' : 'product.create', payload }, summary);
    }
    async previewProduct(principal, context, activity, provider, payload, record = null) {
        const body = { activity_id: activity.activity_id, provider_ref: provider.provider_ref, capability: 'products.write',
            action: record ? 'product.change' : 'product.create', payload };
        validateNativeCommandModel('CommandPreviewRequest', body);
        const response = await this.transport.request(principal, { method: 'POST', path: `${BASE}/commands/preview`, body,
            expectedIdentity: context.identity, consumerInstallation: context.consumerInstallationId });
        validateNativeCommandModel('AdapterValidation', response.payload);
        const value = response.payload;
        if (value.capability !== body.capability || value.action !== body.action || value.valid !== true || (value.errors || []).length || !Number.isFinite(Date.parse(value.valid_until))
            || Date.parse(value.valid_until) <= this.now()) fail('workspace_product_preview_changed', 409);
        const descriptor = workspaceProductOption(context, activity, provider, record);
        if (!descriptor || !Array.isArray(value.allowed_fields)) fail('workspace_product_permission_required', 403);
        const allowedFields = descriptor.allowed_fields.filter(field => fieldNames.includes(field) && value.allowed_fields.includes(field));
        const normalized = validateWorkspaceProductPayload(value.normalized_payload, { mode: record ? 'change' : 'create', allowedFields });
        if (record && (normalized.entity_id !== record.entity_id || normalized.expected_record_version !== record.version)) fail('workspace_product_preview_changed', 409);
        const latest = await this.loadContext(principal);
        if (latest.revision !== context.revision || identityProof(latest.identity) !== identityProof(context.identity)) fail('workspace_product_preview_changed', 409);
        return { payload: normalized, validUntil: new Date(Math.min(Date.parse(context.validUntil), Date.parse(value.valid_until))).toISOString() };
    }
    async reviewAction(principal, input) {
        const { context, activity, provider } = await this.selected(principal, input);
        const business = nativeBusinessCapabilities.includes(input.capability);
        const media = input.capability === 'media.manage' && nativeMediaActions.includes(input.action);
        const ownerService = business ? this.businessOwner : this.nativeOwner;
        if (!activity || !provider || provider.data.provider_ref !== context.identity.coreAccountId || provider.data.platform !== 'wa_savana'
            || (!business && !media && (!nativeCommunicationCapabilities.includes(input.capability) || input.action !== input.capability))
            || typeof ownerService?.preview !== 'function') fail('workspace_native_action_unavailable', 403);
        const preview = await ownerService.preview(principal, { activity_ref: input.activity, capability: input.capability, action: input.action, parameters: input.parameters });
        if (preview.availability.state !== 'review_available' || !preview.resource_fingerprint || preview.resource_fingerprint !== input.parameters.resource_fingerprint) fail('workspace_native_preview_changed', 409);
        if (!text(actionLabels[input.action])) fail('workspace_native_action_unavailable', 403);
        const payload = { payload_type: 'native_action', parameters: { ...preview.normalized_parameters, resource_fingerprint: preview.resource_fingerprint } };
        validateNativeCommandModel('NativeActionPayload', payload);
        const latest = await this.loadContext(principal);
        if (latest.revision !== context.revision || identityProof(latest.identity) !== identityProof(context.identity)) fail('workspace_native_preview_changed', 409);
        return this.review(principal, context, 'command_create', { activity_id: activity.key, provider_ref: provider.data.provider_ref,
            capability: input.capability, action: input.action, payload }, [{ label: 'الإجراء', value: actionLabels[input.action] }, ...preview.summary,
            { label: 'التكلفة الحالية', value: `${preview.quote.total_credits} ${preview.quote.currency_label}` }]);
    }
    async commandRead(principal, reference) {
        const resolved = await this.refs.resolve(principal, reference, 'command');
        const context = await this.loadContext(principal);
        const { payload } = await this.transport.request(principal, { path: `${BASE}/commands/${pathId(resolved.key)}`,
            expectedIdentity: context.identity, consumerInstallation: context.consumerInstallationId });
        validateNativeCommandModel('CommandResponse', payload);
        if (payload.command_id !== resolved.key || payload.version !== resolved.version) fail();
        const activity = context.raw.activities.find(row => row.activity_id === payload.activity_id);
        if (payload.organization_id !== context.organizationId || !activity || !activity.my_actions.includes('commands.read')) fail('workspace_command_read_forbidden', 403);
        return { raw: payload, context, activity };
    }
    async productOptionForCommand(principal, context, activity, command) {
        if (command.capability !== 'products.write' || !['product.create', 'product.change'].includes(command.action)) return null;
        const provider = context.raw.providers.find(row => row.provider_ref === command.provider_ref && row.activity_id === command.activity_id);
        if (!provider || !activity) return null;
        if (command.action === 'product.change' && (!context.consumerInstallationId || !command.available_actions.includes('edit')
            || !activity.my_actions.includes('commands.request'))) return null;
        let record = null;
        if (command.action === 'product.change') {
            try { record = (await this.products.record(principal, context, activity, command.payload.entity_id)).record; }
            catch (error) {
                if (error instanceof SharedProductReadError && [403, 404, 409].includes(error.status)) return null;
                throw error;
            }
        }
        return workspaceProductOption(context, activity, provider, record);
    }
    async verifyCommandRead({ principal, identity, command, scope, context: presentation }) {
        const context = await this.loadContext(principal);
        const activity = context.raw.activities.find(row => row.activity_id === command.activity_id);
        if (!(context.identity.actorId === identity.actorId && context.identity.organizationId === identity.organizationId
            && context.identity.nativeAccountId === identity.nativeAccountId && context.identity.coreAccountId === identity.coreAccountId
            && context.identity.generation === identity.generation && activity?.my_actions.includes('commands.read') === true
            && scopeEqual(activity.scope, scope) && this.metadata(context).viewKey === presentation.viewKey)) return false;
        // The authenticated command read is the published read contract. Its
        // payload is not authorized by a separate product write option.
        const { payload } = await this.transport.request(principal, { path: `${BASE}/commands/${pathId(command.command_id)}`,
            expectedIdentity: context.identity, consumerInstallation: context.consumerInstallationId });
        validateNativeCommandModel('CommandResponse', payload);
        return hash(payload) === hash(command);
    }
    async commandApprovalReview({ principal, command, context: presentation }) {
        const context = presentation.coreContext;
        const provider = context.raw.providers.find(row => row.provider_ref === command.provider_ref && row.activity_id === command.activity_id);
        const summary = Object.hasOwn(command.payload, 'parameters') ? command.summary
            : await this.productSummary(context, provider, command.payload);
        if (!Array.isArray(summary) || !summary.length) fail('workspace_command_summary_required', 403);
        const result = await this.stableApprovalReview(principal, context, { kind: 'command', raw: command,
            operation: 'command_approve', payload: { target: command.command_id, expected_version: command.version }, summary });
        return result.review.intentKey;
    }
    async verifySourceReceipt({ principal, command, sourceResult }) {
        // This is a second actual Core read of its durable source receipt, not
        // an interpretation of a label, HTTP200 or a local cached record.
        const context = await this.loadContext(principal);
        const { payload } = await this.transport.request(principal, { path: `${BASE}/commands/${pathId(command.command_id)}`,
            expectedIdentity: context.identity, consumerInstallation: context.consumerInstallationId });
        validateNativeCommandModel('CommandResponse', payload);
        return payload.command_id === command.command_id && payload.version === command.version && payload.state === 'source_applied'
            && payload.organization_id === command.organization_id && payload.provider_ref === command.provider_ref
            && hash(payload.payload) === hash(command.payload) && hash(payload.source_result) === hash(sourceResult);
    }
    async present(principal, context, activity, raw) {
        validateNativeCommandModel('CommandResponse', raw);
        const source = context.raw.providers.find(row => row.provider_ref === raw.provider_ref && row.activity_id === raw.activity_id);
        if (!source) fail('workspace_source_labels_unavailable', 503);
        const product = await this.productOptionForCommand(principal, context, activity, raw);
        const actions = [
            ['edit', 'تعديل الطلب', 'commands.request', this.reviewCommandEdit], ['approve', 'اعتماد الطلب المراجع', 'commands.approve', this.approve],
            ['reject', 'رفض الطلب', 'commands.approve', this.reviewCommandReject], ['reconcile', 'فحص نتيجة المحاولة نفسها', 'commands.reconcile', this.reconcileCommand],
            ['dispatch', 'تنفيذ النسخة المعتمدة', 'commands.execute', this.reviewCommandDispatch], ['cancel', 'طلب إلغاء التنفيذ', 'commands.request', this.reviewCommandCancel],
        ].map(([key, label, permission, handler]) => ({ key, label, enabled: activity.my_actions.includes(permission) && (key !== 'edit' || (raw.capability === 'products.write'
                && ['product.create', 'product.change'].includes(raw.action) && product?.available === true)),
            effect: ['edit', 'reject', 'reconcile'].includes(key) ? 'read' : 'write', handler }));
        const result = await this.presentCommand({ principal, identity: context.identity, scope: activity.scope, raw, sourceLabel: source.label,
            context: { viewKey: this.metadata(context).viewKey, validUntil: context.validUntil, memberVerified: true,
                canRead: activity.my_actions.includes('commands.read'),
                allowedProductFields: fieldNames.filter(field => Object.hasOwn(raw.payload.fields || {}, field) || (raw.payload.clear_fields || []).includes(field)),
                coreContext: context },
            actionDescriptors: actions });
        if (result.command.state === 'source_applied' && result.command.source_result.confirmed === true && typeof this.result === 'function') {
            result.command.resultActions = ['json', 'csv'].map(format => ({ format, label: format === 'csv' ? 'تنزيل النتيجة بصيغة جدول' : 'تنزيل إيصال النتيجة',
                href: `/api/portal/integrations/workspace/commands/${encodeURIComponent(result.command.key)}/result?format=${format}` }));
        }
        return result;
    }
    async commands(principal, input = {}) {
        const { context, activity } = await this.selected(principal, input);
        if (!activity || !activity.data.my_actions.includes('commands.read')) return { ...this.metadata(context), commands: [] };
        const { payload } = await this.transport.request(principal, { path: `${BASE}/commands?${new URLSearchParams({ activity_id: activity.key })}`,
            expectedIdentity: context.identity, consumerInstallation: context.consumerInstallationId });
        exact(payload, ['commands']);
        if (!Array.isArray(payload.commands) || payload.commands.length > 100) fail('workspace_response_invalid', 502);
        const commands = [];
        for (const raw of payload.commands) {
            if (raw.activity_id !== activity.key) fail('workspace_response_invalid', 502);
            commands.push((await this.present(principal, context, activity.data, raw)).command);
        }
        return { ...this.metadata(context), commands };
    }
    async command(principal, { command }) {
        const { raw, context, activity } = await this.commandRead(principal, command);
        const result = await this.present(principal, context, activity, raw);
        if (result.command.actions.some(action => action.key === 'edit' && action.enabled)) {
            result.productEditor = await this.commandProductEditor(principal, context, activity, raw);
            const latest = await this.loadContext(principal);
            if (latest.revision !== context.revision || identityProof(latest.identity) !== identityProof(context.identity)) fail();
        }
        return result;
    }
    async approve(principal, { command, intent }) {
        const { raw, context, activity } = await this.commandRead(principal, command);
        if (raw.state !== 'pending_review' || !raw.available_actions.includes('approve') || !activity.my_actions.includes('commands.approve')) fail('workspace_approval_forbidden', 403);
        const review = await this.reviewedApproval(principal, context, raw, intent, 'command_approve');
        return this.submit(principal, { review });
    }
    async result(principal, { command, format = 'json' }) {
        if (!['json', 'csv'].includes(format)) fail('workspace_request_invalid', 422);
        const { raw, context, activity } = await this.commandRead(principal, command);
        const shown = await this.present(principal, context, activity, raw);
        if (shown.command.state !== 'source_applied' || shown.command.source_result.confirmed !== true) fail('workspace_command_result_unconfirmed', 403);
        const response = await this.transport.request(principal, { path: `${BASE}/commands/${pathId(raw.command_id)}/result?format=${format}`,
            representation: format, expectedIdentity: context.identity, consumerInstallation: context.consumerInstallationId });
        const latest = await this.commandRead(principal, command);
        if (latest.context.revision !== context.revision || identityProof(latest.context.identity) !== identityProof(context.identity)
            || !scopeEqual(latest.activity.scope, activity.scope) || hash(latest.raw) !== hash(raw)) fail('workspace_command_read_forbidden', 403);
        return response.payload;
    }
    async commandProductBase(principal, context, activity, raw) {
        if (raw.state !== 'pending_review' || raw.capability !== 'products.write' || !['product.create', 'product.change'].includes(raw.action)) fail('workspace_edit_forbidden', 403);
        const provider = context.raw.providers.find(row => row.provider_ref === raw.provider_ref && row.activity_id === raw.activity_id);
        if (!provider || provider.platform !== 'catalog') fail('workspace_product_permission_required', 403);
        const mode = raw.action === 'product.create' ? 'create' : 'change';
        let record = null;
        if (mode === 'change') {
            record = (await this.products.record(principal, context, activity, raw.payload.entity_id)).record;
        }
        const descriptor = workspaceProductOption(context, activity, provider, record);
        if (!descriptor) fail('workspace_product_permission_required', 403);
        const payload = validateWorkspaceProductPayload(raw.payload, { mode, allowedFields: descriptor.allowed_fields.filter(field => fieldNames.includes(field)) });
        if (mode === 'change') {
            if (!record || record.entity_id !== payload.entity_id || record.version !== payload.expected_record_version
                || !scopeEqual(record.scope, activity.scope) || this.sourceFor(context, record).provider_ref !== provider.provider_ref
                || record.state !== 'active' || record.freshness !== 'current') fail('workspace_product_base_changed', 409);
        }
        return { provider, descriptor, payload, record, mode };
    }
    async commandProductEditor(principal, context, activity, raw) {
        const { provider, descriptor, payload, record } = await this.commandProductBase(principal, context, activity, raw);
        const editor = await this.productEditor(principal, context, activity, provider, record);
        const data = { ...(record?.data || {}), ...payload.fields };
        for (const field of payload.clear_fields) delete data[field];
        return { ...editor, mode: 'change', recordLabel: data.name || record?.data.name || 'طلب منتج',
            fields: editor.fields.map(field => ({ ...field, required: false })),
            draft: this.productDraftFor(principal, context, provider, descriptor.allowed_fields, data) };
    }
    async reconcileCommand(principal, { command }) {
        const { raw, context, activity } = await this.commandRead(principal, command);
        if (!raw.available_actions.includes('reconcile') || !activity.my_actions.includes('commands.reconcile')) fail('workspace_reconcile_forbidden', 403);
        const result = await this.review(principal, context, 'command_reconcile', { target: raw.command_id, expected_version: raw.version },
            [{ label: 'الإجراء', value: 'فحص نتيجة المحاولة نفسها دون إرسال جديد' }], {}, raw);
        return this.submit(principal, { review: result.review.key });
    }
    async reviewCommandReject(principal, { command, reason }) {
        const { raw, context, activity } = await this.commandRead(principal, command);
        if (!raw.available_actions.includes('reject') || !activity.my_actions.includes('commands.approve') || !text(reason, 1000)) fail('workspace_approval_forbidden', 403);
        return this.review(principal, context, 'command_reject', { target: raw.command_id, expected_version: raw.version, reason },
            [{ label: 'الإجراء', value: 'رفض طلب تغيير المصدر' }, { label: 'السبب', value: reason }], {}, raw);
    }
    async reviewCommandDispatch(principal, { command }) {
        const { raw, context, activity } = await this.commandRead(principal, command);
        if (raw.state !== 'approved' || !raw.available_actions.includes('dispatch') || !activity.my_actions.includes('commands.execute')) fail('workspace_dispatch_forbidden', 403);
        const shown = await this.present(principal, context, activity, raw);
        if (!shown.command.actions.some(row => row.key === 'dispatch' && row.enabled)) fail('workspace_command_summary_required', 403);
        return this.review(principal, context, 'command_dispatch', { target: raw.command_id, expected_version: raw.version },
            [{ label: 'الإجراء', value: 'تنفيذ النسخة التي سبق اعتمادها وفق الأذونات الحالية' }, ...shown.command.summary], {}, raw);
    }
    async reviewCommandCancel(principal, { command, reason }) {
        const { raw, context, activity } = await this.commandRead(principal, command);
        if (!raw.available_actions.includes('cancel') || !['pending_review', 'approved', 'source_pending'].includes(raw.state)
            || raw.requested_by !== context.actorId || !activity.my_actions.includes('commands.request')
            || (raw.state === 'source_pending' && !activity.my_actions.includes('commands.reconcile')) || !text(reason, 1000)) fail('workspace_cancel_forbidden', 403);
        return this.review(principal, context, 'command_cancel', { target: raw.command_id, expected_version: raw.version, reason },
            [{ label: 'الإجراء', value: 'طلب إلغاء التنفيذ؛ يُعرض الإلغاء المؤكد فقط بعد تحقق المصدر من عدم التنفيذ' }, { label: 'السبب', value: reason }], {}, raw);
    }
    async reviewCommandEdit(principal, { command, fields, clearFields = [] }) {
        const { raw, context, activity } = await this.commandRead(principal, command);
        if (!raw.available_actions.includes('edit') || raw.requested_by !== context.actorId || !activity.my_actions.includes('commands.request')) fail('workspace_edit_forbidden', 403);
        const { provider, descriptor, payload: previous, mode } = await this.commandProductBase(principal, context, activity, raw);
        exact(fields, fieldNames);
        if (!Array.isArray(clearFields) || new Set(clearFields).size !== clearFields.length
            || clearFields.some(field => field === 'name' || !fieldNames.includes(field) || Object.hasOwn(fields, field))
            || Object.keys(fields).length + clearFields.length === 0) fail('workspace_product_invalid', 422);
        const patch = await this.resolveProductFields(principal, context, activity, provider, fields);
        const merged = { ...previous.fields, ...patch };
        const clears = new Set(previous.clear_fields);
        for (const field of Object.keys(patch)) clears.delete(field);
        for (const field of clearFields) { delete merged[field]; if (mode === 'change') clears.add(field); else clears.delete(field); }
        const proposed = validateWorkspaceProductPayload({ ...previous, fields: merged, clear_fields: [...clears] },
            { mode, allowedFields: descriptor.allowed_fields.filter(field => fieldNames.includes(field)) });
        const preview = await this.previewProduct(principal, context, activity, provider, proposed,
            mode === 'change' ? (await this.products.record(principal, context, activity, previous.entity_id)).record : null);
        const payload = preview.payload;
        const summary = [{ label: 'الإجراء', value: 'تعديل الطلب الحالي؛ يحتاج المحتوى المعدل إلى اعتماد جديد' }, { label: 'المصدر المعتمد', value: provider.label },
            ...((await this.productSummary(context, provider, previous)).map(row => ({ label: `قبل التعديل: ${row.label}`, value: row.value }))),
            ...((await this.productSummary(context, provider, payload)).map(row => ({ label: `بعد التعديل: ${row.label}`, value: row.value }))),
            ...(mode === 'create' ? clearFields.map(field => ({ label: fieldLabels[field], value: 'إزالة هذا الحقل من بيانات الإنشاء المقترحة' })) : [])];
        const latest = await this.loadContext(principal);
        if (latest.revision !== context.revision || identityProof(latest.identity) !== identityProof(context.identity)) fail();
        // The replacement contains the full current pending proposal, rather
        // than just the changed input fields or a new base-record snapshot.
        return this.review(principal, { ...context, validUntil: preview.validUntil }, 'command_edit', { target: raw.command_id, expected_version: raw.version, payload }, summary, {}, raw);
    }
    async verifyOwnerContext({ principal, activityRef, action, capabilityId, resourceSelection }) {
        const { option, context } = await this.choices.resolve(principal, activityRef, 'activities');
        const activity = option.data;
        await this.proofs.capture(principal);
        const currentIdentity = await this.transport.currentIdentity(principal);
        if (identityProof(currentIdentity) !== identityProof(context.identity)) fail('workspace_context_changed', 403);
        const own = context.raw.providers.find(row => row.provider_ref === context.identity.coreAccountId && row.activity_id === option.key && row.platform === 'wa_savana');
        if (!own) fail('workspace_native_permission_required', 403);
        const grants = activity.capability_grants.filter(row => row.person_ref === context.actorId && row.provider_ref === own.provider_ref && Date.parse(row.expires_at) > this.now());
        const uniqueGrant = (capability, permission, predicate = () => true) => {
            const matches = grants.filter(row => row.capability_code === capability && row.actions.includes(permission) && predicate(row));
            const distinct = [...new Map(matches.map(row => [hash(row), row])).values()];
            if (distinct.length !== 1) fail(distinct.length ? 'workspace_native_grant_selection_required' : 'workspace_native_permission_required', 403);
            return distinct[0];
        };
        const consent = typeof action === 'string' && /(?:^|[._])consents?(?:[._]|$)/.test(action);
        const consentFields = ['consent.purpose', 'consent.evidence', 'consent.valid_until'];
        const consentGrant = row => consentFields.every(field => row.allowed_fields.includes(field)) && row.resource_policy !== 'new_only';
        const consentSelection = row => row.resource_policy === 'activity' || (row.resource_policy === 'selected'
            && row.resource_refs.includes(resourceSelection?.accountRef) && row.resource_refs.includes(resourceSelection?.recipientRef));
        const concreteConsent = ['consent.record', 'consent.read', 'consent.lookup', 'consent.revoke'].includes(action);
        const business = nativeBusinessCapabilities.includes(capabilityId) || capabilityId === 'media.manage';
        let grant = null;
        if (consent) {
            if (concreteConsent && (!text(resourceSelection?.accountRef) || !text(resourceSelection?.recipientRef))) fail('workspace_native_resource_scope_required', 403);
            grant = uniqueGrant('customers.manage', 'execute', row => consentGrant(row) && (!concreteConsent || consentSelection(row)));
        }
        else {
            if (!activity.my_actions.includes('commands.request')) fail('workspace_native_permission_required', 403);
            if (business) {
                if (action !== capabilityId) fail('workspace_native_permission_required', 403);
                grant = uniqueGrant(capabilityId, 'request');
            } else if (capabilityId) {
                if (!nativeCommunicationCapabilities.includes(capabilityId)) fail('workspace_native_permission_required', 403);
                grant = uniqueGrant(capabilityId, 'request');
            } else if (!grants.some(row => nativeCommunicationCapabilities.includes(row.capability_code) && row.actions.includes('request'))) {
                fail('workspace_native_permission_required', 403);
            }
        }
        const manage = grants.filter(row => row.capability_code === 'customers.manage' && row.actions.includes('execute') && consentGrant(row));
        const canManageConsent = consent ? true : manage.length > 0;
        return { verified: true, localPolicyVerified: true, nativeTenantId: principal.tenantId, nativeUserId: principal.userId,
            viewer: { scope: activity.scope, actorId: context.actorId,
                validUntil: new Date(Math.min(Date.parse(context.validUntil), ...(grant ? [Date.parse(grant.expires_at)] : []))).toISOString(),
                ...(grant ? { allowedFields: [...grant.allowed_fields], resourcePolicy: grant.resource_policy, resourceRefs: [...grant.resource_refs] } : {}) },
            canManageConsent };
    }
    async resolveNativeNamespace(input) {
        const partialScope = input.validationOnly === true;
        if (partialScope && (input.scope.branch_id != null || input.scope.warehouse_id != null)) fail('native_namespace_changed', 403);
        const receipt = this.receipts.nativeNamespace({ nativeTenantId: input.nativeTenantId,
            organizationId: input.scope.organization_id, installationId: input.namespaceInstallationId });
        if (!receipt) fail('native_namespace_receipt_required', 403);
        const url = new URL(`/v1/integration/operational/namespaces/${pathId(receipt.namespace_id)}`, this.setup.config.centerOrigin);
        const response = await this.fetch(url.href, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(5000),
            headers: { 'X-Savana-Platform-Code': 'wa_savana', 'X-Savana-Platform-Token': this.setup.config.platformToken } });
        if (!response.ok || Number(response.headers.get('content-length')) > 65_536) fail('native_namespace_unavailable', 403);
        const reader = response.body?.getReader(); if (!reader) fail('native_namespace_unavailable', 403);
        const chunks = []; let size = 0;
        try {
            while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength;
                if (size > 65_536) { await reader.cancel(); fail('native_namespace_unavailable', 403); } chunks.push(Buffer.from(next.value)); }
        } finally { reader.releaseLock(); }
        let payload; try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('native_namespace_unavailable', 403); }
        const value = decodeWorkspaceNamespace(payload, { organizationId: input.scope.organization_id },
            { ...(partialScope ? {} : { scope: input.scope }), providerRef: input.providerRef, externalTenantId: `wa_savana:tenant:${input.nativeTenantId}` });
        if (value.scope.activity_id !== input.scope.activity_id) fail('native_namespace_changed', 403);
        if (value.namespace_id !== receipt.namespace_id || value.source_installation_id !== input.namespaceInstallationId) fail('native_namespace_changed', 403);
        return value;
    }
}
