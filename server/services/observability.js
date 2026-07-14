import crypto from 'node:crypto';

const SENSITIVE_KEY = /(authorization|cookie|password|passwd|secret|token|api[_-]?key|signed[_-]?request|credential)/i;
const REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;
const startedAt = new Date().toISOString();
const routeMetrics = new Map();
const recentRequestBuckets = new Map();
let totalRequests = 0;
let totalErrors = 0;
let totalDurationMs = 0;

export const redactLogString = value => String(value)
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/((?:access_)?token|secret|password|api[_-]?key)=([^\s&]+)/gi, '$1=[REDACTED]');

export const redactLogData = (value, depth = 0) => {
    if (depth > 5) return '[MAX_DEPTH]';
    if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return value;
    if (typeof value === 'string') return redactLogString(value);
    if (Array.isArray(value)) return value.slice(0, 50).map(item => redactLogData(item, depth + 1));
    if (value instanceof Error) {
        return { name: value.name, code: value.code || null, message: redactLogString(value.message) };
    }
    if (typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => [
            key,
            SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactLogData(item, depth + 1),
        ]));
    }
    return String(value);
};

export const writeLog = (level, event, fields = {}) => {
    const entry = JSON.stringify(redactLogData({
        timestamp: new Date().toISOString(),
        level,
        event,
        ...fields,
    }));
    const stream = level === 'error' ? process.stderr : process.stdout;
    stream.write(`${entry}\n`);
};

export const normalizeMetricPath = pathname => {
    const segments = String(pathname || '/').split('/').filter(Boolean).map(segment => {
        if (/^\d+$/.test(segment)) return ':id';
        if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment)) return ':id';
        if (/^[A-Za-z0-9_-]{24,}$/.test(segment)) return ':id';
        return segment;
    });
    return `/${segments.join('/')}` || '/';
};

const recentWindow = (nowMs, minutes = 5) => {
    const currentMinute = Math.floor(nowMs / 60000);
    const firstMinute = currentMinute - minutes + 1;
    let requests = 0;
    let errors = 0;
    let durationMs = 0;
    for (const [minute, bucket] of recentRequestBuckets) {
        if (minute < firstMinute || minute > currentMinute) continue;
        requests += bucket.requests;
        errors += bucket.errors;
        durationMs += bucket.duration_ms;
    }
    return {
        minutes,
        requests,
        errors,
        error_ratio: requests ? Number((errors / requests).toFixed(4)) : 0,
        average_duration_ms: requests ? Number((durationMs / requests).toFixed(2)) : 0,
    };
};

export const recordRequestMetric = ({ method, path, status, durationMs, timestampMs = Date.now() }) => {
    totalRequests += 1;
    totalDurationMs += durationMs;
    if (status >= 500) totalErrors += 1;
    const key = `${method} ${path}`;
    if (!routeMetrics.has(key) && routeMetrics.size >= 200) return;
    const metric = routeMetrics.get(key) || { requests: 0, errors: 0, duration_ms: 0 };
    metric.requests += 1;
    metric.duration_ms += durationMs;
    if (status >= 500) metric.errors += 1;
    routeMetrics.set(key, metric);

    const minute = Math.floor(timestampMs / 60000);
    const bucket = recentRequestBuckets.get(minute) || { requests: 0, errors: 0, duration_ms: 0 };
    bucket.requests += 1;
    bucket.duration_ms += durationMs;
    if (status >= 500) bucket.errors += 1;
    recentRequestBuckets.set(minute, bucket);
    for (const bucketMinute of recentRequestBuckets.keys()) {
        if (bucketMinute < minute - 10) recentRequestBuckets.delete(bucketMinute);
    }
};

export const requestObservability = (req, res, next) => {
    const incomingId = req.get?.('x-request-id');
    req.requestId = REQUEST_ID.test(incomingId || '') ? incomingId : crypto.randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    const start = process.hrtime.bigint();

    res.once('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
        const metricPath = normalizeMetricPath(req.path);
        recordRequestMetric({ method: req.method, path: metricPath, status: res.statusCode, durationMs });
        writeLog(res.statusCode >= 500 ? 'error' : 'info', 'http_request', {
            request_id: req.requestId,
            method: req.method,
            path: metricPath,
            status: res.statusCode,
            duration_ms: Number(durationMs.toFixed(2)),
            user_id: req.user?.id || null,
            tenant_id: req.user?.tenant_id || null,
        });
    });
    next();
};

export const getMetricsSnapshot = ({ nowMs = Date.now() } = {}) => ({
    started_at: startedAt,
    uptime_seconds: Math.floor(process.uptime()),
    requests_total: totalRequests,
    server_errors_total: totalErrors,
    average_duration_ms: totalRequests ? Number((totalDurationMs / totalRequests).toFixed(2)) : 0,
    window_5m: recentWindow(nowMs, 5),
    routes: Object.fromEntries([...routeMetrics.entries()].map(([key, metric]) => [key, {
        ...metric,
        average_duration_ms: Number((metric.duration_ms / metric.requests).toFixed(2)),
    }])),
});
