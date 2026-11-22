import { workspaceLabel } from './connectionsDataPresentation.js';

export const SHARED_PREVIEW_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);
export const SHARED_PREVIEW_MAX_BYTES = 524_288;
const kinds = ['digital_good', 'service', 'experience', 'event', 'accommodation', 'property', 'vehicle', 'equipment', 'space', 'membership', 'content', 'custom'];
const statuses = ['active', 'draft', 'paused', 'retired'];
const processes = ['purchase', 'rental', 'booking', 'subscription', 'quote', 'inquiry', 'negotiation'];
const pricingModels = ['fixed', 'starting_from', 'free', 'quote', 'negotiated'];
const units = ['each', 'hour', 'day', 'night', 'week', 'month', 'year', 'session', 'seat', 'project', 'kilogram', 'meter', 'custom'];
const amount = /^(0|[1-9][0-9]{0,10})(\.[0-9]{1,3})?$/;
const has = (value, key) => Object.hasOwn(value, key);
const text = (value, max, min = 1) => typeof value === 'string' && [...value].length >= min && [...value].length <= max;
const opaque = value => text(value, 180_000);
const shape = (value, required, optional = []) => Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && required.every(key => has(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key)));
const safePositive = value => Number.isSafeInteger(value) && value > 0;
const nullableText = (value, max, min = 0) => value === null || text(value, max, min);
const date = value => {
    if (!text(value, 80) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
        || !Number.isFinite(Date.parse(value))) return false;
    const [year, month, day] = value.slice(0, 10).split('-').map(Number);
    return month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
};
const jsonValue = value => {
    const pending = [value], seen = new WeakSet();
    while (pending.length) {
        const item = pending.pop();
        if (item === null || typeof item === 'string' || typeof item === 'boolean') continue;
        if (typeof item === 'number') { if (!Number.isFinite(item) || (Number.isInteger(item) && !Number.isSafeInteger(item))) return false; continue; }
        if (typeof item !== 'object' || seen.has(item)) return false;
        seen.add(item);
        if (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) return false;
        pending.push(...Object.values(item));
    }
    try { return JSON.stringify(value).length <= 1_048_576; } catch { return false; }
};
const offeringData = data => shape(data, [], ['name', 'description', 'kind', 'status', 'category_key', 'attribute_schema_key', 'attributes'])
    && (!has(data, 'name') || text(data.name, 200)) && (!has(data, 'description') || nullableText(data.description, 4000))
    && (!has(data, 'kind') || kinds.includes(data.kind)) && (!has(data, 'status') || statuses.includes(data.status))
    && ['category_key', 'attribute_schema_key'].every(key => !has(data, key) || nullableText(data[key], 120))
    && (!has(data, 'attributes') || (shape(data.attributes, [], Object.keys(data.attributes || {})) && Object.keys(data.attributes).length <= 100
        && Object.keys(data.attributes).every(key => text(key, 120)) && jsonValue(data.attributes)));

export const sharedResourcePriceOptionIsValid = option => {
    if (!shape(option, ['code', 'process', 'pricing_model', 'amount', 'currency', 'unit'], ['key']) || !text(option.code, 120)
        || (has(option, 'key') && !opaque(option.key)) || !processes.includes(option.process) || !pricingModels.includes(option.pricing_model)
        || !(option.amount === null || (typeof option.amount === 'string' && amount.test(option.amount)))
        || !(option.currency === null || (typeof option.currency === 'string' && /^[A-Z]{3}$/.test(option.currency))) || !(option.unit === null || units.includes(option.unit))) return false;
    if (['fixed', 'starting_from'].includes(option.pricing_model)) return option.amount !== null;
    if (['quote', 'negotiated'].includes(option.pricing_model)) return option.amount === null;
    return option.amount === null || /^0(?:\.0{1,3})?$/.test(option.amount);
};
const productData = data => shape(data, [], ['name', 'description', 'sku', 'barcodes', 'base_unit', 'price_options', 'variant_ref'])
    && (!has(data, 'name') || text(data.name, 200)) && (!has(data, 'description') || nullableText(data.description, 4000))
    && (!has(data, 'sku') || nullableText(data.sku, 100, 1))
    && (!has(data, 'barcodes') || (Array.isArray(data.barcodes) && data.barcodes.length <= 50 && data.barcodes.every(value => text(value, 100))))
    && (!has(data, 'base_unit') || data.base_unit === null || (shape(data.base_unit, ['code', 'metadata_version'])
        && ['each', 'kilogram', 'meter'].includes(data.base_unit.code) && safePositive(data.base_unit.metadata_version)))
    && (!has(data, 'price_options') || (Array.isArray(data.price_options) && data.price_options.length <= 100 && data.price_options.every(sharedResourcePriceOptionIsValid)))
    && (!has(data, 'variant_ref') || data.variant_ref === null);
export const sharedResourcePublicationIsValid = (publication, record) => {
    if (!record?.data || !shape(publication, ['source_watermark', 'field_versions', 'field_observed_at']) || !safePositive(publication.source_watermark)) return false;
    const permitted = [...Object.keys(record.data), ...(record.resource_kind === 'product' ? ['media'] : [])];
    return [['field_versions', safePositive], ['field_observed_at', date]].every(([key, validate]) => {
        const values = publication[key];
        return shape(values, [], permitted) && Object.keys(values).length >= 1 && Object.keys(values).length <= 32
            && Object.values(values).every(validate);
    }) && Object.keys(publication.field_versions).length === Object.keys(publication.field_observed_at).length
        && Object.keys(publication.field_versions).every(field => has(publication.field_observed_at, field));
};
export const sharedResourceRecordIsValid = record => shape(record, ['key', 'resource_kind', 'sourceLabel', 'observed_at', 'data'], ['central_publication'])
    && opaque(record.key) && Boolean(workspaceLabel(record.sourceLabel, null)) && date(record.observed_at)
    && (record.resource_kind === 'offering' ? offeringData(record.data) : record.resource_kind === 'product' && productData(record.data))
    && (!has(record, 'central_publication') || sharedResourcePublicationIsValid(record.central_publication, record));
export const sharedResourcePreviewDescriptorIsValid = value => shape(value, ['key', 'valid_until', 'content_types']) && opaque(value.key) && date(value.valid_until)
    && Array.isArray(value.content_types) && value.content_types.length >= 1 && value.content_types.length <= 3
    && value.content_types.every(type => SHARED_PREVIEW_TYPES.includes(type)) && new Set(value.content_types).size === value.content_types.length;
export const sharedResourceEnvelopeIsValid = (value, now = Date.now()) => Boolean(shape(value, ['viewKey', 'valid_until', 'record'], ['mediaCount', 'previews'])
    && opaque(value.viewKey) && date(value.valid_until) && Date.parse(value.valid_until) > now && sharedResourceRecordIsValid(value.record)
    && (!has(value, 'mediaCount') || (value.record.resource_kind === 'product' && Number.isSafeInteger(value.mediaCount) && value.mediaCount >= 0 && value.mediaCount <= 20))
    && (!['field_versions', 'field_observed_at'].some(key => has(value.record.central_publication?.[key] || {}, 'media')) || has(value, 'mediaCount'))
    && (!has(value, 'previews') || (Array.isArray(value.previews) && value.previews.length <= 20 && value.previews.every(sharedResourcePreviewDescriptorIsValid)
        && new Set(value.previews.map(row => row.key)).size === value.previews.length
        && (value.record.resource_kind === 'product' || value.previews.length === 0)
        && (!has(value, 'mediaCount') || value.previews.length <= value.mediaCount))));
export const sharedResourceEnvelopeKey = envelope => envelope ? JSON.stringify([envelope.viewKey, envelope.valid_until, envelope.record,
    envelope.mediaCount ?? null, envelope.previews || []]) : null;
export const sharedResourceBrowserBinding = ({ context, activity, auth, productRecord = null }, now = Date.now()) => {
    if (context?.verified !== true || !opaque(context.viewKey) || !opaque(context.native_reference) || !date(context.valid_until)
        || Date.parse(context.valid_until) <= now || !opaque(activity) || auth?.loading !== false || !auth.user
        || !(text(auth.user.id, 255) || safePositive(auth.user.id)) || !Number.isSafeInteger(auth.sessionRevision) || auth.sessionRevision < 0
        || (productRecord !== null && !opaque(productRecord))) return null;
    return JSON.stringify([context.viewKey, context.valid_until, context.native_reference, activity, productRecord,
        auth.sessionRevision, auth.user.id, auth.user.role ?? null, auth.user.tenant_id ?? null, auth.tenant?.id ?? null]);
};
export const sharedResourceOptionsIsValid = value => shape(value, ['providers', 'browseAction'])
    && Array.isArray(value.providers) && value.providers.every(row => shape(row, ['value', 'label', 'enabled'])
        && opaque(row.value) && Boolean(workspaceLabel(row.label, null)) && row.enabled === true)
    && new Set(value.providers.map(row => row.value)).size === value.providers.length
    && shape(value.browseAction, ['enabled', 'label']) && typeof value.browseAction.enabled === 'boolean' && Boolean(workspaceLabel(value.browseAction.label, null));
export const sharedResourceResponseIsCurrent = (value, context, now = Date.now()) => Boolean(value?.viewKey === context?.viewKey
    && date(value.valid_until) && Date.parse(value.valid_until) > now && Date.parse(value.valid_until) <= Date.parse(context?.valid_until));
export const sharedResourceListIsValid = (value, context, now = Date.now()) => shape(value, ['viewKey', 'valid_until', 'records', 'cursor'])
    && sharedResourceResponseIsCurrent(value, context, now) && Array.isArray(value.records) && value.records.length <= 50
    && value.records.every(row => sharedResourceRecordIsValid(row) && row.resource_kind === 'offering')
    && new Set(value.records.map(row => row.key)).size === value.records.length && (value.cursor === null || opaque(value.cursor));
export const sharedResourcePreviewDeadline = (envelope, descriptor, result = null) => {
    const values = [envelope?.valid_until, descriptor?.valid_until, ...(result === null ? [] : [result.valid_until])];
    return values.every(date) ? Math.min(...values.map(Date.parse)) : 0;
};
export const sharedResourcePreviewResultIsValid = (result, envelope, descriptor, now = Date.now()) => Boolean(
    sharedResourcePreviewDescriptorIsValid(descriptor) && shape(result, ['blob', 'valid_until']) && typeof Blob !== 'undefined' && result.blob instanceof Blob
    && SHARED_PREVIEW_TYPES.includes(result.blob.type) && descriptor.content_types.includes(result.blob.type)
    && result.blob.size > 0 && result.blob.size <= SHARED_PREVIEW_MAX_BYTES
    && sharedResourcePreviewDeadline(envelope, descriptor, result) > now
);

const words = {
    kind: { digital_good: ['منتج رقمي', 'Digital good'], service: ['خدمة', 'Service'], experience: ['تجربة', 'Experience'], event: ['فعالية', 'Event'], accommodation: ['إقامة', 'Accommodation'], property: ['عقار', 'Property'], vehicle: ['مركبة', 'Vehicle'], equipment: ['معدات', 'Equipment'], space: ['مساحة', 'Space'], membership: ['عضوية', 'Membership'], content: ['محتوى', 'Content'], custom: ['مخصص', 'Custom'] },
    status: { active: ['نشط', 'Active'], draft: ['مسودة', 'Draft'], paused: ['متوقف مؤقتًا', 'Paused'], retired: ['متقاعد', 'Retired'] },
    process: { purchase: ['شراء', 'Purchase'], rental: ['تأجير', 'Rental'], booking: ['حجز', 'Booking'], subscription: ['اشتراك', 'Subscription'], quote: ['طلب عرض سعر', 'Quote'], inquiry: ['استفسار', 'Inquiry'], negotiation: ['تفاوض', 'Negotiation'] },
    pricing: { fixed: ['ثابت', 'Fixed'], starting_from: ['ابتداءً من', 'Starting from'], free: ['مجاني', 'Free'], quote: ['بعرض سعر', 'Quote'], negotiated: ['بالتفاوض', 'Negotiated'] },
    unit: { each: ['قطعة', 'Each'], hour: ['ساعة', 'Hour'], day: ['يوم', 'Day'], night: ['ليلة', 'Night'], week: ['أسبوع', 'Week'], month: ['شهر', 'Month'], year: ['سنة', 'Year'], session: ['جلسة', 'Session'], seat: ['مقعد', 'Seat'], project: ['مشروع', 'Project'], kilogram: ['كيلوغرام', 'Kilogram'], meter: ['متر', 'Meter'], custom: ['مخصصة', 'Custom'] },
};
export const sharedResourceEnumLabel = (group, value, isArabic = true) => words[group]?.[value]?.[isArabic ? 0 : 1] ?? value;
export const sharedResourceValueText = (value, isArabic = true) => value === null ? (isArabic ? 'لم يحدده المصدر' : 'Not specified by source')
    : typeof value === 'string' ? value || (isArabic ? 'قيمة فارغة من المصدر' : 'Empty source value') : JSON.stringify(value, null, 2);
export const sharedResourceTimestamp = (value, isArabic = true) => date(value)
    ? new Intl.DateTimeFormat(isArabic ? 'ar-LY' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : null;
export const sharedResourceFieldProvenance = (record, field) => {
    if (!sharedResourceRecordIsValid(record) || (!has(record.data, field) && !(record.resource_kind === 'product' && field === 'media'))) return null;
    if (!has(record, 'central_publication')) return { observed_at: record.observed_at, version: null };
    const publication = record.central_publication;
    const observed_at = publication.field_observed_at[field] ?? null, version = publication.field_versions[field] ?? null;
    return observed_at !== null || version !== null ? { observed_at, version } : null;
};
export const sharedResourceFieldRows = (record, isArabic = true) => {
    if (!sharedResourceRecordIsValid(record)) return [];
    const names = { name: ['الاسم', 'Name'], description: ['الوصف', 'Description'], sku: ['رمز المنتج', 'SKU'], barcodes: ['الباركود', 'Barcodes'], kind: ['النوع', 'Kind'], status: ['الحالة', 'Status'], category_key: ['تصنيف المصدر', 'Source category'], attribute_schema_key: ['مرجع خصائص المصدر', 'Source attribute schema'] };
    return Object.entries(record.data).filter(([key]) => has(names, key)).map(([key, value]) => ({ key, label: names[key][isArabic ? 0 : 1], sourceValue: value,
        value: ['kind', 'status'].includes(key) ? sharedResourceEnumLabel(key, value, isArabic) : sharedResourceValueText(value, isArabic) }));
};

// Transient preview ownership only. No bytes, object URLs or source selectors
// are stored outside this instance, and every replacement revokes its old URL.
export const createSharedResourcePreviewController = ({ onPreview, onChange = () => {}, onInvalidated = () => {}, now = Date.now,
    schedule = setTimeout, cancel = clearTimeout, createObjectURL = blob => URL.createObjectURL(blob), revokeObjectURL = url => URL.revokeObjectURL(url),
    createAbortController = () => new AbortController() } = {}) => {
    let envelope = null, partition = null, generation = 0, request = null, url = null, timer = null, disposed = false;
    let state = { status: 'idle', partition: null, key: null, url: null, valid_until: null };
    const emit = next => { state = next; if (!disposed) onChange(next); };
    const release = () => {
        generation += 1; request?.abort(); request = null;
        if (timer !== null) cancel(timer); timer = null;
        if (url !== null) { const previous = url; url = null; revokeObjectURL(previous); }
    };
    const clear = status => { release(); emit({ status, partition, key: null, url: null, valid_until: null }); };
    const arm = deadline => {
        if (timer !== null) cancel(timer);
        const expectedGeneration = generation;
        const check = () => {
            if (disposed || generation !== expectedGeneration) return;
            const remaining = deadline - now();
            if (remaining > 0) timer = schedule(check, Math.min(remaining, 2_147_483_647));
            else clear('expired');
        };
        check();
    };
    const setEnvelope = next => {
        if (disposed) return;
        const current = sharedResourceEnvelopeIsValid(next, now());
        const nextPartition = current ? sharedResourceEnvelopeKey(next) : null;
        if (nextPartition !== partition || !current) { release(); partition = nextPartition; envelope = current ? next : null;
            emit({ status: current ? 'idle' : 'unavailable', partition, key: null, url: null, valid_until: null }); }
        else envelope = next;
        if (envelope) arm(Math.min(Date.parse(envelope.valid_until), state.valid_until ? Date.parse(state.valid_until) : Infinity));
    };
    const load = async key => {
        if (disposed || !sharedResourceEnvelopeIsValid(envelope, now()) || typeof onPreview !== 'function') return false;
        const descriptor = envelope.previews?.find(row => row.key === key);
        if (!descriptor || sharedResourcePreviewDeadline(envelope, descriptor) <= now()) { clear('expired'); return false; }
        release(); const token = generation, expectedPartition = partition, expectedEnvelope = envelope;
        request = createAbortController(); const active = request;
        emit({ status: 'loading', partition, key, url: null, valid_until: new Date(sharedResourcePreviewDeadline(expectedEnvelope, descriptor)).toISOString() });
        arm(sharedResourcePreviewDeadline(expectedEnvelope, descriptor));
        try {
            if (disposed || token !== generation || active.signal.aborted) return false;
            const result = await onPreview(key, { signal: active.signal });
            if (disposed || token !== generation || partition !== expectedPartition || active.signal.aborted) return false;
            if (!sharedResourcePreviewResultIsValid(result, expectedEnvelope, descriptor, now())) throw new Error('invalid_preview');
            const created = createObjectURL(result.blob);
            if (typeof created !== 'string' || !created.startsWith('blob:')) { revokeObjectURL(created); throw new Error('invalid_object_url'); }
            url = created; request = null;
            const deadline = sharedResourcePreviewDeadline(expectedEnvelope, descriptor, result);
            emit({ status: 'available', partition, key, url, valid_until: new Date(deadline).toISOString() }); arm(deadline);
            return true;
        } catch {
            if (disposed || token !== generation || active.signal.aborted) return false;
            clear('unavailable'); onInvalidated(); return false;
        }
    };
    return { setEnvelope, load, close: () => { if (!disposed) { clear('idle'); if (envelope) arm(Date.parse(envelope.valid_until)); } },
        dispose: () => { disposed = true; release(); envelope = null; partition = null; } };
};
