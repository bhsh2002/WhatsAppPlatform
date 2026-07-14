import express from 'express';
import db from '../db/database.js';
import { validateAutomationPattern } from '../services/automationPatterns.js';
import { parseListPagination } from '../services/pagination.js';

const router = express.Router();

const findOwnedRule = (ruleId, tenantId) => db.prepare(
    'SELECT * FROM automation_rules WHERE id = ? AND tenant_id = ?'
).get(ruleId, tenantId);

router.get('/rules', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const { rule_type, channel, is_active } = req.query;
        const { limit, offset } = parseListPagination(req.query, {
            defaultLimit: 100,
            maxLimit: 200,
        });

        let query = 'SELECT * FROM automation_rules WHERE tenant_id = ?';
        const params = [tenantId];

        if (rule_type) {
            query += ' AND rule_type = ?';
            params.push(rule_type);
        }
        if (channel) {
            query += ' AND channel = ?';
            params.push(channel);
        }
        if (is_active !== undefined) {
            query += ' AND is_active = ?';
            params.push(is_active === 'true' ? 1 : 0);
        }

        query += ' ORDER BY priority ASC, id ASC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        res.json(db.prepare(query).all(...params));
    } catch (error) {
        console.error('[TenantAutomation] List rules error:', error);
        res.status(500).json({ error: 'فشل جلب القواعد' });
    }
});

router.get('/rules/:id', (req, res) => {
    try {
        const rule = findOwnedRule(req.params.id, req.user.tenant_id);
        if (!rule) return res.status(404).json({ error: 'القاعدة غير موجودة' });
        res.json(rule);
    } catch (error) {
        console.error('[TenantAutomation] Get rule error:', error);
        res.status(500).json({ error: 'فشل جلب القاعدة' });
    }
});

router.post('/rules', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const {
            name, rule_type, channel, is_active, priority,
            match_type, match_pattern, match_case_sensitive,
            schedule_days, schedule_start_time, schedule_end_time, schedule_timezone,
            response_type, response_text,
            response_template_name, response_template_language,
            cooldown_seconds,
            target_post_id, target_page_id, response_action, dm_text, trigger_on,
            auto_like, auto_like_type,
        } = req.body;

        if (!name || !rule_type) {
            return res.status(400).json({ error: 'الاسم ونوع القاعدة مطلوبان' });
        }

        if (!['keyword', 'welcome', 'away', 'comment_reply'].includes(rule_type)) {
            return res.status(400).json({ error: 'نوع القاعدة غير صالح' });
        }

        const matchError = validateAutomationPattern({
            ruleType: rule_type,
            matchType: match_type,
            matchPattern: match_pattern,
        });
        if (matchError) return res.status(400).json({ error: matchError });

        if (rule_type === 'away' && (!schedule_days || !schedule_start_time || !schedule_end_time)) {
            return res.status(400).json({ error: 'جدول المواعيد مطلوب لقواعد خارج الدوام' });
        }

        if (rule_type === 'comment_reply' && !response_text && !dm_text) {
            return res.status(400).json({ error: 'نص الرد أو نص الرسالة الخاصة مطلوب' });
        }

        if (response_type !== 'template' && !response_text && rule_type !== 'comment_reply') {
            return res.status(400).json({ error: 'نص الرد مطلوب' });
        }

        const result = db.prepare(`
            INSERT INTO automation_rules (
                tenant_id, name, rule_type, channel,
                is_active, priority,
                match_type, match_pattern, match_case_sensitive,
                schedule_days, schedule_start_time, schedule_end_time, schedule_timezone,
                response_type, response_text,
                response_template_name, response_template_language,
                cooldown_seconds,
                target_post_id, target_page_id, response_action, dm_text, trigger_on,
                auto_like, auto_like_type
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            tenantId,
            name,
            rule_type,
            channel || (rule_type === 'comment_reply' ? 'facebook' : 'all'),
            is_active !== undefined ? (is_active ? 1 : 0) : 1,
            priority || 100,
            match_type || null,
            match_pattern || null,
            match_case_sensitive ? 1 : 0,
            schedule_days ? (typeof schedule_days === 'string' ? schedule_days : JSON.stringify(schedule_days)) : null,
            schedule_start_time || null,
            schedule_end_time || null,
            schedule_timezone || 'Africa/Tripoli',
            response_type || 'text',
            response_text || null,
            response_template_name || null,
            response_template_language || 'ar',
            cooldown_seconds !== undefined ? cooldown_seconds : 300,
            target_post_id || null,
            target_page_id || null,
            response_action || 'comment',
            dm_text || null,
            trigger_on || 'comment',
            auto_like ? 1 : 0,
            auto_like_type || 'like',
        );

        const newRule = db.prepare('SELECT * FROM automation_rules WHERE id = ?').get(result.lastInsertRowid);
        res.status(201).json(newRule);
    } catch (error) {
        console.error('[TenantAutomation] Create rule error:', error);
        res.status(500).json({ error: 'فشل إنشاء القاعدة' });
    }
});

router.put('/rules/:id', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const existing = findOwnedRule(req.params.id, tenantId);
        if (!existing) return res.status(404).json({ error: 'القاعدة غير موجودة' });

        const {
            name, rule_type, channel, is_active, priority,
            match_type, match_pattern, match_case_sensitive,
            schedule_days, schedule_start_time, schedule_end_time, schedule_timezone,
            response_type, response_text,
            response_template_name, response_template_language,
            cooldown_seconds,
            target_post_id, target_page_id, response_action, dm_text, trigger_on,
            auto_like, auto_like_type,
        } = req.body;

        const matchError = validateAutomationPattern({
            ruleType: rule_type || existing.rule_type,
            matchType: match_type !== undefined ? match_type : existing.match_type,
            matchPattern: match_pattern !== undefined ? match_pattern : existing.match_pattern,
        });
        if (matchError) return res.status(400).json({ error: matchError });

        db.prepare(`
            UPDATE automation_rules SET
                name = ?,
                rule_type = ?,
                channel = ?,
                is_active = ?,
                priority = ?,
                match_type = ?,
                match_pattern = ?,
                match_case_sensitive = ?,
                schedule_days = ?,
                schedule_start_time = ?,
                schedule_end_time = ?,
                schedule_timezone = ?,
                response_type = ?,
                response_text = ?,
                response_template_name = ?,
                response_template_language = ?,
                cooldown_seconds = ?,
                target_post_id = ?,
                target_page_id = ?,
                response_action = ?,
                dm_text = ?,
                trigger_on = ?,
                auto_like = ?,
                auto_like_type = ?,
                updated_at = datetime('now', 'localtime')
            WHERE id = ? AND tenant_id = ?
        `).run(
            name || existing.name,
            rule_type || existing.rule_type,
            channel || existing.channel,
            is_active !== undefined ? (is_active ? 1 : 0) : existing.is_active,
            priority !== undefined ? priority : existing.priority,
            match_type !== undefined ? match_type : existing.match_type,
            match_pattern !== undefined ? match_pattern : existing.match_pattern,
            match_case_sensitive !== undefined ? (match_case_sensitive ? 1 : 0) : existing.match_case_sensitive,
            schedule_days !== undefined
                ? (typeof schedule_days === 'string' ? schedule_days : JSON.stringify(schedule_days))
                : existing.schedule_days,
            schedule_start_time !== undefined ? schedule_start_time : existing.schedule_start_time,
            schedule_end_time !== undefined ? schedule_end_time : existing.schedule_end_time,
            schedule_timezone !== undefined ? schedule_timezone : existing.schedule_timezone,
            response_type !== undefined ? response_type : existing.response_type,
            response_text !== undefined ? response_text : existing.response_text,
            response_template_name !== undefined ? response_template_name : existing.response_template_name,
            response_template_language !== undefined ? response_template_language : existing.response_template_language,
            cooldown_seconds !== undefined ? cooldown_seconds : existing.cooldown_seconds,
            target_post_id !== undefined ? (target_post_id || null) : existing.target_post_id,
            target_page_id !== undefined ? (target_page_id || null) : existing.target_page_id,
            response_action !== undefined ? response_action : existing.response_action,
            dm_text !== undefined ? (dm_text || null) : existing.dm_text,
            trigger_on !== undefined ? trigger_on : (existing.trigger_on || 'comment'),
            auto_like !== undefined ? (auto_like ? 1 : 0) : (existing.auto_like || 0),
            auto_like_type !== undefined ? auto_like_type : (existing.auto_like_type || 'like'),
            req.params.id,
            tenantId,
        );

        res.json(db.prepare('SELECT * FROM automation_rules WHERE id = ?').get(req.params.id));
    } catch (error) {
        console.error('[TenantAutomation] Update rule error:', error);
        res.status(500).json({ error: 'فشل تحديث القاعدة' });
    }
});

router.patch('/rules/:id/toggle', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const rule = findOwnedRule(req.params.id, tenantId);
        if (!rule) return res.status(404).json({ error: 'القاعدة غير موجودة' });

        const newState = rule.is_active ? 0 : 1;
        db.prepare(`
            UPDATE automation_rules
            SET is_active = ?, updated_at = datetime('now')
            WHERE id = ? AND tenant_id = ?
        `).run(newState, req.params.id, tenantId);

        res.json({ id: rule.id, is_active: newState });
    } catch (error) {
        console.error('[TenantAutomation] Toggle rule error:', error);
        res.status(500).json({ error: 'فشل تبديل حالة القاعدة' });
    }
});

router.delete('/rules/:id', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const rule = findOwnedRule(req.params.id, tenantId);
        if (!rule) return res.status(404).json({ error: 'القاعدة غير موجودة' });

        db.prepare('DELETE FROM automation_rules WHERE id = ? AND tenant_id = ?').run(req.params.id, tenantId);
        res.json({ success: true });
    } catch (error) {
        console.error('[TenantAutomation] Delete rule error:', error);
        res.status(500).json({ error: 'فشل حذف القاعدة' });
    }
});

router.get('/rules/:id/stats', (req, res) => {
    try {
        const rule = findOwnedRule(req.params.id, req.user.tenant_id);
        if (!rule) return res.status(404).json({ error: 'القاعدة غير موجودة' });

        const recentCooldowns = db.prepare(`
            SELECT contact_id, channel, last_triggered_at
            FROM automation_cooldowns
            WHERE rule_id = ?
            ORDER BY last_triggered_at DESC
            LIMIT 20
        `).all(req.params.id);

        res.json({
            rule_id: rule.id,
            trigger_count: rule.trigger_count,
            last_triggered_at: rule.last_triggered_at,
            recent_contacts: recentCooldowns,
        });
    } catch (error) {
        console.error('[TenantAutomation] Rule stats error:', error);
        res.status(500).json({ error: 'فشل جلب الإحصائيات' });
    }
});

router.get('/summary', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const total = db.prepare(
            'SELECT COUNT(*) as count FROM automation_rules WHERE tenant_id = ?'
        ).get(tenantId).count;
        const active = db.prepare(
            'SELECT COUNT(*) as count FROM automation_rules WHERE tenant_id = ? AND is_active = 1'
        ).get(tenantId).count;
        const keywords = db.prepare(`
            SELECT COUNT(*) as count FROM automation_rules
            WHERE tenant_id = ? AND rule_type = 'keyword' AND is_active = 1
        `).get(tenantId).count;
        const totalTriggers = db.prepare(
            'SELECT COALESCE(SUM(trigger_count), 0) as count FROM automation_rules WHERE tenant_id = ?'
        ).get(tenantId).count;
        const weekTriggers = db.prepare(`
            SELECT COALESCE(SUM(trigger_count), 0) as count FROM automation_rules
            WHERE tenant_id = ? AND last_triggered_at >= datetime('now', '-7 days')
        `).get(tenantId).count;

        res.json({ total, active, keywords, weekTriggers, totalTriggers });
    } catch (error) {
        console.error('[TenantAutomation] Summary error:', error);
        res.status(500).json({ error: 'فشل جلب الملخص' });
    }
});

export default router;
