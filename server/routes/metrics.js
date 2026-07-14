import express from 'express';

import db from '../db/database.js';
import { getMetricsSnapshot } from '../services/observability.js';
import { getOperationalSignals, renderPrometheusMetrics } from '../services/operationalHealth.js';

const router = express.Router();

router.get('/', (req, res) => {
    const metrics = getMetricsSnapshot();
    const operational = getOperationalSignals(db, metrics);
    res.type('text/plain; version=0.0.4; charset=utf-8').send(renderPrometheusMetrics(metrics, operational));
});

export default router;
