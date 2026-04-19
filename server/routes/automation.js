import express from 'express';
import db from '../db/database.js';
import { testRules } from '../services/autoResponder.js';

const router = express.Router();

// ============================================
// GET /rules — List all automation rules
// ============================================
router.get('/rules', (req, res) => {
    try {
        const { tenant_id, rule_type, channel, is_active } = req.query;

        let query = 'SELECT ar.*, t.name as tenant_name FROM automation_rules ar LEFT JOIN tenants t ON t.id = ar.tenant_id WHERE 1=1';
        const params = [];

        if (tenant_id) {
            if (tenant_id === 'global') {
                query += ' AND ar.tenant_id IS NULL';
            } else {
                query += ' AND ar.tenant_id = ?';
                params.push(tenant_id);
            }
        }
        if (rule_type) {
            query += ' AND ar.rule_type = ?';
            params.push(rule_type);
        }
        if (channel) {
            query += ' AND ar.channel = ?';
            params.push(channel);
        }
        if (is_active !== undefined) {
            query += ' AND ar.is_active = ?';
            params.push(is_active === 'true' ? 1 : 0);
        }

        query += ' ORDER BY ar.priority ASC, ar.id ASC';

        const rules = db.prepare(query).all(...params);
        res.json(rules);
    } catch (error) {
        console.error('[Automation] List rules error:', error);
        res.status(500).json({ error: 'فشل جلب القواعد' });
    }
});

// ============================================
// GET /rules/:id — Get single rule
// ============================================
router.get('/rules/:id', (req, res) => {
    try {
        const rule = db.prepare(
            'SELECT ar.*, t.name as tenant_name FROM automation_rules ar LEFT JOIN tenants t ON t.id = ar.tenant_id WHERE ar.id = ?'
        ).get(req.params.id);

        if (!rule) return res.status(404).json({ error: 'القاعدة غير موجودة' });
        res.json(rule);
    } catch (error) {
        console.error('[Automation] Get rule error:', error);
        res.status(500).json({ error: 'فشل جلب القاعدة' });
    }
});

// ============================================
// POST /rules — Create rule
// ============================================
router.post('/rules', (req, res) => {
    try {
        const {
            tenant_id, name, rule_type, channel,
            is_active, priority,
            match_type, match_pattern, match_case_sensitive,
            schedule_days, schedule_start_time, schedule_end_time, schedule_timezone,
            response_type, response_text,
            response_template_name, response_template_language,
            cooldown_seconds,
            target_post_id, target_page_id, response_action, dm_text, trigger_on,
        } = req.body;

        if (!name || !rule_type) {
            return res.status(400).json({ error: 'الاسم ونوع القاعدة مطلوبان' });
        }

        if (!['keyword', 'welcome', 'away', 'comment_reply'].includes(rule_type)) {
            return res.status(400).json({ error: 'نوع القاعدة غير صالح' });
        }

        if (rule_type === 'keyword' && (!match_type || !match_pattern)) {
            return res.status(400).json({ error: 'نمط المطابقة مطلوب لقواعد الكلمات المفتاحية' });
        }

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
                target_post_id, target_page_id, response_action, dm_text, trigger_on
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            tenant_id || null,
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
        );

        const newRule = db.prepare('SELECT * FROM automation_rules WHERE id = ?').get(result.lastInsertRowid);
        res.status(201).json(newRule);
    } catch (error) {
        console.error('[Automation] Create rule error:', error);
        res.status(500).json({ error: 'فشل إنشاء القاعدة' });
    }
});

// ============================================
// PUT /rules/:id — Update rule
// ============================================
router.put('/rules/:id', (req, res) => {
    try {
        const existing = db.prepare('SELECT * FROM automation_rules WHERE id = ?').get(req.params.id);
        if (!existing) return res.status(404).json({ error: 'القاعدة غير موجودة' });

        const {
            tenant_id, name, rule_type, channel,
            is_active, priority,
            match_type, match_pattern, match_case_sensitive,
            schedule_days, schedule_start_time, schedule_end_time, schedule_timezone,
            response_type, response_text,
            response_template_name, response_template_language,
            cooldown_seconds,
            target_post_id, target_page_id, response_action, dm_text, trigger_on,
        } = req.body;

        db.prepare(`
            UPDATE automation_rules SET
                tenant_id = ?,
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
                updated_at = datetime('now')
            WHERE id = ?
        `).run(
            tenant_id !== undefined ? (tenant_id || null) : existing.tenant_id,
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
            req.params.id,
        );

        const updated = db.prepare('SELECT * FROM automation_rules WHERE id = ?').get(req.params.id);
        res.json(updated);
    } catch (error) {
        console.error('[Automation] Update rule error:', error);
        res.status(500).json({ error: 'فشل تحديث القاعدة' });
    }
});

// ============================================
// PATCH /rules/:id/toggle — Enable/disable rule
// ============================================
router.patch('/rules/:id/toggle', (req, res) => {
    try {
        const rule = db.prepare('SELECT * FROM automation_rules WHERE id = ?').get(req.params.id);
        if (!rule) return res.status(404).json({ error: 'القاعدة غير موجودة' });

        const newState = rule.is_active ? 0 : 1;
        db.prepare('UPDATE automation_rules SET is_active = ?, updated_at = datetime(\'now\') WHERE id = ?')
            .run(newState, req.params.id);

        res.json({ id: rule.id, is_active: newState });
    } catch (error) {
        console.error('[Automation] Toggle rule error:', error);
        res.status(500).json({ error: 'فشل تبديل حالة القاعدة' });
    }
});

// ============================================
// DELETE /rules/:id — Delete rule
// ============================================
router.delete('/rules/:id', (req, res) => {
    try {
        const rule = db.prepare('SELECT * FROM automation_rules WHERE id = ?').get(req.params.id);
        if (!rule) return res.status(404).json({ error: 'القاعدة غير موجودة' });

        db.prepare('DELETE FROM automation_rules WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (error) {
        console.error('[Automation] Delete rule error:', error);
        res.status(500).json({ error: 'فشل حذف القاعدة' });
    }
});

// ============================================
// GET /rules/:id/stats — Get rule trigger stats
// ============================================
router.get('/rules/:id/stats', (req, res) => {
    try {
        const rule = db.prepare('SELECT * FROM automation_rules WHERE id = ?').get(req.params.id);
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
        console.error('[Automation] Rule stats error:', error);
        res.status(500).json({ error: 'فشل جلب الإحصائيات' });
    }
});

// ============================================
// POST /test — Simulate rule matching (dry-run)
// ============================================
router.post('/test', (req, res) => {
    try {
        const { channel, tenant_id, contact_id, message_text, is_new_contact } = req.body;

        if (!message_text && !is_new_contact) {
            return res.status(400).json({ error: 'نص الرسالة أو حالة جهة اتصال جديدة مطلوبة' });
        }

        const result = testRules({
            channel: channel || 'whatsapp',
            tenant_id: tenant_id || null,
            contact_id: contact_id || 'test_contact',
            message_text: message_text || '',
            is_new_contact: !!is_new_contact,
        });

        res.json(result);
    } catch (error) {
        console.error('[Automation] Test error:', error);
        res.status(500).json({ error: 'فشل اختبار القواعد' });
    }
});

// ============================================
// GET /summary — Quick stats for dashboard
// ============================================
router.get('/summary', (req, res) => {
    try {
        const total = db.prepare('SELECT COUNT(*) as count FROM automation_rules').get().count;
        const active = db.prepare('SELECT COUNT(*) as count FROM automation_rules WHERE is_active = 1').get().count;
        const keywords = db.prepare('SELECT COUNT(*) as count FROM automation_rules WHERE rule_type = \'keyword\' AND is_active = 1').get().count;
        const weekTriggers = db.prepare(`
            SELECT COALESCE(SUM(trigger_count), 0) as count FROM automation_rules
            WHERE last_triggered_at >= datetime('now', '-7 days')
        `).get().count;

        // Sum all triggers (not just last week)
        const totalTriggers = db.prepare('SELECT COALESCE(SUM(trigger_count), 0) as count FROM automation_rules').get().count;

        res.json({ total, active, keywords, weekTriggers, totalTriggers });
    } catch (error) {
        console.error('[Automation] Summary error:', error);
        res.status(500).json({ error: 'فشل جلب الملخص' });
    }
});

export default router;
