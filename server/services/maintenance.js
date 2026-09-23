import db from '../db/database.js';
import fs from 'fs';
import path from 'path';
import { startTokenHealthScheduler } from './tokenMonitor.js';

// ============================================
// Maintenance Service — Data Retention & Cleanup
// ============================================

/**
 * Clean up expired data across all tables with retention policies.
 * Should be run on startup and periodically (every 24h).
 */
export function cleanupExpiredData(database = db) {
    let cleaned = 0;

    // 1. Webhook logs older than 90 days
    const webhookResult = database.prepare(
        "DELETE FROM webhook_logs WHERE created_at < datetime('now', '-90 days')"
    ).run();
    cleaned += webhookResult.changes;

    // 2. Activity logs older than 180 days
    const activityResult = database.prepare(
        "DELETE FROM activity_logs WHERE created_at < datetime('now', '-180 days')"
    ).run();
    cleaned += activityResult.changes;

    // 3. Meta review evidence snapshots older than 180 days
    const metaReviewResult = database.prepare(
        "DELETE FROM meta_review_checks WHERE created_at < datetime('now', '-180 days')"
    ).run();
    cleaned += metaReviewResult.changes;

    // 4. Expired revoked tokens (no longer needed after JWT expiry)
    const tokenResult = database.prepare(
        "DELETE FROM revoked_tokens WHERE expires_at < datetime('now', 'localtime')"
    ).run();
    cleaned += tokenResult.changes;

    // 5. Keep a finite replay window without removing in-flight API requests.
    const smsApiResult = database.prepare(`
        DELETE FROM sms_api_requests
        WHERE status IN ('accepted', 'failed')
          AND datetime(updated_at) < datetime('now', '-90 days')
    `).run();
    cleaned += smsApiResult.changes;

    // 6. Callback bodies may contain message content. Keep active deliveries,
    // successful diagnostics for 30 days, and dead letters for 180 days.
    const callbackResult = database.prepare(`
        DELETE FROM tenant_api_callback_outbox
        WHERE (
            status = 'delivered'
            AND datetime(delivered_at) < datetime('now', '-30 days')
        ) OR (
            status = 'dead_letter'
            AND datetime(updated_at) < datetime('now', '-180 days')
        )
    `).run();
    cleaned += callbackResult.changes;

    // 7. Browser-push event payloads are metadata-only, but source hashes and
    // delivery history still have a finite diagnostic lifetime. Active events
    // remain intact so an outage cannot silently discard queued work.
    const pushEventResult = database.prepare(`
        DELETE FROM web_push_events
        WHERE status IN ('delivered', 'no_recipients', 'partial', 'failed')
          AND datetime(COALESCE(completed_at, created_at)) < datetime('now', '-90 days')
    `).run();
    cleaned += pushEventResult.changes;

    // 8. A subscription cannot be used after its authenticating session has
    // expired. Cascading its remaining deliveries is safe because dispatch
    // would reject the same subscription as ineligible.
    const pushSubscriptionResult = database.prepare(`
        DELETE FROM web_push_subscriptions
        WHERE session_expires_at <= CAST(strftime('%s', 'now') AS INTEGER)
    `).run();
    cleaned += pushSubscriptionResult.changes;

    // Cascading subscription deletion can remove one or all deliveries. Close
    // every event that no longer has active work, including mixed sets of
    // delivered/skipped/dead-letter rows, so retention can eventually prune it.
    database.prepare(`
        UPDATE web_push_events
        SET status = CASE
                WHEN NOT EXISTS (
                    SELECT 1 FROM web_push_deliveries
                    WHERE web_push_deliveries.event_id = web_push_events.id
                ) THEN 'no_recipients'
                WHEN NOT EXISTS (
                    SELECT 1 FROM web_push_deliveries
                    WHERE web_push_deliveries.event_id = web_push_events.id
                      AND status IN ('delivered', 'dead_letter')
                ) THEN 'no_recipients'
                WHEN NOT EXISTS (
                    SELECT 1 FROM web_push_deliveries
                    WHERE web_push_deliveries.event_id = web_push_events.id
                      AND status != 'delivered'
                ) THEN 'delivered'
                WHEN EXISTS (
                    SELECT 1 FROM web_push_deliveries
                    WHERE web_push_deliveries.event_id = web_push_events.id
                      AND status = 'delivered'
                ) THEN 'partial'
                ELSE 'failed'
            END,
            completed_at = datetime('now')
        WHERE status = 'pending'
          AND NOT EXISTS (
              SELECT 1 FROM web_push_deliveries
              WHERE web_push_deliveries.event_id = web_push_events.id
                AND status IN ('pending', 'processing', 'failed')
          )
    `).run();

    // 9. Resolved operational-alert state only prevents duplicate transitions
    // for a bounded period. Never remove a currently firing state.
    const alertStateResult = database.prepare(`
        DELETE FROM web_push_alert_states
        WHERE is_active = 0
          AND datetime(updated_at) < datetime('now', '-90 days')
    `).run();
    cleaned += alertStateResult.changes;

    if (cleaned > 0) {
        console.log(`[Maintenance] Cleaned up ${cleaned} expired records`);
    }

    return cleaned;
}

/**
 * Clean up orphaned upload files that don't correspond to any message.
 * @param {string} uploadDir - Path to the uploads directory
 */
export function cleanupOrphanedFiles(uploadDir) {
    if (!uploadDir || !fs.existsSync(uploadDir)) return 0;

    try {
        const files = fs.readdirSync(uploadDir);
        let removed = 0;
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours

        for (const file of files) {
            const filePath = path.join(uploadDir, file);
            const stats = fs.statSync(filePath);
            if (!stats.isFile()) continue;

            // Remove temp files older than 24 hours
            if (Date.now() - stats.mtimeMs > maxAge) {
                fs.unlinkSync(filePath);
                removed++;
            }
        }

        if (removed > 0) {
            console.log(`[Maintenance] Removed ${removed} orphaned upload files`);
        }
        return removed;
    } catch (e) {
        console.error('[Maintenance] File cleanup error:', e.message);
        return 0;
    }
}

/**
 * Start the periodic maintenance scheduler.
 * Runs cleanup every 24 hours.
 */
export function startMaintenanceScheduler(uploadDir) {
    // Run once on startup (after a short delay to not block boot)
    setTimeout(() => {
        cleanupExpiredData();
        cleanupOrphanedFiles(uploadDir);
    }, 5000);

    // Then every 24 hours
    const interval = setInterval(() => {
        cleanupExpiredData();
        cleanupOrphanedFiles(uploadDir);
    }, 24 * 60 * 60 * 1000);

    // Don't prevent process exit
    interval.unref();

    // Start token health monitoring (6-hour interval)
    startTokenHealthScheduler();

    return interval;
}
