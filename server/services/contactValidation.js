import { normalizePhone } from './whatsappEvents.js';

export const CONTACT_LIMITS = Object.freeze({
    phoneMin: 7,
    phoneMax: 15,
    profileName: 200,
    label: 64,
    notes: 2000,
    search: 200,
});

export class InvalidContactError extends Error {
    constructor(message) {
        super(message);
        this.name = 'InvalidContactError';
        this.code = 'INVALID_CONTACT';
    }
}

const normalizeOptionalText = (value, fieldName, maxLength) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value !== 'string') {
        throw new InvalidContactError(`${fieldName} يجب أن يكون نصًا`);
    }

    const normalized = value.trim();
    if (normalized.length > maxLength) {
        throw new InvalidContactError(`${fieldName} يجب ألا يتجاوز ${maxLength} حرفًا`);
    }
    return normalized || null;
};

export const normalizeContactPhone = value => {
    if (typeof value !== 'string') {
        throw new InvalidContactError('رقم الهاتف مطلوب كنص');
    }
    const phone = normalizePhone(value);
    if (phone.length < CONTACT_LIMITS.phoneMin || phone.length > CONTACT_LIMITS.phoneMax) {
        throw new InvalidContactError(
            `رقم الهاتف يجب أن يحتوي بين ${CONTACT_LIMITS.phoneMin} و${CONTACT_LIMITS.phoneMax} رقمًا`
        );
    }
    return phone;
};

export const normalizeContactCreate = (body = {}) => ({
    phone: normalizeContactPhone(body.phone),
    profileName: normalizeOptionalText(body.profile_name, 'اسم جهة الاتصال', CONTACT_LIMITS.profileName),
    label: normalizeOptionalText(body.label, 'التصنيف', CONTACT_LIMITS.label),
    notes: normalizeOptionalText(body.notes, 'الملاحظات', CONTACT_LIMITS.notes),
});

export const normalizeContactUpdate = (body = {}) => {
    const label = normalizeOptionalText(body.label, 'التصنيف', CONTACT_LIMITS.label);
    const notes = normalizeOptionalText(body.notes, 'الملاحظات', CONTACT_LIMITS.notes);
    if (label === undefined && notes === undefined) {
        throw new InvalidContactError('أرسل التصنيف أو الملاحظات لتحديث جهة الاتصال');
    }
    return { label, notes };
};

export const normalizeAdminContactUpdate = (body = {}) => {
    const label = normalizeOptionalText(body.label, 'التصنيف', CONTACT_LIMITS.label);
    const notes = normalizeOptionalText(body.notes, 'الملاحظات', CONTACT_LIMITS.notes);
    const profileName = normalizeOptionalText(
        body.profile_name,
        'اسم جهة الاتصال',
        CONTACT_LIMITS.profileName,
    );
    if (label === undefined && notes === undefined && profileName === undefined) {
        throw new InvalidContactError('أرسل اسم جهة الاتصال أو التصنيف أو الملاحظات للتحديث');
    }
    return { label, notes, profileName };
};

export const normalizeContactFilters = (query = {}) => ({
    search: normalizeOptionalText(query.search, 'البحث', CONTACT_LIMITS.search),
    label: normalizeOptionalText(query.label, 'التصنيف', CONTACT_LIMITS.label),
});

export const parseContactId = value => {
    const normalized = typeof value === 'number' ? value : Number(String(value));
    if (!Number.isSafeInteger(normalized) || normalized <= 0 || !/^\d+$/.test(String(value))) {
        throw new InvalidContactError('معرف جهة الاتصال غير صالح');
    }
    return normalized;
};
