import { workspaceLabel } from './connectionsDataPresentation.js';

const states = {
    pending_review: ['بانتظار المراجعة', 'Awaiting review'],
    approved: ['اعتُمد الطلب ولم يتأكد تنفيذه بعد', 'Approved; execution not confirmed yet'],
    dispatching: ['أُرسل الطلب وينتظر تأكيد المصدر', 'Dispatched; awaiting source confirmation'],
    outcome_unknown: ['النتيجة غير محسومة', 'Outcome unresolved'],
    source_pending: ['قُبل الطلب في قائمة المصدر ولم يتأكد تنفيذه بعد', 'Accepted into the source queue; execution not confirmed yet'],
    cancel_requested: ['طُلب إيقاف العملية؛ بانتظار نتيجة التحقق', 'Cancellation requested; awaiting verified outcome'],
    source_applied: ['أفاد المصدر بتطبيق التغيير', 'Source reports the change applied'],
    source_partially_applied: ['نُفّذ جزء من الطلب؛ راجع نتائج الأجزاء', 'Part of the request was applied; review individual outcomes'],
    cancelled: ['أُلغي الطلب', 'Request cancelled'],
    rejected: ['رُفض الطلب', 'Request rejected'], failed: ['تعذر تنفيذ الطلب', 'Request failed'],
    conflict: ['تغيّرت بيانات المصدر؛ تلزم مراجعة جديدة', 'Source data changed; a new review is needed'],
};

const projections = {
    not_applied: ['لم تُحدّث النسخة المشتركة بعد', 'The shared view has not been updated'],
    pending: ['تحديث النسخة المشتركة قيد الانتظار', 'Shared view update pending'],
    current: ['النسخة المشتركة محدثة', 'Shared view current'],
    not_required: ['لا تتطلب هذه العملية تحديث نسخة بيانات مشتركة', 'This operation does not require a shared data update'],
};
const nativeReceiptActions = new Set(['messaging.send', 'campaigns.execute', 'content.publish', 'measurement.summary', 'measurement.export', 'owner.operation_status']);
const nativeReviewActions = new Set(['messaging.review', 'campaigns.review', 'content.review']);
const nativeContactActions = new Set(['contacts.create', 'contacts.change', 'contacts.remove', 'contacts.read']);
const nativeMediaActions = new Set(['media.asset.upload', 'media.asset.inspect']);
const nativeSnapshotActions = new Set(['measurement.summary', 'measurement.export', 'owner.operation_status', 'contacts.read', 'media.asset.inspect']);

// State and source evidence remain separate from the shared projection. None
// of these labels supply action availability or authorize another submission.
export const workspaceCommandStatus = (command = {}, language = 'ar') => {
    const index = language === 'ar' ? 0 : 1;
    const receipt = command.source_result;
    const nativeReceipt = nativeReceiptActions.has(command.action);
    const reviewReceipt = nativeReviewActions.has(command.action);
    const revisionValid = nativeReceipt ? receipt?.source_revision == null
        || (Number.isSafeInteger(receipt.source_revision) && receipt.source_revision >= 0)
        : Number.isSafeInteger(receipt?.source_revision) && receipt.source_revision > 0;
    const sourceConfirmed = command.state === 'source_applied' && receipt?.confirmed === true && revisionValid;
    return {
        stateLabel: nativeSnapshotActions.has(command.action) && command.state === 'source_applied'
            ? (index === 0 ? 'أُعدت نتيجة البيانات من المصدر' : 'The data result was prepared by the source')
            : reviewReceipt && command.state === 'source_applied'
                ? (index === 0 ? 'حُفظت مسودة المراجعة لدى النشاط' : 'The activity review draft was recorded')
                : command.action === 'media.asset.upload' && command.state === 'source_applied'
                    ? (index === 0 ? 'أفاد المصدر بقبول رفع الملف إلى مكتبة القناة' : 'Source reports the file upload accepted into the channel library')
                : nativeReceipt && command.state === 'source_applied'
            ? (index === 0 ? 'أفاد المنفّذ بقبول العملية' : 'Executor reports the operation accepted')
            : states[command.state]?.[index] || (index === 0 ? 'لم تُتحقق حالة الطلب' : 'Request state unverified'),
        projectionLabel: projections[command.projection_state]?.[index] || (index === 0 ? 'لم يُتحقق تحديث النسخة المشتركة' : 'Shared view freshness unverified'),
        sourceLabel: sourceConfirmed
            ? (reviewReceipt ? (index === 0 ? 'وصل إيصال حفظ المسودة. يحتاج التنفيذ اللاحق إلى طلب وصلاحية مستقلة.' : 'A draft receipt is available. Later execution requires a separate request and permission.')
                : nativeReceipt ? (index === 0 ? 'وصل إيصال موثّق من المنفّذ.' : 'A verified executor receipt is available.')
                : (index === 0 ? 'وصل إيصال التطبيق من المصدر.' : 'The source application receipt is available.'))
            : (index === 0 ? 'لم يصل تأكيد تطبيق موثق من المصدر.' : 'A verified source application confirmation is not available.'),
        sourceConfirmed,
        fullyConfirmed: sourceConfirmed && (command.projection_state === 'current' || ((nativeReceipt || reviewReceipt || nativeContactActions.has(command.action) || nativeMediaActions.has(command.action)) && command.projection_state === 'not_required')),
        unresolved: ['dispatching', 'outcome_unknown', 'source_pending', 'cancel_requested'].includes(command.state),
    };
};


export const workspaceCommandResultActions = command => {
    if (!workspaceCommandStatus(command).sourceConfirmed || !Array.isArray(command?.resultActions)) return [];
    const formats = new Set();
    return command.resultActions.filter(action => {
        if (!['json', 'csv'].includes(action?.format) || formats.has(action.format) || !workspaceLabel(action.label, null)
            || action.href !== `/api/portal/integrations/workspace/commands/${encodeURIComponent(command.key)}/result?format=${action.format}`) return false;
        formats.add(action.format); return true;
    });
};
