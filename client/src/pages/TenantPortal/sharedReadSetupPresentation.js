const SESSION_STATES = new Set(['disconnected', 'authorizing', 'connected', 'unknown', 'expired', 'revoked']);
const ENROLLMENT_STATES = new Set(['unregistered', 'prepared', 'inflight', 'unknown', 'completed', 'failed']);
const nonEmpty = value => typeof value === 'string' && value.length > 0;

export const sharedReadEnrollmentIsValid = value => Boolean(value
    && ENROLLMENT_STATES.has(value.state)
    && typeof value.requires_reconciliation === 'boolean'
    && value.reconciliation_available === false && value.grants_created === false
    && (value.enrollment === null || (nonEmpty(value.enrollment?.enrollment_id)
        && Number.isSafeInteger(value.enrollment.version) && value.enrollment.version > 0))
    && (value.state !== 'completed' || value.enrollment !== null));

export const sharedReadSetupIsValid = document => Boolean(
    document && typeof document.enabled === 'boolean'
    && typeof document.read_ready === 'boolean'
    && document.read_only === true && document.execution_ready === false
    && document.pricing_use_allowed === false
    && SESSION_STATES.has(document.session?.state)
    && (!document.session.expires_at || Number.isFinite(Date.parse(document.session.expires_at)))
    && Array.isArray(document.requests)
    && document.actions && typeof document.actions.authorize === 'boolean'
    && typeof document.actions.disconnect === 'boolean'
    && (document.actions.enroll_consumer === undefined || typeof document.actions.enroll_consumer === 'boolean')
    && (document.actions.bind_reader === undefined || typeof document.actions.bind_reader === 'boolean')
    && (document.enrollment === undefined || sharedReadEnrollmentIsValid(document.enrollment))
);

export const sharedReadSessionLabel = (state, language = 'ar') => ({
    disconnected: language === 'ar' ? 'هوية المستخدم غير مرتبطة بالمركز' : 'Central identity disconnected',
    authorizing: language === 'ar' ? 'بانتظار إكمال ربط الهوية' : 'Identity connection pending',
    connected: language === 'ar' ? 'الهوية مرتبطة؛ لا يمنح ذلك حق القراءة' : 'Identity connected; this does not grant reads',
    unknown: language === 'ar' ? 'حالة جلسة الهوية غير مؤكدة' : 'Identity session state unverified',
    expired: language === 'ar' ? 'انتهت صلاحية جلسة الهوية' : 'Identity session expired',
    revoked: language === 'ar' ? 'سُحبت جلسة الهوية' : 'Identity session revoked',
}[state] || (language === 'ar' ? 'لم تُتحقق حالة الجلسة' : 'Session not verified'));

export const sharedReadCanAuthorize = document => sharedReadSetupIsValid(document)
    && document.enabled === true && document.actions.authorize === true
    && document.session.state !== 'authorizing';

export const sharedReadCanDisconnect = document => sharedReadSetupIsValid(document)
    && document.enabled === true && document.actions.disconnect === true;

export const sharedReadCanEnroll = document => sharedReadSetupIsValid(document)
    && document.enabled === true && document.actions.enroll_consumer === true
    && document.enrollment?.state === 'unregistered'
    && document.enrollment.enrollment === null
    && document.enrollment.requires_reconciliation === false;

export const sharedReadEnrollmentLabel = (state, language = 'ar') => ({
    unregistered: language === 'ar' ? 'لم يُسجل هذا النشاط لدى المركز' : 'This activity is not registered with the center',
    prepared: language === 'ar' ? 'جُهز التسجيل محليًا؛ لم يؤكده المركز بعد' : 'Registration prepared locally; not yet confirmed by the center',
    inflight: language === 'ar' ? 'بانتظار تأكيد التسجيل من المركز؛ لا تُعد الإرسال' : 'Awaiting center registration confirmation; do not resubmit',
    unknown: language === 'ar' ? 'نتيجة التسجيل غير مؤكدة؛ يلزم التحقق قبل إعادة الإرسال' : 'Registration outcome unverified; confirmation is required before resubmitting',
    completed: language === 'ar' ? 'سُجل النشاط لدى المركز؛ لم تُنشأ منح قراءة' : 'Activity registered with the center; no read grants were created',
    failed: language === 'ar' ? 'لم يكتمل تسجيل النشاط؛ لم تُنشأ منح قراءة' : 'Activity registration did not complete; no read grants were created',
}[state] || (language === 'ar' ? 'لم تُتحقق حالة التسجيل' : 'Registration state unverified'));

export const sharedReadDisconnectIsValid = result => Boolean(result
    && result.disconnected === true
    && result.central_read_grant_revoked === false
    && result.source_publisher_key_revoked === false
    && result.read_only === true && result.execution_ready === false
    && result.pricing_use_allowed === false);

export const sharedReadEffectiveSessionState = (document, now = Date.now()) => {
    if (!sharedReadSetupIsValid(document)) return 'unknown';
    if (document.session.state === 'connected' && document.session.expires_at
        && Date.parse(document.session.expires_at) <= now) return 'expired';
    return document.session.state;
};

export const sharedReadAuthorizationUrl = value => {
    if (!nonEmpty(value)) return null;
    try {
        const url = new URL(value);
        const ownedLoopback = url.protocol === 'http:'
            && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
        if (!(url.protocol === 'https:' || ownedLoopback) || url.username || url.password || url.hash) return null;
        if ([...url.searchParams.keys()].some(key => ['access_token', 'refresh_token', 'id_token', 'client_secret', 'password', 'token'].includes(key.toLowerCase()))) return null;
        return url.href;
    } catch { return null; }
};

export const sharedReadSetupError = (error, language = 'ar') => {
    const ar = language === 'ar';
    const code = error?.data?.error?.code || error?.data?.code || error?.code;
    if (code === 'shared_product_reads_disabled') return ar
        ? 'إعداد القراءة غير مفعّل في هذه البيئة. تظل المتطلبات ظاهرة ولا ينشئ الاشتراك أو الدور المحلي منحة في المركز.'
        : 'Read setup is disabled here. Requirements remain visible; a subscription or local role does not create a central grant.';
    if (error?.status === 401 || error?.status === 403) return ar
        ? 'لم تُتحقق صلاحية هذه الجلسة لعرض الإعداد أو تغييره. أُخفيت التفاصيل السابقة؛ اطلب الصلاحية المحددة من المسؤول.'
        : 'This session is not authorized to view or change setup. Prior details are hidden; ask for the specific permission.';
    return ar
        ? 'تعذر تأكيد حالة الإعداد الحالية. لم تُستبدل بمنحة أو موافقة محلية؛ أعد التحقق قبل المتابعة.'
        : 'The current setup could not be verified. No local grant or approval was substituted; check again before continuing.';
};
