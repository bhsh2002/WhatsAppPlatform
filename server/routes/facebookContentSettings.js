import express from 'express';

import { OPENAI_API_KEY, OPENAI_MODEL } from '../config/index.js';
import {
    getEffectiveContentSettings,
    normalizeContentSettingsInput,
    presentContentSettings,
    requireContentPage,
    requireContentTenant,
    sendContentError,
} from './facebookContentStudioShared.js';

export function createFacebookContentSettingsRouter({
    database,
    aiConfigured = () => Boolean(OPENAI_API_KEY),
    aiModel = OPENAI_MODEL,
} = {}) {
    if (!database) throw new TypeError('database is required');
    const router = express.Router();

    router.get('/readiness', (req, res) => {
        try {
            const tenant = requireContentTenant(database, req, res);
            if (!tenant) return;
            const counts = database.prepare(`
                SELECT
                    (SELECT COUNT(*) FROM tenant_pages WHERE tenant_id = ? AND is_active = 1) AS linked_pages,
                    (SELECT COUNT(*) FROM bot_products WHERE tenant_id = ? AND is_active = 1) AS products,
                    (SELECT COUNT(*) FROM facebook_content_items WHERE tenant_id = ? AND status != 'archived') AS content_items,
                    (SELECT COUNT(*) FROM facebook_content_campaigns WHERE tenant_id = ? AND status = 'active') AS active_campaigns,
                    (SELECT COUNT(*) FROM facebook_content_publications WHERE tenant_id = ? AND status = 'failed') AS failed_publications
            `).get(tenant.id, tenant.id, tenant.id, tenant.id, tenant.id);
            res.json({
                ...counts,
                ai: {
                    configured: Boolean(aiConfigured()),
                    model: aiModel,
                },
            });
        } catch (error) {
            sendContentError(res, error, 'فشل فحص جاهزية استوديو المحتوى');
        }
    });

    router.get('/settings', (req, res) => {
        try {
            const tenant = requireContentTenant(database, req, res);
            if (!tenant) return;
            const linkedPageId = req.query.linked_page_id
                ? requireContentPage(database, tenant.id, req.query.linked_page_id).id
                : null;
            const direct = linkedPageId
                ? database.prepare(`
                    SELECT * FROM facebook_content_settings
                    WHERE tenant_id = ? AND linked_page_id = ?
                `).get(tenant.id, linkedPageId)
                : database.prepare(`
                    SELECT * FROM facebook_content_settings
                    WHERE tenant_id = ? AND linked_page_id IS NULL
                `).get(tenant.id);
            res.json({
                settings: getEffectiveContentSettings(database, tenant.id, linkedPageId),
                is_page_override: Boolean(linkedPageId && direct),
                has_tenant_settings: Boolean(database.prepare(`
                    SELECT 1 FROM facebook_content_settings
                    WHERE tenant_id = ? AND linked_page_id IS NULL
                `).get(tenant.id)),
            });
        } catch (error) {
            sendContentError(res, error, 'فشل جلب إعدادات المحتوى');
        }
    });

    router.put('/settings', (req, res) => {
        try {
            const tenant = requireContentTenant(database, req, res);
            if (!tenant) return;
            const linkedPageId = req.body.linked_page_id
                ? requireContentPage(database, tenant.id, req.body.linked_page_id).id
                : null;
            const current = getEffectiveContentSettings(database, tenant.id, linkedPageId);
            const settings = normalizeContentSettingsInput(req.body, current);
            const existing = linkedPageId
                ? database.prepare(`
                    SELECT id FROM facebook_content_settings
                    WHERE tenant_id = ? AND linked_page_id = ?
                `).get(tenant.id, linkedPageId)
                : database.prepare(`
                    SELECT id FROM facebook_content_settings
                    WHERE tenant_id = ? AND linked_page_id IS NULL
                `).get(tenant.id);
            const params = [
                settings.timezone,
                settings.language,
                settings.tone,
                settings.brand_voice,
                settings.audience,
                settings.default_cta,
                JSON.stringify(settings.required_terms),
                JSON.stringify(settings.banned_terms),
                JSON.stringify(settings.hashtags),
                settings.emoji_level,
                settings.approval_mode,
                JSON.stringify(settings.allowed_days),
                settings.posting_start_time,
                settings.posting_end_time,
                settings.daily_post_limit,
                settings.no_repeat_days,
                settings.ai_enabled ? 1 : 0,
                settings.auto_pause_failures,
            ];
            if (existing) {
                database.prepare(`
                    UPDATE facebook_content_settings
                    SET timezone = ?, language = ?, tone = ?, brand_voice = ?, audience = ?,
                        default_cta = ?, required_terms_json = ?, banned_terms_json = ?,
                        hashtags_json = ?, emoji_level = ?, approval_mode = ?,
                        allowed_days_json = ?, posting_start_time = ?, posting_end_time = ?,
                        daily_post_limit = ?, no_repeat_days = ?, ai_enabled = ?,
                        auto_pause_failures = ?, updated_at = datetime('now')
                    WHERE id = ? AND tenant_id = ?
                `).run(...params, existing.id, tenant.id);
            } else {
                database.prepare(`
                    INSERT INTO facebook_content_settings (
                        tenant_id, linked_page_id, timezone, language, tone, brand_voice,
                        audience, default_cta, required_terms_json, banned_terms_json,
                        hashtags_json, emoji_level, approval_mode, allowed_days_json,
                        posting_start_time, posting_end_time, daily_post_limit,
                        no_repeat_days, ai_enabled, auto_pause_failures
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(tenant.id, linkedPageId, ...params);
            }
            const stored = linkedPageId
                ? database.prepare(`
                    SELECT * FROM facebook_content_settings
                    WHERE tenant_id = ? AND linked_page_id = ?
                `).get(tenant.id, linkedPageId)
                : database.prepare(`
                    SELECT * FROM facebook_content_settings
                    WHERE tenant_id = ? AND linked_page_id IS NULL
                `).get(tenant.id);
            res.json({ settings: presentContentSettings(stored), is_page_override: Boolean(linkedPageId) });
        } catch (error) {
            sendContentError(res, error, 'فشل حفظ إعدادات المحتوى');
        }
    });

    router.delete('/settings/pages/:linkedPageId', (req, res) => {
        try {
            const tenant = requireContentTenant(database, req, res);
            if (!tenant) return;
            const page = requireContentPage(database, tenant.id, req.params.linkedPageId);
            database.prepare(`
                DELETE FROM facebook_content_settings
                WHERE tenant_id = ? AND linked_page_id = ?
            `).run(tenant.id, page.id);
            res.json({
                success: true,
                settings: getEffectiveContentSettings(database, tenant.id, page.id),
            });
        } catch (error) {
            sendContentError(res, error, 'فشل حذف إعدادات الصفحة');
        }
    });

    return router;
}
