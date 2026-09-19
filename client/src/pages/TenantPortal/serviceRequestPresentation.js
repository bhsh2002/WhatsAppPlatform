const KIND_LABELS = {
    notification_request: { ar: 'طلب إشعار', en: 'Notification request' },
    campaign_request: { ar: 'طلب حملة', en: 'Campaign request' },
    content_publication: { ar: 'طلب نشر محتوى', en: 'Content publication request' },
    contact_reference: { ar: 'مرجع تواصل', en: 'Contact reference' },
    order_notification: { ar: 'إشعار طلب', en: 'Order notification' },
    campaign: { ar: 'حملة', en: 'Campaign' },
};

const STATUS_LABELS = {
    pending_review: { ar: 'قيد المراجعة', en: 'Pending review' },
    approved: { ar: 'معتمد', en: 'Approved' },
    sent: { ar: 'مرسل', en: 'Sent' },
    dismissed: { ar: 'تم التجاهل', en: 'Dismissed' },
    failed: { ar: 'متعذر', en: 'Failed' },
};

const firstPresent = (...values) => values.find(value => (
    value !== undefined && value !== null && String(value).trim() !== ''
));

const compactText = (value, limit = 140) => {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim();
    return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
};

const channelsText = channels => (
    Array.isArray(channels) ? channels.filter(Boolean).join(', ') : compactText(channels)
);

export const shouldLoadServiceRequests = integration => Boolean(integration?.connection_id);

export const canDismissServiceRequest = request => (
    request?.request_kind === 'notification_request'
    && request?.status === 'pending_review'
);

export const presentServiceRequest = (request, language = 'ar') => {
    const locale = language === 'ar' ? 'ar' : 'en';
    const ar = locale === 'ar';
    const payload = request?.payload && typeof request.payload === 'object'
        ? request.payload
        : {};
    const kind = KIND_LABELS[request?.request_kind]?.[locale]
        || request?.request_kind
        || (ar ? 'طلب خدمة' : 'Service request');
    const status = STATUS_LABELS[request?.status]?.[locale]
        || request?.status
        || (ar ? 'غير معروف' : 'Unknown');
    const details = [];
    const reference = firstPresent(
        payload.order_number,
        payload.order_id,
        payload.campaign_name,
        payload.name,
        payload.request_id,
        request?.request_key,
    );
    const businessStatus = firstPresent(payload.status, payload.order_status);
    const template = firstPresent(payload.template_key, payload.template_name);
    const contentType = firstPresent(payload.content_type, payload.type);
    const content = firstPresent(payload.text, payload.caption, payload.message);
    const channels = channelsText(payload.channels);

    if (reference) details.push(`${ar ? 'المرجع' : 'Reference'}: ${compactText(reference, 80)}`);
    if (businessStatus) details.push(`${ar ? 'الحالة' : 'Status'}: ${compactText(businessStatus, 60)}`);
    if (template) details.push(`${ar ? 'القالب' : 'Template'}: ${compactText(template, 80)}`);
    if (contentType) details.push(`${ar ? 'نوع المحتوى' : 'Content type'}: ${compactText(contentType, 60)}`);
    if (channels) details.push(`${ar ? 'القنوات' : 'Channels'}: ${compactText(channels, 80)}`);
    if (content) details.push(`${ar ? 'المحتوى' : 'Content'}: ${compactText(content)}`);

    return {
        kind,
        status,
        summary: details.join(' • ') || (ar ? 'لا توجد تفاصيل إضافية' : 'No additional details'),
        dismissible: canDismissServiceRequest(request),
    };
};
