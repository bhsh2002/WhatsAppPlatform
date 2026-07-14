import express from 'express';
import db from '../db/database.js';
import { getMetricsSnapshot } from '../services/observability.js';
import { getOperationalSignals, renderPrometheusMetrics } from '../services/operationalHealth.js';

const router = express.Router();

const present = (value) => !!String(value || '').trim();

const callbackUrl = () => {
    if (present(process.env.META_WEBHOOK_CALLBACK_URL)) {
        return {
            value: process.env.META_WEBHOOK_CALLBACK_URL,
            source: 'META_WEBHOOK_CALLBACK_URL',
        };
    }

    const publicUrl = process.env.PUBLIC_BASE_URL || process.env.APP_URL || '';
    if (present(publicUrl)) {
        return {
            value: `${publicUrl.replace(/\/$/, '')}/api/webhook`,
            source: 'PUBLIC_BASE_URL',
        };
    }

    return {
        value: '/api/webhook',
        source: 'relative',
    };
};

router.get('/system-status', (req, res) => {
    const webhook = callbackUrl();

    res.json({
        status: 'ok',
        node_env: process.env.NODE_ENV || 'development',
        meta: {
            app_id_present: present(process.env.META_APP_ID || process.env.FB_APP_ID),
            app_secret_present: present(process.env.META_APP_SECRET || process.env.FB_APP_SECRET),
            webhook_callback_url: webhook.value,
            webhook_callback_url_source: webhook.source,
        },
        security: {
            webhook_verify_token_present: present(process.env.WEBHOOK_VERIFY_TOKEN),
            jwt_secret_present: present(process.env.JWT_SECRET),
            jwt_secret_min_length_ok: String(process.env.JWT_SECRET || '').length >= 32,
            crypto_key_present: present(process.env.CRYPTO_KEY),
            crypto_key_length_ok: String(process.env.CRYPTO_KEY || '').length >= 64,
        },
        urls: {
            privacy_policy: '/privacy',
            terms: '/terms',
            data_deletion: '/data-deletion',
        },
        cors_origins_configured: present(process.env.CORS_ORIGINS),
        checked_at: new Date().toISOString(),
    });
});

router.get('/metrics', (req, res) => {
    const metrics = getMetricsSnapshot();
    res.json({ ...metrics, operational: getOperationalSignals(db, metrics) });
});

router.get('/metrics/prometheus', (req, res) => {
    const metrics = getMetricsSnapshot();
    const operational = getOperationalSignals(db, metrics);
    res.type('text/plain; version=0.0.4; charset=utf-8').send(renderPrometheusMetrics(metrics, operational));
});

router.get('/alerts', (req, res) => {
    const metrics = getMetricsSnapshot();
    res.json(getOperationalSignals(db, metrics));
});

export default router;
