const number = value => Number(value || 0);

export function getOperationalSignals(db, metrics) {
    const webhook = db.prepare(`
        SELECT
            COUNT(*) AS unresolved,
            COALESCE(SUM(CASE
                WHEN created_at >= datetime('now', 'localtime', '-15 minutes') THEN 1
                ELSE 0
            END), 0) AS recent
        FROM webhook_failures
        WHERE resolved_at IS NULL
    `).get();

    const broadcast = db.prepare(`
        SELECT
            COALESCE(SUM(CASE
                WHEN status IN ('pending', 'running')
                 AND created_at < datetime('now', 'localtime', '-15 minutes') THEN 1
                ELSE 0
            END), 0) AS stuck,
            COALESCE(SUM(CASE
                WHEN status = 'failed'
                 AND created_at >= datetime('now', 'localtime', '-15 minutes') THEN 1
                ELSE 0
            END), 0) AS recent_failed
        FROM broadcast_jobs
    `).get();

    const tokens = db.prepare(`
        SELECT
            (SELECT COUNT(*) FROM tenants
             WHERE lower(COALESCE(status, 'active')) = 'active'
               AND token_status IN ('invalid', 'expired'))
            +
            (SELECT COUNT(*) FROM tenant_pages
             WHERE COALESCE(is_active, 1) = 1
               AND token_status IN ('invalid', 'expired')) AS unhealthy
    `).get();

    const values = {
        http_requests_5m: number(metrics.window_5m?.requests),
        http_server_errors_5m: number(metrics.window_5m?.errors),
        http_server_error_ratio_5m: number(metrics.window_5m?.error_ratio),
        unresolved_webhook_failures: number(webhook.unresolved),
        recent_webhook_failures_15m: number(webhook.recent),
        stuck_broadcast_jobs: number(broadcast.stuck),
        failed_broadcast_jobs_15m: number(broadcast.recent_failed),
        unhealthy_meta_tokens: number(tokens.unhealthy),
    };

    const alerts = [];
    if (values.http_requests_5m >= 20 && values.http_server_error_ratio_5m >= 0.05) {
        alerts.push({ code: 'HIGH_HTTP_5XX_RATE', severity: 'warning', value: values.http_server_error_ratio_5m, threshold: 0.05 });
    }
    if (values.recent_webhook_failures_15m > 0) {
        alerts.push({ code: 'RECENT_WEBHOOK_FAILURES', severity: values.recent_webhook_failures_15m >= 10 ? 'critical' : 'warning', value: values.recent_webhook_failures_15m, threshold: 1 });
    }
    if (values.stuck_broadcast_jobs > 0) {
        alerts.push({ code: 'STUCK_BROADCAST_JOBS', severity: 'critical', value: values.stuck_broadcast_jobs, threshold: 1 });
    }
    if (values.unhealthy_meta_tokens > 0) {
        alerts.push({ code: 'UNHEALTHY_META_TOKENS', severity: 'warning', value: values.unhealthy_meta_tokens, threshold: 1 });
    }

    return {
        status: alerts.some((alert) => alert.severity === 'critical') ? 'critical' : (alerts.length ? 'warning' : 'ok'),
        values,
        alerts,
        checked_at: new Date().toISOString(),
    };
}

export function renderPrometheusMetrics(metrics, operational) {
    const values = operational.values;
    const lines = [
        '# HELP whatsapp_process_uptime_seconds Process uptime in seconds.',
        '# TYPE whatsapp_process_uptime_seconds gauge',
        `whatsapp_process_uptime_seconds ${number(metrics.uptime_seconds)}`,
        '# HELP whatsapp_http_requests_total HTTP requests since process start.',
        '# TYPE whatsapp_http_requests_total counter',
        `whatsapp_http_requests_total ${number(metrics.requests_total)}`,
        '# HELP whatsapp_http_server_errors_total HTTP 5xx responses since process start.',
        '# TYPE whatsapp_http_server_errors_total counter',
        `whatsapp_http_server_errors_total ${number(metrics.server_errors_total)}`,
        '# HELP whatsapp_http_requests_5m HTTP requests in the current five-minute window.',
        '# TYPE whatsapp_http_requests_5m gauge',
        `whatsapp_http_requests_5m ${values.http_requests_5m}`,
        '# HELP whatsapp_http_server_errors_5m HTTP 5xx responses in the current five-minute window.',
        '# TYPE whatsapp_http_server_errors_5m gauge',
        `whatsapp_http_server_errors_5m ${values.http_server_errors_5m}`,
        '# HELP whatsapp_http_server_error_ratio_5m Ratio of 5xx responses in the current five-minute window.',
        '# TYPE whatsapp_http_server_error_ratio_5m gauge',
        `whatsapp_http_server_error_ratio_5m ${values.http_server_error_ratio_5m}`,
        '# HELP whatsapp_webhook_failures_unresolved Unresolved webhook delivery failures.',
        '# TYPE whatsapp_webhook_failures_unresolved gauge',
        `whatsapp_webhook_failures_unresolved ${values.unresolved_webhook_failures}`,
        '# HELP whatsapp_webhook_failures_15m New unresolved webhook failures in the last 15 minutes.',
        '# TYPE whatsapp_webhook_failures_15m gauge',
        `whatsapp_webhook_failures_15m ${values.recent_webhook_failures_15m}`,
        '# HELP whatsapp_broadcast_jobs_stuck Broadcast jobs pending or running for over 15 minutes.',
        '# TYPE whatsapp_broadcast_jobs_stuck gauge',
        `whatsapp_broadcast_jobs_stuck ${values.stuck_broadcast_jobs}`,
        '# HELP whatsapp_broadcast_jobs_failed_15m Broadcast jobs failed in the last 15 minutes.',
        '# TYPE whatsapp_broadcast_jobs_failed_15m gauge',
        `whatsapp_broadcast_jobs_failed_15m ${values.failed_broadcast_jobs_15m}`,
        '# HELP whatsapp_meta_tokens_unhealthy Active tenant or page tokens known invalid or expired.',
        '# TYPE whatsapp_meta_tokens_unhealthy gauge',
        `whatsapp_meta_tokens_unhealthy ${values.unhealthy_meta_tokens}`,
        '',
    ];
    return lines.join('\n');
}
