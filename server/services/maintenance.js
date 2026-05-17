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
export function cleanupExpiredData() {
    let cleaned = 0;

    // 1. Webhook logs older than 90 days
    const webhookResult = db.prepare(
        "DELETE FROM webhook_logs WHERE created_at < datetime('now', '-90 days')"
    ).run();
    cleaned += webhookResult.changes;

    // 2. Activity logs older than 180 days
    const activityResult = db.prepare(
        "DELETE FROM activity_logs WHERE created_at < datetime('now', '-180 days')"
    ).run();
    cleaned += activityResult.changes;

    // 3. Expired revoked tokens (no longer needed after JWT expiry)
    const tokenResult = db.prepare(
        "DELETE FROM revoked_tokens WHERE expires_at < datetime('now', 'localtime')"
    ).run();
    cleaned += tokenResult.changes;

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
