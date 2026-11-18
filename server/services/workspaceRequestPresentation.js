import crypto from 'node:crypto';
import { SharedProductReadError } from './centralProductRead.js';
import { canonicalWorkspaceJson } from './workspaceIntents.js';
import { decodeWorkspaceRequest } from './workspaceCoreResponses.js';

const fail = (code = 'workspace_request_read_forbidden', status = 403) => { throw new SharedProductReadError(code, status); };
const hash = value => crypto.createHash('sha256').update(canonicalWorkspaceJson(value)).digest('hex');
const text = value => typeof value === 'string' && value.trim().length > 0;
const named = value => text(value) && value.length <= 1000 && !/^(?:[a-f0-9]{64}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}|wr1\.[A-Za-z0-9_-]+)$/i.test(value.trim());
const scopeEqual = (a, b) => ['organization_id', 'activity_id', 'branch_id', 'warehouse_id'].every(key => (a?.[key] ?? null) === (b?.[key] ?? null));
const names = { read_sharing: 'مشاركة قراءة المنتجات', consumer_registration: 'تسجيل حساب قراءة المنتجات',
    source_registration: 'تسجيل مصدر المنتجات', native_origin: 'تسجيل مرجع المنتج الأصلي' };
const sameVersionedInput = (principal, context, activity) => hash({ principal, context, activity });
const currentOption = (context, kind, key) => {
    const matches = context.choices?.[kind]?.filter(row => row.key === key && row.selectable === true && named(row.label)) || [];
    return matches.length === 1 ? matches[0] : null;
};

// The BFF passes actual current Core context and callable reference/review
// issuers. Display names and scope actions are never reconstructed from roles.
export const presentWorkspaceRequest = async ({ principal, context, activity, raw: input, refs, issueChoice, issueReview,
    verifyCurrent, now = () => Date.now() }) => {
    if (typeof refs?.issue !== 'function' || [issueChoice, issueReview, verifyCurrent, now].some(value => typeof value !== 'function')) {
        throw new TypeError('Request presentation requires current Core proof and actual opaque review issuers');
    }
    let raw;
    try { raw = decodeWorkspaceRequest(input, context?.identity, { scope: activity?.scope }); }
    catch { fail('workspace_request_response_invalid', 502); }
    let stamp;
    try { stamp = sameVersionedInput(principal, context, activity); }
    catch { fail(); }
    const assertCurrent = async () => {
        if (stamp !== sameVersionedInput(principal, context, activity) || !context?.identity
            || context.identity.actorId !== context.actorId || context.identity.organizationId !== raw.organization_id
            || context.identity.nativeAccountId !== context.nativeAccountId || !text(context.identity.generation)
            || !text(context.identity.nativeAccountId) || !named(activity?.label) || !Array.isArray(activity.my_actions)
            || activity.activity_id !== raw.scope.activity_id || !scopeEqual(activity.scope, raw.scope)
            || !Number.isFinite(Date.parse(context.validUntil)) || Date.parse(context.validUntil) <= now()
            || !Number.isFinite(Date.parse(context.identity.expiresAt)) || Date.parse(context.identity.expiresAt) <= now()
            || !Number.isSafeInteger(principal?.sessionExpiresAt) || principal.sessionExpiresAt * 1000 <= now()) fail();
        let verified = false;
        try { verified = await verifyCurrent({ principal, context, activity, request: raw }); } catch { fail(); }
        if (verified !== true || stamp !== sameVersionedInput(principal, context, activity)
            || Date.parse(context.validUntil) <= now() || Date.parse(context.identity.expiresAt) <= now()
            || principal.sessionExpiresAt * 1000 <= now()) fail();
    };
    await assertCurrent();
    const identity = context.identity;
    const reference = (type, key, version) => {
        let value;
        try { value = refs.issue(principal, identity, { type, key, version }); } catch { fail('workspace_request_reference_unavailable', 503); }
        if (!text(value) || value === key) fail('workspace_request_reference_unavailable', 503);
        return value;
    };
    const installation = id => {
        const matches = (context.raw.providers || []).flatMap(provider => provider.activity_id === activity.activity_id
            ? (provider.installations || []).filter(row => row.installation_id === id && row.activity_id === activity.activity_id)
                .map(row => ({ provider, label: named(provider.label) && named(row.label) ? `${provider.label} — ${row.label}` : null })) : []);
        return matches.length === 1 && named(matches[0].label) ? matches[0] : null;
    };
    const enrollment = id => {
        const matches = (context.raw.providers || []).filter(provider => provider.activity_id === activity.activity_id
            && provider.enrollment_id === id && named(provider.label));
        return matches.length === 1 ? matches[0] : null;
    };
    const optionsFor = (kind, keys) => keys.map(key => currentOption(context, kind, key));
    const labelsFor = (kind, keys) => {
        const options = optionsFor(kind, keys);
        return { complete: options.every(Boolean), values: options.filter(Boolean).map(row => row.label) };
    };
    const describe = proposal => {
        const summary = [{ label: 'الغرض', value: names[raw.kind] }, { label: 'النشاط', value: activity.label }];
        let complete = true;
        const add = (label, value, fallback) => { if (!named(value)) complete = false; summary.push({ label, value: named(value) ? value : fallback }); };
        if (raw.kind === 'read_sharing') {
            add('مصدر البيانات', installation(proposal.source_installation_id)?.label, 'اسم مصدر البيانات يحتاج تحققًا');
            add('الحساب الذي يقرأ البيانات', installation(proposal.consumer_installation_id)?.label, 'اسم حساب القراءة يحتاج تحققًا');
            for (const [kind, keys, label, missing] of [['fields', proposal.fields, 'البيانات', 'لم تُتحقق أسماء جميع الحقول'],
                ['people', proposal.reader_account_ids, 'الأشخاص', 'لم تُتحقق أسماء جميع الأشخاص']]) {
                const resolved = labelsFor(kind, keys); complete &&= resolved.complete;
                summary.push({ label, value: resolved.complete ? resolved.values.join('، ') : missing });
            }
            summary.push({ label: 'صالح حتى', value: proposal.expires_at });
        } else if (raw.kind === 'consumer_registration') {
            const provider = enrollment(proposal.enrollment_id);
            add('الخدمة', provider?.label, 'اسم الخدمة يحتاج تحققًا');
            add('اسم حساب القراءة', proposal.installation_label, 'اسم حساب القراءة يحتاج تحققًا');
            if (!provider || provider.enrollment_version !== proposal.enrollment_version) complete = false;
        } else {
            // Other policy families remain visible without native mutation
            // controls until this BFF has their full typed owner forms.
            complete = false;
        }
        return { summary, complete };
    };
    const proposed = describe(raw.proposal);
    let effectiveSummary = null;
    let effectiveComplete = true;
    if (raw.effective_resource) {
        const effective = raw.kind === 'read_sharing' ? describe(raw.effective_resource) : null;
        effectiveComplete = effective?.complete ?? true;
        effectiveSummary = raw.kind === 'read_sharing' ? effective.summary
            : raw.kind === 'consumer_registration' ? [{ label: 'الحالة النافذة', value: 'حساب القراءة مسجل؛ صلاحية البيانات تُعتمد بصورة مستقلة' }]
                : [{ label: 'الحالة النافذة', value: 'توجد موافقة سابقة؛ تفاصيلها الكاملة غير متاحة في هذا المسار' }];
    }
    const choices = {};
    choices.activities = currentOption(context, 'activities', activity.activity_id);
    choices.purposes = currentOption(context, 'purposes', raw.kind);
    const source = raw.kind === 'read_sharing' ? installation(raw.proposal.source_installation_id)?.provider
        : raw.kind === 'consumer_registration' ? enrollment(raw.proposal.enrollment_id) : null;
    const providers = (context.choices?.providers || []).filter(row => row.selectable === true && named(row.label)
        && row.data?.activity_id === activity.activity_id && row.data.provider_ref === source?.provider_ref
        && (raw.kind !== 'read_sharing' || row.data.selectedInstallation === raw.proposal.source_installation_id));
    choices.providers = providers.length === 1 ? providers[0] : null;
    const fieldOptions = raw.kind === 'read_sharing' ? optionsFor('fields', raw.proposal.fields) : [];
    const peopleOptions = raw.kind === 'read_sharing' ? optionsFor('people', raw.proposal.reader_account_ids) : [];
    let selection = null;
    if (['read_sharing', 'consumer_registration'].includes(raw.kind) && Object.values(choices).every(Boolean)
        && fieldOptions.every(Boolean) && peopleOptions.every(Boolean)) {
        const issue = (kind, option) => {
            let value;
            try { value = issueChoice(kind, option); } catch { fail('workspace_request_reference_unavailable', 503); }
            if (!text(value) || value === option.key) fail('workspace_request_reference_unavailable', 503);
            return value;
        };
        selection = { activity: issue('activities', choices.activities), purpose: issue('purposes', choices.purposes),
            provider: issue('providers', choices.providers), fields: fieldOptions.map(option => issue('fields', option)),
            people: peopleOptions.map(option => issue('people', option)) };
    }
    const removedFields = raw.kind === 'read_sharing' && raw.effective_resource
        ? labelsFor('fields', raw.effective_resource.fields.filter(field => !raw.proposal.fields.includes(field))).values : [];
    const removedPeople = raw.kind === 'read_sharing' && raw.effective_resource
        ? labelsFor('people', raw.effective_resource.reader_account_ids.filter(person => !raw.proposal.reader_account_ids.includes(person))).values : [];
    const supported = ['read_sharing', 'consumer_registration'].includes(raw.kind);
    const pending = raw.state === 'pending';
    const reviewComplete = proposed.complete && effectiveComplete;
    const approve = pending && supported && reviewComplete && activity.my_actions.includes('read.approve');
    const actions = [
        { key: 'edit', label: 'تعديل الطلب', effect: 'read', enabled: pending && supported && proposed.complete && selection !== null
            && raw.requested_by === identity.actorId && activity.my_actions.includes('read.request') },
        { key: 'reject', label: 'رفض الطلب', effect: 'read', enabled: pending && supported && activity.my_actions.includes('read.approve') },
        { key: 'approve', label: 'اعتماد الاقتراح الحالي', effect: 'write', enabled: approve },
    ];
    const grants = (context.raw.existing?.grants || []).filter(grant => grant.request_id === raw.request_id && grant.type === 'read'
        && scopeEqual(grant.scope, raw.scope));
    const grant = grants.length === 1 ? grants[0] : null;
    const grantCurrent = grant?.active === true && grant.expired === false && Date.parse(grant.expires_at) > now();
    if (grant) actions.push({ key: 'revoke', label: 'سحب منحة القراءة', effect: 'read',
        enabled: grantCurrent && activity.my_actions.includes('read.manage') });
    for (const action of actions) if (!action.enabled) action.reason = !supported ? 'هذا النوع يحتاج مسار المراجعة المختص في المركز.'
        : !pending && action.key !== 'revoke' ? 'الاقتراح الحالي ليس بانتظار المراجعة.'
            : !reviewComplete && ['edit', 'approve'].includes(action.key) ? 'يلزم التحقق من أسماء الموارد والحقول والأشخاص الحالية قبل المتابعة.'
                : action.key === 'revoke' && !grantCurrent ? 'منحة القراءة ملغاة أو منتهية؛ لم تُنشأ منحة بديلة.'
                    : 'لا تتوفر صلاحية صريحة لهذا الإجراء ضمن النشاط الحالي.';
    await assertCurrent();
    let approval;
    if (approve) {
        let reviewed;
        const summary = effectiveSummary ? [...proposed.summary.map(row => ({ label: `المقترح: ${row.label}`, value: row.value })),
            ...effectiveSummary.map(row => ({ label: `المعتمد سابقًا: ${row.label}`, value: row.value })),
            ...(removedFields.length ? [{ label: 'الحقول التي سيُسحب وصولها', value: removedFields.join('، ') }] : []),
            ...(removedPeople.length ? [{ label: 'الأشخاص الذين سيُسحب وصولهم', value: removedPeople.join('، ') }] : [])] : proposed.summary;
        try { reviewed = await issueReview('request_approve', { target: raw.request_id, expected_version: raw.version }, summary); }
        catch { fail('workspace_request_review_unavailable', 503); }
        await assertCurrent();
        if (reviewed?.review?.canSubmit !== true || !text(reviewed.review.key) || !text(reviewed.review.intentKey)
            || reviewed.review.key === raw.request_id || reviewed.review.intentKey === raw.request_id) fail('workspace_request_review_unavailable', 503);
        approval = { reviewKey: reviewed.review.key, intentKey: reviewed.review.intentKey, requestHash: hash(raw) };
        actions.find(action => action.key === 'approve').intentKey = approval.intentKey;
    }
    const request = { key: reference('request', raw.request_id, raw.version), label: names[raw.kind], state: raw.state,
        proposedSummary: proposed.summary, effectiveSummary,
        effectiveStateLabel: !raw.effective_resource ? null : raw.kind !== 'read_sharing' ? 'توجد موافقة نافذة'
            : grantCurrent ? 'تبقى منحة القراءة المعتمدة سارية ضمن صلاحيتها الحالية'
                : grant && !grant.active ? 'سُحبت منحة القراءة السابقة'
                    : grant?.expired || Date.parse(raw.effective_resource.expires_at) <= now() ? 'انتهت صلاحية منحة القراءة السابقة'
                        : 'يلزم التحقق من الحالة الحالية لمنحة القراءة السابقة',
        changedSinceEffective: raw.effective_version != null && raw.effective_version !== raw.version,
        actions, selection, grant: grant ? reference('read_grant', grant.grant_ref, grant.revision) : null,
        removedFields, removedPeople,
        ...(!reviewComplete ? { message: 'بعض أسماء الموارد أو إصدارات التسجيل لم تُتحقق؛ لا يمكن اعتماد الاقتراح من هذه الشاشة.' } : {}) };
    await assertCurrent();
    return { request, ...(approval ? { approval } : {}) };
};
