import express from 'express';
import { buildNodePreview } from '../services/messengerBot.js';
import { parseListPagination } from '../services/pagination.js';
import {
    parseJson,
    requireTenant,
    serializeJson,
    toInt,
    validateLinkedPage,
} from './messengerBotShared.js';

const VALID_NODE_TYPES = new Set(['text', 'quick_replies', 'product_list', 'product_detail', 'service_menu', 'handoff', 'end']);
const VALID_TRIGGERS = new Set(['welcome', 'keyword', 'postback', 'fallback', 'menu']);
const VALID_FLOW_STATUSES = new Set(['draft', 'active', 'paused']);

export function createMessengerBotFlowsRouter({
    database,
    previewBuilder = buildNodePreview,
} = {}) {
    if (!database) throw new TypeError('database is required');
    const router = express.Router();

    const normalizeNodePayload = (node = {}, index = 0) => {
        const nodeType = VALID_NODE_TYPES.has(node.node_type) ? node.node_type : 'text';
        return {
            node_key: String(node.node_key || (index === 0 ? 'start' : `step_${index + 1}`)).trim()
                || (index === 0 ? 'start' : `step_${index + 1}`),
            node_type: nodeType,
            title: String(node.title || '').trim() || null,
            body: String(node.body || '').trim() || null,
            config_json: serializeJson(node.config || parseJson(node.config_json, {})),
            sort_order: toInt(node.sort_order, index),
        };
    };

    const normalizeFlowPayload = (body = {}) => {
        const triggerType = VALID_TRIGGERS.has(body.trigger_type) ? body.trigger_type : 'keyword';
        const status = VALID_FLOW_STATUSES.has(body.status) ? body.status : 'draft';
        const rawNodes = Array.isArray(body.nodes) && body.nodes.length > 0
            ? body.nodes
            : [body.node || body];

        return {
            flow: {
                linked_page_id: body.linked_page_id ? toInt(body.linked_page_id) : null,
                name: String(body.name || '').trim(),
                trigger_type: triggerType,
                trigger_value: String(body.trigger_value || '').trim() || null,
                priority: Math.max(toInt(body.priority, 100), 1),
                status,
                description: String(body.description || '').trim() || null,
            },
            nodes: rawNodes.map((node, index) => normalizeNodePayload(node, index)),
        };
    };

    const getFlowWithNode = (flowId, tenantId) => {
        const flow = database.prepare(`
            SELECT *
            FROM bot_flows
            WHERE id = ? AND tenant_id = ?
            LIMIT 1
        `).get(flowId, tenantId);
        if (!flow) return null;
        const nodes = database.prepare(
            'SELECT * FROM bot_flow_nodes WHERE flow_id = ? ORDER BY sort_order ASC, id ASC',
        ).all(flow.id);
        return { ...flow, nodes, node: nodes.find(node => node.node_key === 'start') || nodes[0] || null };
    };

    const replaceFlowNodes = (flowId, nodes) => {
        const normalizedNodes = nodes.length > 0 ? nodes : [normalizeNodePayload({}, 0)];
        const hasStart = normalizedNodes.some(node => node.node_key === 'start');
        if (!hasStart) normalizedNodes[0] = { ...normalizedNodes[0], node_key: 'start' };

        database.prepare('DELETE FROM bot_flow_nodes WHERE flow_id = ?').run(flowId);
        const insert = database.prepare(`
            INSERT INTO bot_flow_nodes (flow_id, node_key, node_type, title, body, config_json, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const node of normalizedNodes) {
            insert.run(flowId, node.node_key, node.node_type, node.title, node.body, node.config_json, node.sort_order);
        }
    };

    const normalizeTriggerValue = flow => {
        if (['welcome', 'fallback', 'menu'].includes(flow.trigger_type)) return '';
        return String(flow.trigger_value || '').trim().toLowerCase();
    };

    const getNodeActions = (config = {}) => {
        const actions = [];
        const candidates = [
            ...(Array.isArray(config.quick_replies) ? config.quick_replies : []),
            ...(Array.isArray(config.items) ? config.items : []),
        ];
        for (const item of candidates) {
            actions.push({
                title: String(item?.title || '').trim(),
                action: String(item?.action || '').trim(),
                payload: String(item?.payload || '').trim(),
            });
        }
        return actions;
    };

    const getFlowDiagnostics = (flow, nodes, tenantId) => {
        const warnings = [];
        const errors = [];
        const startNode = nodes.find(node => node.node_key === 'start');
        const hasProductListNode = nodes.some(node => node.node_type === 'product_list');

        if (!flow.name) errors.push('اسم المسار مطلوب.');
        if (!startNode) errors.push('يجب وجود خطوة start.');
        if (flow.status === 'active' && flow.linked_page_id
            && !validateLinkedPage(database, tenantId, flow.linked_page_id)) {
            errors.push('الصفحة المحددة غير مفعلة أو غير موجودة.');
        }
        if (flow.status === 'active' && flow.trigger_type === 'keyword' && !String(flow.trigger_value || '').trim()) {
            errors.push('المسار النشط بالكلمة المفتاحية يحتاج كلمة أو أكثر.');
        }
        if (flow.status === 'active' && flow.trigger_type === 'postback' && !String(flow.trigger_value || '').trim()) {
            errors.push('مسار postback النشط يحتاج payload واضح.');
        }

        const activePages = database.prepare(
            'SELECT COUNT(*) AS count FROM tenant_pages WHERE tenant_id = ? AND is_active = 1',
        ).get(tenantId)?.count || 0;
        if (activePages === 0) warnings.push('لا توجد صفحات Messenger مفعلة لهذا العميل.');

        for (const node of nodes) {
            const config = parseJson(node.config_json, {});
            const nodeActions = getNodeActions(config);
            if (node.node_type === 'quick_replies'
                && (!Array.isArray(config.quick_replies) || config.quick_replies.length === 0)) {
                warnings.push(`الخطوة ${node.node_key} من نوع Quick Replies بدون أزرار.`);
            }
            if (node.node_type === 'service_menu'
                && (!Array.isArray(config.items) || config.items.length === 0)) {
                warnings.push(`الخطوة ${node.node_key} من نوع قائمة خدمات بدون عناصر.`);
            }
            for (const action of nodeActions) {
                const opensProducts = action.action === 'products'
                    || action.payload === 'BOT:PRODUCTS'
                    || action.payload.startsWith('BOT:PRODUCTS:');
                if (opensProducts && !hasProductListNode) {
                    warnings.push(`الخطوة ${node.node_key} تحتوي زر "${action.title || 'المنتجات'}" يستخدم اختصار فتح المنتجات بدون خطوة قائمة منتجات قابلة للتحكم.`);
                }
            }
            if (node.node_type === 'product_list') {
                const params = [tenantId];
                let categoryClause = '';
                if (config.category) {
                    categoryClause = 'AND LOWER(category) = LOWER(?)';
                    params.push(config.category);
                }
                const count = database.prepare(`
                    SELECT COUNT(*) AS count
                    FROM bot_products
                    WHERE tenant_id = ?
                      AND is_active = 1
                      AND availability = 'available'
                      ${categoryClause}
                `).get(...params)?.count || 0;
                if (count === 0) warnings.push(`الخطوة ${node.node_key} تعرض منتجات لكن لا توجد منتجات متاحة مطابقة.`);
            }
        }

        const conflicts = database.prepare(`
            SELECT id, name, trigger_type, trigger_value, linked_page_id, priority, status
            FROM bot_flows
            WHERE tenant_id = ?
              AND id != ?
              AND status = 'active'
              AND trigger_type = ?
              AND LOWER(COALESCE(trigger_value, '')) = ?
              AND COALESCE(linked_page_id, 0) = COALESCE(?, 0)
              AND priority = ?
            ORDER BY priority ASC, id ASC
        `).all(
            tenantId,
            flow.id || 0,
            flow.trigger_type,
            normalizeTriggerValue(flow),
            flow.linked_page_id || null,
            flow.priority || 100,
        );

        if (conflicts.length > 0) warnings.push('يوجد مسار نشط آخر بنفس المشغل والصفحة والأولوية.');
        return { ready: errors.length === 0, warnings, errors, conflicts };
    };

    const attachFlowDiagnostics = (flow, tenantId) => {
        const nodes = flow.nodes || database.prepare(
            'SELECT * FROM bot_flow_nodes WHERE flow_id = ? ORDER BY sort_order ASC, id ASC',
        ).all(flow.id);
        const diagnostics = getFlowDiagnostics(flow, nodes, tenantId);
        return {
            ...flow,
            nodes,
            node: nodes.find(node => node.node_key === 'start') || nodes[0] || null,
            nodes_count: nodes.length,
            diagnostics,
            warnings: diagnostics.warnings,
            errors: diagnostics.errors,
            conflicts: diagnostics.conflicts,
        };
    };

    router.get('/flows', (req, res) => {
        try {
            const tenant = requireTenant(database, req, res);
            if (!tenant) return;
            const { limit, offset } = parseListPagination(req.query, { defaultLimit: 100, maxLimit: 200 });
            const flows = database.prepare(`
                SELECT f.*, tp.page_name,
                       n.node_type, n.body, n.config_json
                FROM bot_flows f
                LEFT JOIN tenant_pages tp ON tp.id = f.linked_page_id
                LEFT JOIN bot_flow_nodes n ON n.flow_id = f.id AND n.node_key = 'start'
                WHERE f.tenant_id = ?
                ORDER BY f.status = 'active' DESC, f.priority ASC, f.id DESC
                LIMIT ? OFFSET ?
            `).all(tenant.id, limit, offset);
            res.json(flows.map(flow => attachFlowDiagnostics(flow, tenant.id)));
        } catch (error) {
            console.error('[MessengerBot] Flows list error:', error);
            res.status(500).json({ error: 'فشل جلب مسارات البوت' });
        }
    });

    router.get('/flows/:id', (req, res) => {
        try {
            const tenant = requireTenant(database, req, res);
            if (!tenant) return;
            const flow = getFlowWithNode(req.params.id, tenant.id);
            if (!flow) return res.status(404).json({ error: 'المسار غير موجود' });
            res.json(attachFlowDiagnostics(flow, tenant.id));
        } catch (error) {
            console.error('[MessengerBot] Flow get error:', error);
            res.status(500).json({ error: 'فشل جلب المسار' });
        }
    });

    router.post('/flows', (req, res) => {
        try {
            const tenant = requireTenant(database, req, res);
            if (!tenant) return;
            const { flow, nodes } = normalizeFlowPayload(req.body);
            if (!flow.name) return res.status(400).json({ error: 'اسم المسار مطلوب' });
            if (flow.linked_page_id && !validateLinkedPage(database, tenant.id, flow.linked_page_id)) {
                return res.status(400).json({ error: 'صفحة فيسبوك غير صالحة لهذا العميل' });
            }
            const diagnostics = getFlowDiagnostics({ ...flow, id: 0 }, nodes, tenant.id);
            if (flow.status === 'active' && diagnostics.errors.length > 0) {
                return res.status(400).json({ error: 'لا يمكن تفعيل المسار قبل معالجة الأخطاء', diagnostics });
            }

            const tx = database.transaction(() => {
                const result = database.prepare(`
                    INSERT INTO bot_flows (
                        tenant_id, linked_page_id, name, trigger_type, trigger_value,
                        priority, status, description
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    tenant.id,
                    flow.linked_page_id,
                    flow.name,
                    flow.trigger_type,
                    flow.trigger_value,
                    flow.priority,
                    flow.status,
                    flow.description,
                );
                replaceFlowNodes(result.lastInsertRowid, nodes);
                return attachFlowDiagnostics(getFlowWithNode(result.lastInsertRowid, tenant.id), tenant.id);
            });
            res.status(201).json(tx());
        } catch (error) {
            console.error('[MessengerBot] Flow create error:', error);
            res.status(500).json({ error: 'فشل إنشاء مسار البوت' });
        }
    });

    router.put('/flows/:id', (req, res) => {
        try {
            const tenant = requireTenant(database, req, res);
            if (!tenant) return;
            const existing = getFlowWithNode(req.params.id, tenant.id);
            if (!existing) return res.status(404).json({ error: 'المسار غير موجود' });

            const { flow, nodes } = normalizeFlowPayload({
                ...existing,
                node: existing.node,
                nodes: existing.nodes,
                ...req.body,
            });
            if (!flow.name) return res.status(400).json({ error: 'اسم المسار مطلوب' });
            if (flow.linked_page_id && !validateLinkedPage(database, tenant.id, flow.linked_page_id)) {
                return res.status(400).json({ error: 'صفحة فيسبوك غير صالحة لهذا العميل' });
            }
            const diagnostics = getFlowDiagnostics({ ...flow, id: existing.id }, nodes, tenant.id);
            if (flow.status === 'active' && diagnostics.errors.length > 0) {
                return res.status(400).json({ error: 'لا يمكن تفعيل المسار قبل معالجة الأخطاء', diagnostics });
            }

            const tx = database.transaction(() => {
                database.prepare(`
                    UPDATE bot_flows
                    SET linked_page_id = ?, name = ?, trigger_type = ?, trigger_value = ?,
                        priority = ?, status = ?, description = ?,
                        updated_at = datetime('now', 'localtime')
                    WHERE id = ? AND tenant_id = ?
                `).run(
                    flow.linked_page_id,
                    flow.name,
                    flow.trigger_type,
                    flow.trigger_value,
                    flow.priority,
                    flow.status,
                    flow.description,
                    req.params.id,
                    tenant.id,
                );
                replaceFlowNodes(req.params.id, nodes);
                return attachFlowDiagnostics(getFlowWithNode(req.params.id, tenant.id), tenant.id);
            });
            res.json(tx());
        } catch (error) {
            console.error('[MessengerBot] Flow update error:', error);
            res.status(500).json({ error: 'فشل تحديث مسار البوت' });
        }
    });

    router.patch('/flows/:id/toggle', (req, res) => {
        try {
            const tenant = requireTenant(database, req, res);
            if (!tenant) return;
            const existing = getFlowWithNode(req.params.id, tenant.id);
            if (!existing) return res.status(404).json({ error: 'المسار غير موجود' });
            const nextStatus = existing.status === 'active' ? 'paused' : 'active';
            if (nextStatus === 'active') {
                const diagnostics = getFlowDiagnostics({ ...existing, status: 'active' }, existing.nodes || [], tenant.id);
                if (diagnostics.errors.length > 0) {
                    return res.status(400).json({ error: 'لا يمكن تفعيل المسار قبل معالجة الأخطاء', diagnostics });
                }
            }
            database.prepare(`
                UPDATE bot_flows
                SET status = ?, updated_at = datetime('now', 'localtime')
                WHERE id = ? AND tenant_id = ?
            `).run(nextStatus, req.params.id, tenant.id);
            res.json(attachFlowDiagnostics(getFlowWithNode(req.params.id, tenant.id), tenant.id));
        } catch (error) {
            console.error('[MessengerBot] Flow toggle error:', error);
            res.status(500).json({ error: 'فشل تغيير حالة المسار' });
        }
    });

    router.delete('/flows/:id', (req, res) => {
        try {
            const tenant = requireTenant(database, req, res);
            if (!tenant) return;
            const result = database.prepare('DELETE FROM bot_flows WHERE id = ? AND tenant_id = ?')
                .run(req.params.id, tenant.id);
            if (result.changes === 0) return res.status(404).json({ error: 'المسار غير موجود' });
            res.json({ success: true });
        } catch (error) {
            console.error('[MessengerBot] Flow delete error:', error);
            res.status(500).json({ error: 'فشل حذف المسار' });
        }
    });

    router.post('/flows/:id/test', (req, res) => {
        try {
            const tenant = requireTenant(database, req, res);
            if (!tenant) return;
            const flow = getFlowWithNode(req.params.id, tenant.id);
            if (!flow) return res.status(404).json({ error: 'المسار غير موجود' });
            res.json({ flow_id: flow.id, preview: previewBuilder(flow.node || {}, tenant.id) });
        } catch (error) {
            console.error('[MessengerBot] Flow test error:', error);
            res.status(500).json({ error: 'فشل اختبار المسار' });
        }
    });

    router.get('/flows/:id/events', (req, res) => {
        try {
            const tenant = requireTenant(database, req, res);
            if (!tenant) return;
            const flow = getFlowWithNode(req.params.id, tenant.id);
            if (!flow) return res.status(404).json({ error: 'المسار غير موجود' });
            const limit = Math.min(Math.max(toInt(req.query.limit, 50), 1), 200);
            const events = database.prepare(`
                SELECT be.*, fc.user_name, fc.user_psid, tp.page_name
                FROM bot_events be
                LEFT JOIN fb_conversations fc ON fc.id = be.conversation_id
                LEFT JOIN tenant_pages tp ON tp.id = be.linked_page_id
                WHERE be.tenant_id = ?
                  AND (
                    json_extract(be.payload_json, '$.flow_id') = ?
                    OR be.session_id IN (
                        SELECT id FROM bot_sessions WHERE active_flow_id = ? AND tenant_id = ?
                    )
                  )
                ORDER BY be.created_at DESC, be.id DESC
                LIMIT ?
            `).all(tenant.id, flow.id, flow.id, tenant.id, limit);
            res.json(events);
        } catch (error) {
            console.error('[MessengerBot] Flow events error:', error);
            res.status(500).json({ error: 'فشل جلب سجل المسار' });
        }
    });

    return router;
}
