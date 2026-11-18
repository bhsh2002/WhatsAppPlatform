import { workspaceChoiceAvailable, workspaceLabel } from './connectionsDataPresentation.js';

const PRODUCT_FIELDS = ['name', 'description', 'sku', 'barcodes', 'base_unit', 'price', 'media'];
const CLEARABLE_FIELDS = PRODUCT_FIELDS.filter(field => field !== 'name');
const PRICE_PATTERN = /^(0|[1-9][0-9]*)(\.[0-9]{1,3})?$/;
const label = (ar, arabic, english) => ar ? arabic : english;

export const canonicalWorkspaceDecimal = value => (typeof value === 'string' ? value : '').trim()
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06F0))
    .replace(/٫/g, '.');

export const workspaceDecimalIsValid = value => {
    const amount = canonicalWorkspaceDecimal(value);
    return amount.length <= 30 && PRICE_PATTERN.test(amount);
};

export const emptyWorkspaceProductDraft = () => ({
    name: '', description: '', sku: '', barcodes: '', base_unit: '',
    price: { amount: '', choice: '' }, media: [], changedFields: [], clearFields: [],
});

export const updateWorkspaceProductDraft = (draft, field, value) => {
    if (!PRODUCT_FIELDS.includes(field)) return draft;
    return { ...draft, [field]: value, changedFields: [...new Set([...(draft.changedFields || []), field])],
        clearFields: (draft.clearFields || []).filter(key => key !== field) };
};

export const clearWorkspaceProductField = (draft, field, clear) => {
    if (!CLEARABLE_FIELDS.includes(field)) return draft;
    return { ...draft, changedFields: [...new Set([...(draft.changedFields || []), field])],
        clearFields: clear ? [...new Set([...(draft.clearFields || []), field])]
            : (draft.clearFields || []).filter(key => key !== field) };
};

const allowedChoice = (options, value) => options?.some(option => option.value === value && workspaceChoiceAvailable(option));
const parseBarcodes = value => String(value || '').split(/[\n،,]/).map(item => item.trim()).filter(Boolean);

export const workspaceProductDraftErrors = ({ mode = 'create', draft = emptyWorkspaceProductDraft(), fields = [],
    units = [], priceChoices = [], mediaChoices = [], language = 'ar' } = {}) => {
    const ar = language === 'ar';
    const errors = {};
    if (mode === 'create' && !fields.some(field => field.key === 'name' && field.enabled === true)) {
        errors.form = label(ar, 'لم تتوفر حقول إنشاء منتج مسموحة لهذا الحساب.', 'Allowed product creation fields are not available for this account.');
    }
    const changed = mode === 'create' ? fields.filter(field => field.enabled === true).map(field => field.key) : draft.changedFields || [];
    const field = key => fields.find(item => item.key === key);
    const considered = key => changed.includes(key) || field(key)?.required === true;
    const clearing = key => (draft.clearFields || []).includes(key);
    for (const key of changed) {
        if (!PRODUCT_FIELDS.includes(key) || field(key)?.enabled !== true) errors[key] = label(ar, 'لم تُتحقق صلاحية تعديل هذا البيان.', 'Permission to change this field has not been verified.');
    }
    for (const key of draft.clearFields || []) {
        if (!CLEARABLE_FIELDS.includes(key) || field(key)?.enabled !== true || field(key)?.clearable !== true || field(key)?.required === true) {
            errors[key] = label(ar, 'لا يمكن مسح هذا البيان ضمن الإجراء الحالي.', 'This field cannot be cleared in the current action.');
        }
    }
    if (considered('name') && !clearing('name') && (!draft.name.trim() || draft.name.trim().length > 200)) errors.name = label(ar, 'اكتب اسمًا من حرف إلى 200 حرف.', 'Enter a name of 1–200 characters.');
    if (considered('description') && !clearing('description') && draft.description.length > 4000) errors.description = label(ar, 'الوصف بحد أقصى 4000 حرف.', 'Description is limited to 4,000 characters.');
    if (considered('sku') && !clearing('sku') && draft.sku.trim().length > 100) errors.sku = label(ar, 'رمز المنتج بحد أقصى 100 حرف.', 'Product code is limited to 100 characters.');
    if (considered('barcodes') && !clearing('barcodes')) {
        const barcodes = parseBarcodes(draft.barcodes);
        if (barcodes.length > 50 || barcodes.some(value => value.length > 100) || new Set(barcodes).size !== barcodes.length) errors.barcodes = label(ar, 'أدخل حتى 50 باركودًا مختلفًا، بحد أقصى 100 حرف لكل منها.', 'Enter up to 50 unique barcodes, at most 100 characters each.');
    }
    if (considered('base_unit') && !clearing('base_unit') && (draft.base_unit || field('base_unit')?.required) && !allowedChoice(units, draft.base_unit)) errors.base_unit = label(ar, 'اختر وحدة متاحة من القائمة الحالية.', 'Choose an available unit from the current list.');
    if (considered('price') && !clearing('price') && (draft.price.amount || draft.price.choice || field('price')?.required)) {
        if (!workspaceDecimalIsValid(draft.price.amount)) errors.price = label(ar, 'اكتب مبلغًا غير سالب، حتى ثلاث خانات عشرية، مثل 25.500.', 'Enter a non-negative amount with up to three decimal places, such as 25.500.');
        else if (!allowedChoice(priceChoices, draft.price.choice)) errors.price = label(ar, 'اختر قائمة السعر والعملة والوحدة المعتمدة من الخيارات المتاحة.', 'Choose an available price list, currency and unit.');
    }
    if (considered('media') && !clearing('media') && (!Array.isArray(draft.media) || draft.media.length > 20
        || new Set(draft.media).size !== draft.media.length || draft.media.some(value => !allowedChoice(mediaChoices, value)))) errors.media = label(ar, 'اختر حتى 20 صورة مسموحة من مكتبة المصدر.', 'Choose up to 20 allowed images from the source library.');
    const empty = key => key === 'price' ? !draft.price.amount && !draft.price.choice
        : key === 'media' ? !draft.media.length : key === 'barcodes' ? !parseBarcodes(draft.barcodes).length : !String(draft[key] ?? '').trim();
    for (const item of fields) {
        if (!PRODUCT_FIELDS.includes(item.key) || clearing(item.key) || !empty(item.key)) continue;
        if (item.required === true && !errors[item.key]) errors[item.key] = label(ar, 'هذا البيان مطلوب للإجراء الحالي.', 'This field is required for the current action.');
        else if (mode === 'change' && changed.includes(item.key) && !errors[item.key]) errors[item.key] = label(ar, 'لمسح القيمة، اختر إجراء المسح الصريح أدناه.', 'To remove a value, choose the explicit clear action below.');
    }
    if (mode === 'change' && changed.length === 0) errors.form = label(ar, 'غيّر بيانًا واحدًا على الأقل قبل المراجعة.', 'Change at least one field before reviewing.');
    return errors;
};

export const workspaceProductSelection = options => {
    if (Object.keys(workspaceProductDraftErrors(options)).length) return null;
    const { draft, fields, mode = 'create', units = [], priceChoices = [], mediaChoices = [], language = 'ar' } = options;
    const ar = language === 'ar';
    const keys = mode === 'create' ? fields.filter(field => field.enabled === true).map(field => field.key) : draft.changedFields;
    const clearFields = [...(draft.clearFields || [])];
    const values = {};
    for (const key of keys) {
        if (clearFields.includes(key)) continue;
        if (['name', 'description', 'sku'].includes(key) && draft[key].trim()) values[key] = draft[key].trim();
        if (key === 'barcodes' && parseBarcodes(draft.barcodes).length) values.barcodes = parseBarcodes(draft.barcodes);
        if (key === 'base_unit' && draft.base_unit) values.base_unit = draft.base_unit;
        if (key === 'price' && (draft.price.amount || draft.price.choice)) values.price = { amount: canonicalWorkspaceDecimal(draft.price.amount), choice: draft.price.choice };
        if (key === 'media' && draft.media.length) values.media = [...draft.media];
    }
    const name = (options, value) => workspaceLabel(options.find(option => option.value === value)?.label, label(ar, 'الاسم غير متاح', 'Name unavailable'));
    const summary = Object.entries(values).map(([key, value]) => ({ key,
        label: workspaceLabel(fields.find(field => field.key === key)?.label, label(ar, 'بيان المنتج', 'Product field')),
        value: key === 'base_unit' ? name(units, value) : key === 'price' ? `${value.amount} · ${name(priceChoices, value.choice)}`
            : key === 'media' ? value.map(item => name(mediaChoices, item)).join(ar ? '، ' : ', ') : Array.isArray(value) ? value.join(ar ? '، ' : ', ') : value,
    }));
    return { values, changedFields: [...keys], clearFields, summary };
};
