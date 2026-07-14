import express from 'express';
import { parseListPagination } from '../services/pagination.js';
import { requireTenant } from './messengerBotShared.js';

const VALID_SESSION_STATUSES = new Set(['active', 'handoff', 'closed']);

export function createMessengerBotSessionsRouter({ database } = {}) {
    if (!database) throw new TypeError('database is required');
    const router = express.Router();

    router.get('/sessions', (req, res) => {
        try {
            const tenant = requireTenant(database, req, res);
            if (!tenant) return;
            const { linked_page_id, conversation_id, status } = req.query;
            const { limit, offset } = parseListPagination(req.query, {
                defaultLimit: 100,
                maxLimit: 200,
                maxOffset: 5000,
            });
            const clauses = ['s.tenant_id = ?'];
            const params = [tenant.id];
            if (linked_page_id) {
                clauses.push('s.linked_page_id = ?');
                params.push(linked_page_id);
            }
            if (conversation_id) {
                clauses.push('s.conversation_id = ?');
                params.push(conversation_id);
            }
            if (status && VALID_SESSION_STATUSES.has(status)) {
                clauses.push('s.status = ?');
                params.push(status);
            }

            const sessions = database.prepare(`
                SELECT s.*, fc.user_name, fc.user_profile_pic, fc.last_message, fc.last_message_time,
                       tp.page_name, f.name AS flow_name
                FROM bot_sessions s
                LEFT JOIN fb_conversations fc ON fc.id = s.conversation_id
                LEFT JOIN tenant_pages tp ON tp.id = s.linked_page_id
                LEFT JOIN bot_flows f ON f.id = s.active_flow_id
                WHERE ${clauses.join(' AND ')}
                ORDER BY s.updated_at DESC
                LIMIT ? OFFSET ?
            `).all(...params, limit, offset);
            res.json(sessions);
        } catch (error) {
            console.error('[MessengerBot] Sessions list error:', error);
            res.status(500).json({ error: 'فشل جلب جلسات البوت' });
        }
    });

    router.patch('/sessions/:id', (req, res) => {
        try {
            const tenant = requireTenant(database, req, res);
            if (!tenant) return;
            const status = String(req.body.status || '').trim();
            if (!VALID_SESSION_STATUSES.has(status)) {
                return res.status(400).json({ error: 'حالة الجلسة غير صالحة' });
            }
            const existing = database.prepare('SELECT * FROM bot_sessions WHERE id = ? AND tenant_id = ?')
                .get(req.params.id, tenant.id);
            if (!existing) return res.status(404).json({ error: 'جلسة البوت غير موجودة' });

            database.prepare(`
                UPDATE bot_sessions
                SET status = ?, updated_at = datetime('now', 'localtime')
                WHERE id = ? AND tenant_id = ?
            `).run(status, req.params.id, tenant.id);
            res.json(database.prepare('SELECT * FROM bot_sessions WHERE id = ?').get(req.params.id));
        } catch (error) {
            console.error('[MessengerBot] Session update error:', error);
            res.status(500).json({ error: 'فشل تحديث جلسة البوت' });
        }
    });

    return router;
}
