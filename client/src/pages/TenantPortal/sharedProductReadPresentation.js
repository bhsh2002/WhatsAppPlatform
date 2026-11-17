const RECORD_STATES = new Set(['active', 'archived', 'tombstone']);
const stringValue = value => typeof value === 'string' && value.length > 0;
const positiveVersion = value => Number.isSafeInteger(value) && value > 0;

export const sharedProductRecordIsValid = record => Boolean(
    record && record.entity_type === 'product'
    && stringValue(record.entity_id) && record.domain === 'product.core'
    && stringValue(record.scope?.organization_id) && stringValue(record.scope?.activity_id)
    && stringValue(record.source?.installation_id) && stringValue(record.source?.local_entity_id)
    && stringValue(record.source?.entity_type) && record.source.entity_type.length <= 80
    && positiveVersion(record.version) && positiveVersion(record.ownership_epoch)
    && Number.isSafeInteger(record.expected_version) && record.expected_version >= 0
    && Number.isFinite(Date.parse(record.observed_at)) && Number.isFinite(Date.parse(record.received_at))
    && RECORD_STATES.has(record.state)
    && record.data && typeof record.data === 'object' && !Array.isArray(record.data)
    && (record.freshness == null || ['current', 'stale', 'clock_ahead'].includes(record.freshness))
    && record.field_visibility === 'explicit_grants_only'
);

export const sharedReadResponseIsValid = (response, mode = 'records', now = Date.now()) => {
    if (response?.spec_version !== '1.0' || response?.enabled !== true
        || response?.read_only !== true || response?.execution_ready !== false
        || response?.pricing_use_allowed !== false || typeof response?.has_more !== 'boolean') return false;
    const context = response.context;
    if (context?.consumer_platform !== 'wa_savana'
        || !stringValue(context.scope?.organization_id) || !stringValue(context.scope?.activity_id)
        || !/^[0-9a-f]{64}$/.test(context.authorization_revision || '')
        || !Number.isFinite(Date.parse(context.checked_at)) || Date.parse(context.valid_until) <= now
        || !Number.isFinite(Date.parse(context.valid_until))) return false;
    const inCurrentScope = record => sharedProductRecordIsValid(record)
        && record.scope.organization_id === context.scope.organization_id
        && record.scope.activity_id === context.scope.activity_id;
    if (mode === 'changes') {
        return Array.isArray(response.changes)
            && response.changes.every(change => positiveVersion(change?.cursor) && inCurrentScope(change.record))
            && Number.isSafeInteger(response.cursor) && response.cursor >= 0;
    }
    return Array.isArray(response.records) && response.records.every(inCurrentScope)
        && (response.next_cursor === null || stringValue(response.next_cursor));
};

export const sharedProductRecordKey = record => JSON.stringify([
    record.scope?.organization_id, record.scope?.activity_id, record.scope?.branch_id ?? null,
    record.scope?.warehouse_id ?? null, record.entity_type, record.entity_id, record.domain,
    record.source?.installation_id,
]);

export const sharedProductVisibleFields = record => (
    record?.state === 'tombstone' ? [] : Object.entries(record?.data || {})
);

export const sharedProductTitle = record => (
    record?.state !== 'tombstone' && stringValue(record?.data?.name) ? record.data.name : record?.entity_id
);

export const sharedProductDisplayValue = (value, language = 'ar') => {
    if (value === null) return language === 'ar' ? 'غير محدد في المرجع' : 'Not specified by the source';
    if (typeof value === 'string') return value || (language === 'ar' ? 'قيمة فارغة في المرجع' : 'Empty source value');
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
};

export const sharedReadErrorMessage = (error, language = 'ar') => {
    const ar = language === 'ar';
    const code = error?.data?.error?.code || error?.data?.code || error?.code;
    if (code === 'shared_product_reads_disabled') return ar
        ? 'قراءة المنتجات المشتركة غير مفعّلة في هذه البيئة. يتطلب التفعيل إعدادًا خادميًا وتفويضًا معتمدًا؛ الاشتراك وحده لا يفعّلها.'
        : 'Shared product reads are disabled here. They require approved server configuration and authorization; a subscription alone does not enable them.';
    if (error?.status === 401 || error?.status === 403) return ar
        ? 'تعذر التحقق من جلسة القراءة أو سُحب تفويضها. أُخفي العرض السابق؛ هذا لا يعني حذف المنتج من مصدره.'
        : 'The read session could not be verified or its permission was withdrawn. Previous rows are hidden; this does not mean the source product was deleted.';
    if (error?.status === 404) return ar
        ? 'المرجع غير موجود أو غير مرئي للتفويض الحالي. لم يُحوّل ذلك إلى حذف أو أرشفة.'
        : 'The record is absent or not visible to the current authorization. This was not converted into deletion or archival.';
    if (error?.status === 409) return ar
        ? 'مؤشر القراءة لم يعد صالحًا لهذا التفويض. أعد التحقق من الصفحة الأولى؛ لم يُستخدم العرض السابق.'
        : 'The read cursor is no longer valid for this authorization. Verify again from the first page; prior rows were not reused.';
    return ar
        ? 'تعذر التحقق من القراءة الحالية. أُخفي العرض السابق إلى أن تنجح قراءة مفوّضة جديدة؛ لم يُحذف شيء من المصدر.'
        : 'The current read could not be verified. Previous rows are hidden until a new authorized read succeeds; no source deletion was inferred.';
};
