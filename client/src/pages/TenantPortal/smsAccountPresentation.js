const MANAGED_MODE = 'managed';

const STATUS_PRESENTATION = Object.freeze({
    active: { label: 'متصل', color: 'success' },
    online: { label: 'متصل', color: 'success' },
    ready: { label: 'جاهز', color: 'success' },
    pending: { label: 'قيد التجهيز', color: 'warning' },
    connecting: { label: 'جارٍ الاتصال', color: 'warning' },
    degraded: { label: 'يحتاج متابعة', color: 'warning' },
    error: { label: 'متعذّر', color: 'error' },
    offline: { label: 'غير متصل', color: 'error' },
    disabled: { label: 'معطّل', color: 'default' },
    unknown: { label: 'غير معروفة', color: 'default' },
});

const cleanText = value => String(value ?? '').trim();

const normalizedStatus = value => {
    if (value === true) return 'online';
    if (value === false) return 'offline';
    return cleanText(value).toLowerCase() || 'unknown';
};

export const smsStatusPresentation = value => {
    const status = normalizedStatus(value);
    return STATUS_PRESENTATION[status] || {
        label: cleanText(value) || STATUS_PRESENTATION.unknown.label,
        color: 'default',
    };
};

export const isManagedSmsAccount = account => (
    account?.managed === true || cleanText(account?.management_mode).toLowerCase() === MANAGED_MODE
);

export const managedSmsResources = account => {
    const resources = account?.managed_resources || {};
    const rawDevices = Array.isArray(resources.devices) ? resources.devices : [];
    const fallbackStatus = resources.device_status || account?.device_status || null;
    const devices = rawDevices.map(device => {
        const name = cleanText(device?.name || device?.display_name);
        const model = cleanText(device?.model);
        const rawStatus = device?.status ?? device?.state ?? device?.online ?? fallbackStatus;
        const status = rawStatus == null
            ? { label: 'مُعيّن للحساب', color: 'default' }
            : smsStatusPresentation(rawStatus);
        return {
            name: name || model || 'جهاز SMS مُدار',
            model: name && model && model !== name ? model : '',
            status,
        };
    });

    const rawSim = resources.sim || null;
    if (!rawSim) return { devices, sim: null };
    const name = cleanText(rawSim.name || rawSim.display_name);
    const carrier = cleanText(rawSim.carrier || rawSim.operator);
    const number = cleanText(rawSim.number || rawSim.phone_number);
    return {
        devices,
        sim: {
            name: name || carrier || 'شريحة SMS',
            carrier: name && carrier && carrier !== name ? carrier : '',
            number,
        },
    };
};

export const normalizeSmsSummary = summary => Object.fromEntries(
    ['pending', 'sent', 'delivered', 'failed', 'canceled', 'received', 'total_outgoing']
        .map(key => {
            const number = Number(summary?.[key]);
            return [key, Number.isFinite(number) && number > 0 ? number : 0];
        })
);

export const canRequestSmsStats = ({ range, from, to }) => {
    if (range !== 'custom') return true;
    return Boolean(from && to && from <= to);
};
