import { workspaceChoiceAvailable, workspaceLabel, workspaceReviewSummaryIsValid } from './connectionsDataPresentation.js';

const text = (value, max = 180_000) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const named = value => Boolean(workspaceLabel(value, null));
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const actions = new Set(['read', 'request', 'approve', 'execute', 'reconcile']);
const policies = new Set(['new_only', 'selected', 'activity']);
const choice = row => text(row?.value) && named(row.label) && typeof row.enabled === 'boolean' && (row.reason == null || typeof row.reason === 'string');
const choices = rows => Array.isArray(rows) && rows.every(choice) && new Set(rows.map(row => row.value)).size === rows.length;
const unique = values => Array.isArray(values) && values.every(value => text(value)) && new Set(values).size === values.length;
const available = (rows, value) => rows?.some(row => row.value === value && workspaceChoiceAvailable(row));
const offered = (rows, values) => unique(values) && values.every(value => available(rows, value));
export const emptyWorkspaceCapabilityGrantDraft = () => ({ grant: '', person: '', actions: [], fields: [], resources: [], resourcePolicy: '', expiresAt: '', assignSourceAuthority: false });
// Used only for grant-options / grants/review preparation, never for a submitted
// effect, intent hold, or evidence that a dispatched mutation had no effect.
export const workspaceCapabilityGrantChoicesChanged = error => error?.status === 409
    && ['workspace_grant_choice_changed', 'workspace_choice_changed'].includes(error.data?.error?.code);

export const workspaceCapabilityGrantOptionsIsCurrent = (value, context, now = Date.now()) => {
    if (!context?.verified || !date(context.valid_until) || Date.parse(context.valid_until) <= now || value?.viewKey !== context.viewKey
        || !date(value.valid_until) || Date.parse(value.valid_until) <= now || Date.parse(value.valid_until) > Date.parse(context.valid_until)
        || !choices(value.choices?.grants) || !choices(value.choices?.people)
        || !['grant', 'person'].every(key => typeof value.selection?.[key] === 'string'
            && (!value.selection[key] || value.choices[key === 'grant' ? 'grants' : 'people'].some(row => row.value === value.selection[key])))) return false;
    if (value.editor === null) return true;
    const editor = value.editor, saved = editor?.currentSelection, authority = editor?.sourceAuthority;
    return Boolean(editor && ['fields', 'resources', 'actions', 'policies'].every(key => choices(editor[key]))
        && editor.resources.every(row => typeof row.sourceAuthorityAvailable === 'boolean')
        && editor.actions.every(row => actions.has(row.value)) && editor.policies.every(row => policies.has(row.value))
        && saved && ['actions', 'fields', 'resources'].every(key => unique(saved[key]))
        && saved.actions.every(value => actions.has(value)) && (saved.resourcePolicy === '' || policies.has(saved.resourcePolicy))
        && (saved.expiresAt === '' || saved.expiresAt === null || date(saved.expiresAt)) && saved.assignSourceAuthority === false
        && (Array.isArray(editor.currentSummary) && (editor.currentSummary.length === 0 || workspaceReviewSummaryIsValid(editor.currentSummary)))
        && typeof authority?.enabled === 'boolean' && named(authority.label)
        && (authority.reason == null || typeof authority.reason === 'string') && (authority.currentLabel == null || named(authority.currentLabel)));
};

// A saved expiry is shown separately as the exact ISO value. The editable
// datetime is the owner's device time and converted explicitly on review.
export const workspaceGrantExpiryInput = value => {
    if (!date(value)) return '';
    const time = new Date(value), pad = part => String(part).padStart(2, '0');
    return `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())}T${pad(time.getHours())}:${pad(time.getMinutes())}`;
};
export const workspaceCapabilityGrantDraftFromOptions = options => {
    const saved = options?.editor?.currentSelection;
    return { ...emptyWorkspaceCapabilityGrantDraft(), grant: options?.selection?.grant || '', person: options?.selection?.person || '',
        ...(saved ? { actions: [...saved.actions], fields: [...saved.fields], resources: [...saved.resources], resourcePolicy: saved.resourcePolicy,
            expiresAt: workspaceGrantExpiryInput(saved.expiresAt) } : {}) };
};
export const updateWorkspaceCapabilityGrantDraft = (draft, field, value) => {
    if (['person', 'grant'].includes(field)) return { ...emptyWorkspaceCapabilityGrantDraft(), ...(field === 'grant' ? { person: draft.person } : {}), [field]: value };
    if (['actions', 'fields', 'resources'].includes(field)) return { ...draft, [field]: [...new Set(value)], assignSourceAuthority: false };
    if (field === 'resourcePolicy') return { ...draft, resourcePolicy: value, resources: [], assignSourceAuthority: false };
    if (['expiresAt', 'assignSourceAuthority'].includes(field)) return { ...draft, [field]: value };
    return draft;
};
export const workspaceCapabilityGrantCanReview = ({ context, descriptor, options, draft, held = true, busy = false, now = Date.now() }) => Boolean(
    !held && !busy && workspaceCapabilityGrantOptionsIsCurrent(options, context, now) && options.editor
    && text(descriptor?.activity) && draft?.grant === options.selection.grant && draft.person === options.selection.person
    && available(options.choices.grants, draft.grant) && available(options.choices.people, draft.person)
    && offered(options.editor.actions, draft.actions) && offered(options.editor.fields, draft.fields) && offered(options.editor.resources, draft.resources)
    && available(options.editor.policies, draft.resourcePolicy) && date(draft.expiresAt) && Date.parse(draft.expiresAt) > now
    && (draft.resourcePolicy === 'selected' || draft.resources.length === 0)
    && (draft.actions.length === 0 || draft.resourcePolicy !== 'selected' || draft.resources.length > 0)
    && typeof draft.assignSourceAuthority === 'boolean' && (!draft.assignSourceAuthority
        || (options.editor.sourceAuthority.enabled === true && draft.resourcePolicy === 'selected' && draft.resources.length > 0 && draft.actions.length > 0
            && draft.resources.every(value => options.editor.resources.find(row => row.value === value)?.sourceAuthorityAvailable === true))));

export const workspaceCapabilityGrantInput = value => {
    if (!workspaceCapabilityGrantCanReview(value)) return null;
    const { descriptor, draft } = value;
    return { activity: descriptor.activity, grant: draft.grant, person: draft.person, actions: [...draft.actions], fields: [...draft.fields], resources: [...draft.resources],
        resourcePolicy: draft.resourcePolicy, expiresAt: new Date(draft.expiresAt).toISOString(), assignSourceAuthority: draft.assignSourceAuthority };
};

export const prepareWorkspaceCapabilityGrantReview = async ({ input, context, readFresh, requestReview, isCurrent, now = () => Date.now() }) => {
    if (!isCurrent()) return { stale: true };
    const options = await readFresh();
    if (!isCurrent()) return { stale: true };
    if (!workspaceCapabilityGrantOptionsIsCurrent(options, context, now())) return { changed: true, options: null };
    if (!workspaceCapabilityGrantCanReview({ context, descriptor: { activity: input.activity }, options, draft: input, held: false, busy: false, now: now() })) return { changed: true, options };
    const result = await requestReview(input);
    return isCurrent() ? { options, result } : { stale: true };
};
