import { SharedProductReadError } from './centralProductRead.js';
import { validateNativeCommandModel } from './nativeCommandModels.js';
import { nativeCommandJson } from './nativeCommandProtocol.js';

const fail = (code, status = 403) => { throw new SharedProductReadError(code, status); };
const text = (value, max = 255) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const productFields = ['name', 'description', 'sku', 'barcodes', 'base_unit', 'price', 'media'];
const nativeReceiptActions = new Set(['messaging.send', 'campaigns.execute', 'content.publish', 'measurement.summary', 'measurement.export', 'owner.operation_status']);
const commandActions = new Set(['edit', 'approve', 'reject', 'reconcile', 'dispatch', 'cancel']);
const lifecycle = {
    edit: ['pending_review'], approve: ['pending_review'], reject: ['pending_review'],
    dispatch: ['approved'], cancel: ['pending_review', 'approved', 'source_pending'],
    reconcile: ['dispatching', 'outcome_unknown', 'source_pending', 'cancel_requested', 'source_applied', 'source_partially_applied'],
};
const opaqueLabel = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    || /^[0-9a-f]{64}$/i.test(value) || /^wr1\.[A-Za-z0-9_-]+$/.test(value);
const human = (value, max = 8000) => text(value, max) && !opaqueLabel(value.trim());
const say = (ar, arabic, english) => ar ? arabic : english;
const fieldLabel = (field, ar) => ({ name: say(ar, 'اسم المنتج', 'Product name'), description: say(ar, 'الوصف', 'Description'),
    sku: say(ar, 'رمز المنتج', 'Product code'), barcodes: say(ar, 'الباركود', 'Barcodes'), base_unit: say(ar, 'وحدة المنتج', 'Product unit'),
    price: say(ar, 'السعر', 'Price'), media: say(ar, 'صور المنتج', 'Product images') }[field]);
const nativeLabel = (action, ar) => ({ 'messaging.send': say(ar, 'طلب إرسال رسالة', 'Message request'),
    'campaigns.execute': say(ar, 'طلب تنفيذ حملة', 'Campaign request'), 'content.publish': say(ar, 'طلب نشر محتوى', 'Content publication request'),
    'media.asset.upload': say(ar, 'طلب رفع ملف إلى WhatsApp', 'WhatsApp media upload request'),
    'media.asset.inspect': say(ar, 'فحص ملف WhatsApp المرفوع', 'Inspect uploaded WhatsApp media') }[action]);
const publicReason = (value, fallback) => human(value, 2000) ? value.trim() : fallback;
const principalStamp = principal => nativeCommandJson([principal?.tenantId ?? null, principal?.userId ?? null,
    principal?.sessionId ?? null, principal?.authVersion ?? null, principal?.sessionExpiresAt ?? null, principal?.role ?? null, principal?.issuedAt ?? null]);
const identityStamp = identity => nativeCommandJson([identity?.actorId ?? null, identity?.organizationId ?? null,
    identity?.nativeAccountId ?? null, identity?.coreAccountId ?? null, identity?.generation ?? null, identity?.expiresAt ?? null]);
const receiptRefs = raw => {
    const values = [raw.command_id, raw.organization_id, raw.activity_id, raw.provider_ref, raw.requested_by, raw.reviewed_by,
        raw.payload.entity_id, raw.payload.resource_ref, ...(raw.payload.resource_refs || []), raw.payload.fields?.base_unit,
        raw.payload.fields?.price?.unit_code, raw.payload.fields?.price?.price_list_id, raw.payload.fields?.price?.channel];
    const visit = value => {
        if (!value || typeof value !== 'object') return;
        for (const [key, item] of Object.entries(value)) {
            if (typeof item === 'string' && (/(?:_ref|_id)$/.test(key) || key === 'resource_fingerprint')) values.push(item);
            else if (item && typeof item === 'object') visit(item);
        }
    };
    visit(raw.payload.parameters);
    visit(raw.payload.fields?.media);
    for (const media of raw.payload.fields?.media || []) values.push(media.access_reference, media.rights_reference);
    return values.filter(value => typeof value === 'string' && value.length > 0);
};
const revealsReference = (value, references) => references.some(ref => value === ref || (ref.length >= 8 && value.includes(ref)));
const isHumanSummary = (summary, { native, references }) => Array.isArray(summary) && summary.length > 0 && summary.length <= 100
    && summary.every(row => row && typeof row === 'object' && !Array.isArray(row)
        && Object.keys(row).every(key => ['label', 'value'].includes(key)) && human(row.label, 255)
        && !revealsReference(row.label, references) && text(row.value, 8000)
        && (!native || (human(row.value) && !revealsReference(row.value, references)
            && !(() => { try { const value = JSON.parse(row.value); return value && typeof value === 'object'; } catch { return false; } })())));

// WA-internal presentation only. Every callback is supplied by the real BFF;
// browser selectors, role names, command state and display text grant nothing.
export const createWorkspaceCommandPresenter = ({ refs, issueIntentRef = null, verifyCurrent, summarizeNative = null,
    formatProductField = null, verifySourceReceipt = null, now = () => Date.now() }) => {
    if (typeof refs?.issue !== 'function' || typeof verifyCurrent !== 'function' || typeof now !== 'function'
        || [issueIntentRef, summarizeNative, formatProductField, verifySourceReceipt].some(value => value !== null && typeof value !== 'function')) {
        throw new TypeError('Command presentation requires actual references and a current scoped read verifier');
    }
    return async function present({ principal, identity, scope, context, raw, sourceLabel, summary,
        actionDescriptors = [], language = 'ar' }) {
        const ar = language === 'ar';
        try { validateNativeCommandModel('CommandResponse', raw); }
        catch { fail('workspace_command_response_invalid', 502); }
        if (!text(raw.command_id) || !text(raw.organization_id) || !text(raw.activity_id) || !text(raw.provider_ref)
            || !text(raw.requested_by) || !Number.isSafeInteger(raw.version) || raw.version < 1) fail('workspace_command_response_invalid', 502);
        if (!human(sourceLabel, 255) || revealsReference(sourceLabel, receiptRefs(raw))) {
            fail('workspace_command_labels_unavailable', 503);
        }
        if (!Array.isArray(actionDescriptors) || actionDescriptors.some(action => !action || !text(action.key)
            || !human(action.label, 255) || typeof action.enabled !== 'boolean'
            || !['read', 'write'].includes(action.effect)) || new Set(actionDescriptors.map(action => action.key)).size !== actionDescriptors.length) {
            fail('workspace_command_actions_invalid', 503);
        }
        const descriptors = actionDescriptors.map(action => ({ ...action }));
        const native = Object.hasOwn(raw.payload, 'parameters');
        let snapshots;
        try { snapshots = { principal: principalStamp(principal), identity: identityStamp(identity), scope: nativeCommandJson(scope),
            context: nativeCommandJson(context), command: nativeCommandJson(raw) }; }
        catch { fail('workspace_command_read_forbidden'); }
        const argumentsFor = () => ({ principal, identity, scope, context, command: raw });
        const assertSnapshot = () => {
            if (snapshots.principal !== principalStamp(principal) || snapshots.identity !== identityStamp(identity)
                || snapshots.scope !== nativeCommandJson(scope) || snapshots.context !== nativeCommandJson(context)
                || snapshots.command !== nativeCommandJson(raw)) fail('workspace_command_context_changed');
            if (context?.memberVerified !== true || context.canRead !== true || !text(context.viewKey, 1024)
                || !Number.isFinite(Date.parse(context.validUntil)) || Date.parse(context.validUntil) <= now()
                || !text(identity?.actorId) || !text(identity.organizationId) || !text(identity.nativeAccountId)
                || !text(identity.generation) || !Number.isFinite(Date.parse(identity.expiresAt)) || Date.parse(identity.expiresAt) <= now()
                || !Number.isSafeInteger(principal?.sessionExpiresAt) || principal.sessionExpiresAt * 1000 <= now()
                || scope?.organization_id !== identity.organizationId || raw.organization_id !== identity.organizationId
                || scope?.activity_id !== raw.activity_id || !text(scope.activity_id)
                || (scope.warehouse_id != null && scope.branch_id == null)
                || !Array.isArray(context.allowedProductFields) || context.allowedProductFields.some(field => !productFields.includes(field))
                || new Set(context.allowedProductFields).size !== context.allowedProductFields.length) fail('workspace_command_read_forbidden');
            if (!native && [...Object.keys(raw.payload.fields || {}), ...(raw.payload.clear_fields || [])]
                .some(field => !context.allowedProductFields.includes(field))) fail('workspace_command_read_forbidden');
        };
        const current = async () => {
            assertSnapshot();
            let verified = false;
            try { verified = await verifyCurrent(argumentsFor()); } catch { fail('workspace_command_read_forbidden'); }
            assertSnapshot();
            if (verified !== true) fail('workspace_command_read_forbidden');
        };
        await current();
        const references = receiptRefs(raw);
        let shownSummary = [];
        let summaryComplete = false;
        const providedSummary = summary === undefined && native ? raw.summary : summary;
        if (providedSummary !== undefined && isHumanSummary(providedSummary, { native, references })) {
            shownSummary = providedSummary.map(row => ({ label: row.label, value: row.value })); summaryComplete = true;
        } else if (native && summarizeNative) {
            let resolved;
            try { resolved = await summarizeNative(argumentsFor()); }
            catch (error) { if ([401, 403].includes(error?.status || error?.statusCode)) fail('workspace_command_read_forbidden'); }
            await current();
            if (isHumanSummary(resolved, { native, references })) { shownSummary = resolved.map(row => ({ label: row.label, value: row.value })); summaryComplete = true; }
        } else if (!native) {
            summaryComplete = true;
            for (const field of productFields) {
                if (!Object.hasOwn(raw.payload.fields || {}, field)) continue;
                const value = raw.payload.fields[field]; let display = null;
                if (['name', 'description', 'sku'].includes(field) && typeof value === 'string') display = value.trim() ? value : say(ar, 'نص فارغ', 'Empty text');
                else if (field === 'barcodes' && Array.isArray(value)) display = value.length ? value.join(ar ? '، ' : ', ') : say(ar, 'بدون باركود', 'No barcodes');
                else if (field === 'media' && Array.isArray(value) && value.length === 0) display = say(ar, 'بدون صور', 'No images');
                else if (formatProductField) {
                    try { display = await formatProductField({ ...argumentsFor(), field, value, language }); }
                    catch (error) { if ([401, 403].includes(error?.status || error?.statusCode)) fail('workspace_command_read_forbidden'); }
                    await current();
                    if (!human(display) || revealsReference(display, references)) display = null;
                }
                if (!text(display, 8000)) { summaryComplete = false; continue; }
                shownSummary.push({ label: fieldLabel(field, ar), value: display });
            }
            for (const field of raw.payload.clear_fields || []) shownSummary.push({ label: fieldLabel(field, ar), value: say(ar, 'مسح القيمة من المصدر', 'Clear the value at source') });
            if (!shownSummary.length) summaryComplete = false;
        }
        await current();
        let receiptConfirmed = false;
        const receipt = raw.source_result;
        const revisionValid = nativeReceiptActions.has(raw.action) && native
            ? receipt?.source_revision == null || (Number.isSafeInteger(receipt.source_revision) && receipt.source_revision >= 0)
            : Number.isSafeInteger(receipt?.source_revision) && receipt.source_revision > 0;
        if (raw.state === 'source_applied' && receipt && text(receipt.local_entity_id) && text(receipt.result_reference, 1000)
            && revisionValid && verifySourceReceipt) {
            try { receiptConfirmed = await verifySourceReceipt({ ...argumentsFor(), sourceResult: receipt }) === true; }
            catch (error) { if ([401, 403].includes(error?.status || error?.statusCode)) fail('workspace_command_read_forbidden'); }
            await current();
        }
        let key;
        try { key = refs.issue(principal, identity, { type: 'command', key: raw.command_id, version: raw.version }); }
        catch { fail('workspace_command_reference_unavailable', 503); }
        if (!text(key, 65_536) || key === raw.command_id) fail('workspace_command_reference_unavailable', 503);
        const actions = [];
        for (const descriptor of descriptors) {
            if (!commandActions.has(descriptor.key)) continue;
            let enabled = descriptor.enabled === true;
            let reason = descriptor.reason;
            if (!raw.available_actions.includes(descriptor.key)) { enabled = false; reason = say(ar, 'لا يتيح المركز هذا الإجراء لهذا الطلب حاليًا.', 'The center does not currently allow this action for this request.'); }
            else if (!lifecycle[descriptor.key].includes(raw.state)
                || (['edit', 'cancel'].includes(descriptor.key) && raw.requested_by !== identity.actorId)) {
                enabled = false; reason = say(ar, 'لا يتوفر هذا الإجراء في المرحلة الحالية لهذا الطلب.', 'This action is unavailable at the current stage of this request.');
            } else if (typeof descriptor.handler !== 'function') { enabled = false; reason = say(ar, 'هذا الإجراء غير متاح من الواجهة الحالية بعد.', 'This action is not yet available through this interface.'); }
            else if (['approve', 'dispatch'].includes(descriptor.key) && !summaryComplete) { enabled = false; reason = say(ar, 'يلزم ملخص مراجعة متحقق بأسماء الموارد والتغييرات قبل الاعتماد أو التنفيذ.', 'A verified review summary naming the resources and changes is required before approval or execution.'); }
            else if (descriptor.key === 'approve' && !issueIntentRef) { enabled = false; reason = say(ar, 'لم يتوفر مرجع مراجعة حالي؛ حدّث حالة الطلب.', 'A current review reference is unavailable; refresh the request status.'); }
            const action = { key: descriptor.key, label: descriptor.label, effect: descriptor.effect, enabled };
            if (!enabled) action.reason = publicReason(reason, say(ar, 'هذا الإجراء غير متاح ضمن الصلاحية الحالية.', 'This action is unavailable with the current permission.'));
            if (enabled && descriptor.key === 'approve') {
                let intentKey;
                try { intentKey = await issueIntentRef({ ...argumentsFor(), action: 'approve', commandKey: key }); }
                catch { fail('workspace_command_intent_unavailable', 503); }
                await current();
                if (!text(intentKey, 65_536) || [raw.command_id, raw.approval_fingerprint].includes(intentKey)) fail('workspace_command_intent_unavailable', 503);
                action.intentKey = intentKey;
            }
            actions.push(action);
        }
        await current();
        const validUntil = new Date(Math.min(Date.parse(context.validUntil), Date.parse(identity.expiresAt), principal.sessionExpiresAt * 1000)).toISOString();
        const label = human(raw.action_label, 255) && !revealsReference(raw.action_label, references) ? raw.action_label
            : native ? nativeLabel(raw.action, ar) || say(ar, 'طلب إجراء بالمصدر', 'Source operation request')
                : human(raw.payload.fields?.name, 200) ? raw.payload.fields.name : say(ar, 'طلب تغيير منتج', 'Product change request');
        return { viewKey: context.viewKey, valid_until: validUntil, command: { key, label, action: raw.action, sourceLabel: sourceLabel.trim(),
            state: raw.state, source_result: { confirmed: receiptConfirmed, source_revision: receipt?.source_revision ?? null },
            projection_state: raw.projection_state, summary: shownSummary, actions, updated_at: raw.updated_at,
            ...(raw.native_progress ? { progress: { ...raw.native_progress } } : {}),
            ...(raw.native_pending ? { pending: { accepted_at: raw.native_pending.accepted_at,
                scheduled_for: raw.native_pending.scheduled_for ?? null } } : {}),
            ...(human(raw.reason_message, 2000) && !revealsReference(raw.reason_message, references) ? { message: raw.reason_message } : {}) } };
    };
};
