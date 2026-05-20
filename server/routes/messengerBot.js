import express from 'express';
import fs from 'fs';
import db from '../db/database.js';
import { botImageUpload, generalUpload as upload, cleanupFile } from '../config/upload.js';
import { META_WEBHOOK_CALLBACK_URL } from '../config/index.js';
import { buildNodePreview } from '../services/messengerBot.js';

const router = express.Router();

const VALID_NODE_TYPES = new Set(['text', 'quick_replies', 'product_list', 'product_detail', 'service_menu', 'handoff', 'end']);
const VALID_TRIGGERS = new Set(['welcome', 'keyword', 'postback', 'fallback', 'menu']);
const VALID_FLOW_STATUSES = new Set(['draft', 'active', 'paused']);
const VALID_SESSION_STATUSES = new Set(['active', 'handoff', 'closed']);

function toInt(value, fallback = null) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) ? parsed : fallback;
}

function parseJson(value, fallback = {}) {
    if (!value) return fallback;
    try {
        return typeof value === 'string' ? JSON.parse(value) : value;
    } catch {
        return fallback;
    }
}

function serializeJson(value) {
    try {
        return JSON.stringify(value ?? {});
    } catch {
        return JSON.stringify({ unparseable: true });
    }
}

function resolvePublicApiBase(req) {
    if (META_WEBHOOK_CALLBACK_URL) {
        return META_WEBHOOK_CALLBACK_URL.replace(/\/webhook\/?$/i, '').replace(/\/$/, '');
    }
    const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
    const host = req.get('x-forwarded-host') || req.get('host');
    return `${proto}://${host}`;
}

function resolveTenantId(req) {
    if (req.user?.role === 'admin') {
        return toInt(req.query.tenant_id ?? req.body?.tenant_id, null);
    }
    return req.user?.tenant_id || null;
}

function requireTenant(req, res) {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
        res.status(400).json({ error: 'tenant_id مطلوب' });
        return null;
    }
    const tenant = db.prepare('SELECT id, name FROM tenants WHERE id = ?').get(tenantId);
    if (!tenant) {
        res.status(404).json({ error: 'العميل غير موجود' });
        return null;
    }
    return tenant;
}

function validateLinkedPage(tenantId, linkedPageId) {
    if (!linkedPageId) return null;
    return db.prepare('SELECT id, page_id, page_name FROM tenant_pages WHERE id = ? AND tenant_id = ? AND is_active = 1')
        .get(linkedPageId, tenantId);
}

function normalizeProductPayload(body = {}) {
    const imageUrl = String(body.image_url || '').trim() || null;
    return {
        sku: String(body.sku || '').trim() || null,
        name: String(body.name || '').trim(),
        description: String(body.description || '').trim() || null,
        price: Number(body.price || 0) || 0,
        currency: String(body.currency || 'LYD').trim().toUpperCase() || 'LYD',
        image_url: imageUrl,
        product_url: String(body.product_url || '').trim() || null,
        category: String(body.category || '').trim() || null,
        availability: ['available', 'out_of_stock', 'hidden'].includes(body.availability) ? body.availability : 'available',
        is_active: body.is_active === false || body.is_active === 0 || body.is_active === '0' ? 0 : 1,
        images: normalizeProductImages(body.images, imageUrl),
    };
}

function normalizeProductImages(images = [], fallbackImageUrl = null) {
    const rows = Array.isArray(images) ? images : [];
    const normalized = [];
    const seen = new Set();

    const addImage = (value, index = normalized.length) => {
        const image = typeof value === 'string' ? { image_url: value } : (value || {});
        const imageUrl = String(image.image_url || image.url || '').trim();
        if (!imageUrl || seen.has(imageUrl)) return;
        seen.add(imageUrl);
        normalized.push({
            image_url: imageUrl,
            alt_text: String(image.alt_text || image.alt || '').trim() || null,
            sort_order: toInt(image.sort_order, index) ?? index,
            is_primary: image.is_primary === true || image.is_primary === 1 || image.is_primary === '1' ? 1 : 0,
        });
    };

    rows.forEach(addImage);
    if (fallbackImageUrl) addImage({ image_url: fallbackImageUrl, is_primary: normalized.length === 0 ? 1 : 0 }, normalized.length);
    if (normalized.length > 0 && !normalized.some(image => image.is_primary)) normalized[0].is_primary = 1;
    return normalized.map((image, index) => ({ ...image, sort_order: index, is_primary: index === 0 ? 1 : 0 }));
}

function getProductImages(productId) {
    return db.prepare(`
        SELECT id, image_url, alt_text, sort_order, is_primary
        FROM bot_product_images
        WHERE product_id = ?
        ORDER BY is_primary DESC, sort_order ASC, id ASC
    `).all(productId);
}

function attachProductImages(product) {
    if (!product) return product;
    const images = getProductImages(product.id);
    return {
        ...product,
        images,
        image_url: images[0]?.image_url || product.image_url || null,
    };
}

function attachProductsImages(products = []) {
    if (!products.length) return products;
    const placeholders = products.map(() => '?').join(', ');
    const images = db.prepare(`
        SELECT id, product_id, image_url, alt_text, sort_order, is_primary
        FROM bot_product_images
        WHERE product_id IN (${placeholders})
        ORDER BY is_primary DESC, sort_order ASC, id ASC
    `).all(...products.map(product => product.id));
    const byProduct = new Map();
    for (const image of images) {
        if (!byProduct.has(image.product_id)) byProduct.set(image.product_id, []);
        byProduct.get(image.product_id).push(image);
    }
    return products.map(product => {
        const productImages = byProduct.get(product.id) || [];
        return {
            ...product,
            images: productImages,
            image_url: productImages[0]?.image_url || product.image_url || null,
        };
    });
}

function replaceProductImages(productId, tenantId, images = []) {
    db.prepare('DELETE FROM bot_product_images WHERE product_id = ? AND tenant_id = ?').run(productId, tenantId);
    if (!images.length) return;
    const insert = db.prepare(`
        INSERT INTO bot_product_images (tenant_id, product_id, image_url, alt_text, sort_order, is_primary)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    images.forEach((image, index) => {
        insert.run(
            tenantId,
            productId,
            image.image_url,
            image.alt_text,
            index,
            index === 0 ? 1 : 0
        );
    });
}

function normalizeFlowPayload(body = {}) {
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
}

function normalizeNodePayload(node = {}, index = 0) {
    const nodeType = VALID_NODE_TYPES.has(node.node_type) ? node.node_type : 'text';
    return {
        node_key: String(node.node_key || (index === 0 ? 'start' : `step_${index + 1}`)).trim() || (index === 0 ? 'start' : `step_${index + 1}`),
        node_type: nodeType,
        title: String(node.title || '').trim() || null,
        body: String(node.body || '').trim() || null,
        config_json: serializeJson(node.config || parseJson(node.config_json, {})),
        sort_order: toInt(node.sort_order, index),
    };
}

function parseCsvLine(line) {
    const cells = [];
    let current = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        const next = line[i + 1];
        if (char === '"' && quoted && next === '"') {
            current += '"';
            i += 1;
        } else if (char === '"') {
            quoted = !quoted;
        } else if (char === ',' && !quoted) {
            cells.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    cells.push(current.trim());
    return cells;
}

function parseProductsCsv(text) {
    const lines = String(text || '').split(/\r?\n/).filter(line => line.trim());
    if (lines.length < 2) return [];
    const headers = parseCsvLine(lines[0]).map(header => header.trim().toLowerCase());
    return lines.slice(1).map(line => {
        const cells = parseCsvLine(line);
        const row = {};
        headers.forEach((header, index) => {
            row[header] = cells[index] || '';
        });
        return normalizeProductPayload(row);
    }).filter(product => product.name);
}

function getFlowWithNode(flowId, tenantId) {
    const flow = db.prepare(`
        SELECT *
        FROM bot_flows
        WHERE id = ? AND tenant_id = ?
        LIMIT 1
    `).get(flowId, tenantId);
    if (!flow) return null;
    const nodes = db.prepare('SELECT * FROM bot_flow_nodes WHERE flow_id = ? ORDER BY sort_order ASC, id ASC').all(flow.id);
    return { ...flow, nodes, node: nodes.find(node => node.node_key === 'start') || nodes[0] || null };
}

function replaceFlowNodes(flowId, nodes) {
    const normalizedNodes = nodes.length > 0 ? nodes : [normalizeNodePayload({}, 0)];
    const hasStart = normalizedNodes.some(node => node.node_key === 'start');
    if (!hasStart) {
        normalizedNodes[0] = { ...normalizedNodes[0], node_key: 'start' };
    }

    db.prepare('DELETE FROM bot_flow_nodes WHERE flow_id = ?').run(flowId);
    const insert = db.prepare(`
        INSERT INTO bot_flow_nodes (flow_id, node_key, node_type, title, body, config_json, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const node of normalizedNodes) {
        insert.run(flowId, node.node_key, node.node_type, node.title, node.body, node.config_json, node.sort_order);
    }
}

function normalizeTriggerValue(flow) {
    if (['welcome', 'fallback', 'menu'].includes(flow.trigger_type)) return '';
    return String(flow.trigger_value || '').trim().toLowerCase();
}

function getFlowDiagnostics(flow, nodes, tenantId) {
    const warnings = [];
    const errors = [];
    const startNode = nodes.find(node => node.node_key === 'start');

    if (!flow.name) errors.push('اسم المسار مطلوب.');
    if (!startNode) errors.push('يجب وجود خطوة start.');
    if (flow.status === 'active' && flow.linked_page_id && !validateLinkedPage(tenantId, flow.linked_page_id)) {
        errors.push('الصفحة المحددة غير مفعلة أو غير موجودة.');
    }
    if (flow.status === 'active' && flow.trigger_type === 'keyword' && !String(flow.trigger_value || '').trim()) {
        errors.push('المسار النشط بالكلمة المفتاحية يحتاج كلمة أو أكثر.');
    }
    if (flow.status === 'active' && flow.trigger_type === 'postback' && !String(flow.trigger_value || '').trim()) {
        errors.push('مسار postback النشط يحتاج payload واضح.');
    }

    const activePages = db.prepare('SELECT COUNT(*) AS count FROM tenant_pages WHERE tenant_id = ? AND is_active = 1').get(tenantId)?.count || 0;
    if (activePages === 0) warnings.push('لا توجد صفحات Messenger مفعلة لهذا العميل.');

    for (const node of nodes) {
        const config = parseJson(node.config_json, {});
        if (node.node_type === 'quick_replies' && (!Array.isArray(config.quick_replies) || config.quick_replies.length === 0)) {
            warnings.push(`الخطوة ${node.node_key} من نوع Quick Replies بدون أزرار.`);
        }
        if (node.node_type === 'service_menu' && (!Array.isArray(config.items) || config.items.length === 0)) {
            warnings.push(`الخطوة ${node.node_key} من نوع قائمة خدمات بدون عناصر.`);
        }
        if (node.node_type === 'product_list') {
            const params = [tenantId];
            let categoryClause = '';
            if (config.category) {
                categoryClause = 'AND LOWER(category) = LOWER(?)';
                params.push(config.category);
            }
            const count = db.prepare(`
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

    const conflicts = db.prepare(`
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
        flow.priority || 100
    );

    if (conflicts.length > 0) {
        warnings.push('يوجد مسار نشط آخر بنفس المشغل والصفحة والأولوية.');
    }

    return {
        ready: errors.length === 0,
        warnings,
        errors,
        conflicts,
    };
}

function attachFlowDiagnostics(flow, tenantId) {
    const nodes = flow.nodes || db.prepare('SELECT * FROM bot_flow_nodes WHERE flow_id = ? ORDER BY sort_order ASC, id ASC').all(flow.id);
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
}

router.get('/summary', (req, res) => {
    try {
        const tenant = requireTenant(req, res);
        if (!tenant) return;

        const products = db.prepare(`
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN is_active = 1 AND availability = 'available' THEN 1 ELSE 0 END) AS active
            FROM bot_products
            WHERE tenant_id = ?
        `).get(tenant.id);
        const flows = db.prepare(`
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active
            FROM bot_flows
            WHERE tenant_id = ?
        `).get(tenant.id);
        const sessions = db.prepare(`
            SELECT status, COUNT(*) AS count
            FROM bot_sessions
            WHERE tenant_id = ?
            GROUP BY status
        `).all(tenant.id);
        const pages = db.prepare(`
            SELECT id, page_id, page_name
            FROM tenant_pages
            WHERE tenant_id = ? AND is_active = 1
            ORDER BY page_name
        `).all(tenant.id);
        const eventStats = db.prepare(`
            SELECT event_type, status, COUNT(*) AS count
            FROM bot_events
            WHERE tenant_id = ?
              AND created_at >= datetime('now', '-30 days', 'localtime')
            GROUP BY event_type, status
            ORDER BY count DESC
        `).all(tenant.id);
        const topFlows = db.prepare(`
            SELECT
                json_extract(be.payload_json, '$.flow_id') AS flow_id,
                COALESCE(bf.name, json_extract(be.payload_json, '$.flow_name'), 'غير معروف') AS flow_name,
                COUNT(*) AS count
            FROM bot_events be
            LEFT JOIN bot_flows bf ON bf.id = json_extract(be.payload_json, '$.flow_id')
            WHERE be.tenant_id = ?
              AND be.event_type = 'flow_matched'
              AND be.created_at >= datetime('now', '-30 days', 'localtime')
            GROUP BY flow_id, flow_name
            ORDER BY count DESC
            LIMIT 5
        `).all(tenant.id);
        const handoffCount = db.prepare(`
            SELECT COUNT(*) AS count
            FROM bot_events
            WHERE tenant_id = ?
              AND event_type = 'handoff'
              AND created_at >= datetime('now', '-30 days', 'localtime')
        `).get(tenant.id)?.count || 0;
        const failedSends = db.prepare(`
            SELECT COUNT(*) AS count
            FROM bot_events
            WHERE tenant_id = ?
              AND event_type = 'send_failed'
              AND created_at >= datetime('now', '-30 days', 'localtime')
        `).get(tenant.id)?.count || 0;
        const productDetails = db.prepare(`
            SELECT COUNT(*) AS count
            FROM bot_events
            WHERE tenant_id = ?
              AND payload_json LIKE '%"node_type":"product_detail"%'
              AND created_at >= datetime('now', '-30 days', 'localtime')
        `).get(tenant.id)?.count || 0;

        res.json({
            tenant,
            products: { total: products?.total || 0, active: products?.active || 0 },
            flows: { total: flows?.total || 0, active: flows?.active || 0 },
            sessions,
            pages,
            performance: {
                event_stats: eventStats,
                top_flows: topFlows,
                handoffs: handoffCount,
                failed_sends: failedSends,
                product_details: productDetails,
            },
        });
    } catch (error) {
        console.error('[MessengerBot] Summary error:', error);
        res.status(500).json({ error: 'فشل جلب ملخص البوت' });
    }
});

router.get('/products', (req, res) => {
    try {
        const tenant = requireTenant(req, res);
        if (!tenant) return;
        const { search = '', category = '', active = '' } = req.query;
        const clauses = ['tenant_id = ?'];
        const params = [tenant.id];
        if (search) {
            clauses.push('(name LIKE ? OR sku LIKE ? OR description LIKE ?)');
            const value = `%${search}%`;
            params.push(value, value, value);
        }
        if (category) {
            clauses.push('LOWER(category) = LOWER(?)');
            params.push(category);
        }
        if (active !== '') {
            clauses.push('is_active = ?');
            params.push(active === '1' || active === 'true' ? 1 : 0);
        }

        const products = db.prepare(`
            SELECT *
            FROM bot_products
            WHERE ${clauses.join(' AND ')}
            ORDER BY updated_at DESC, id DESC
        `).all(...params);
        res.json(attachProductsImages(products));
    } catch (error) {
        console.error('[MessengerBot] Products list error:', error);
        res.status(500).json({ error: 'فشل جلب المنتجات' });
    }
});

router.post('/products', (req, res) => {
    try {
        const tenant = requireTenant(req, res);
        if (!tenant) return;
        const product = normalizeProductPayload(req.body);
        if (!product.name) return res.status(400).json({ error: 'اسم المنتج مطلوب' });

        const tx = db.transaction(() => {
            const result = db.prepare(`
                INSERT INTO bot_products (
                    tenant_id, sku, name, description, price, currency,
                    image_url, product_url, category, availability, is_active
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                tenant.id,
                product.sku,
                product.name,
                product.description,
                product.price,
                product.currency,
                product.images[0]?.image_url || product.image_url,
                product.product_url,
                product.category,
                product.availability,
                product.is_active
            );
            replaceProductImages(result.lastInsertRowid, tenant.id, product.images);
            return attachProductImages(db.prepare('SELECT * FROM bot_products WHERE id = ?').get(result.lastInsertRowid));
        });

        res.status(201).json(tx());
    } catch (error) {
        console.error('[MessengerBot] Product create error:', error);
        res.status(500).json({ error: 'فشل إنشاء المنتج' });
    }
});

router.patch('/products/:id', (req, res) => {
    try {
        const tenant = requireTenant(req, res);
        if (!tenant) return;
        const existing = db.prepare('SELECT * FROM bot_products WHERE id = ? AND tenant_id = ?').get(req.params.id, tenant.id);
        if (!existing) return res.status(404).json({ error: 'المنتج غير موجود' });

        const body = { ...existing, ...req.body };
        if (!Object.prototype.hasOwnProperty.call(req.body, 'images')) {
            body.images = getProductImages(existing.id);
        }
        const product = normalizeProductPayload(body);
        if (!product.name) return res.status(400).json({ error: 'اسم المنتج مطلوب' });

        const tx = db.transaction(() => {
            db.prepare(`
                UPDATE bot_products
                SET sku = ?, name = ?, description = ?, price = ?, currency = ?,
                    image_url = ?, product_url = ?, category = ?, availability = ?,
                    is_active = ?, updated_at = datetime('now', 'localtime')
                WHERE id = ? AND tenant_id = ?
            `).run(
                product.sku,
                product.name,
                product.description,
                product.price,
                product.currency,
                product.images[0]?.image_url || product.image_url,
                product.product_url,
                product.category,
                product.availability,
                product.is_active,
                req.params.id,
                tenant.id
            );
            replaceProductImages(req.params.id, tenant.id, product.images);
            return attachProductImages(db.prepare('SELECT * FROM bot_products WHERE id = ?').get(req.params.id));
        });

        res.json(tx());
    } catch (error) {
        console.error('[MessengerBot] Product update error:', error);
        res.status(500).json({ error: 'فشل تحديث المنتج' });
    }
});

router.delete('/products/:id', (req, res) => {
    try {
        const tenant = requireTenant(req, res);
        if (!tenant) return;
        const result = db.prepare('DELETE FROM bot_products WHERE id = ? AND tenant_id = ?').run(req.params.id, tenant.id);
        if (result.changes === 0) return res.status(404).json({ error: 'المنتج غير موجود' });
        res.json({ success: true });
    } catch (error) {
        console.error('[MessengerBot] Product delete error:', error);
        res.status(500).json({ error: 'فشل حذف المنتج' });
    }
});

router.post('/products/import', upload.single('file'), (req, res) => {
    try {
        const tenant = requireTenant(req, res);
        if (!tenant) return;
        if (!req.file) return res.status(400).json({ error: 'ملف CSV مطلوب' });

        const text = fs.readFileSync(req.file.path, 'utf8');
        const products = parseProductsCsv(text);
        let imported = 0;
        let skipped = 0;

        const insert = db.prepare(`
            INSERT INTO bot_products (
                tenant_id, sku, name, description, price, currency,
                image_url, product_url, category, availability, is_active
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(tenant_id, sku) WHERE sku IS NOT NULL AND sku != '' DO UPDATE SET
                name = excluded.name,
                description = excluded.description,
                price = excluded.price,
                currency = excluded.currency,
                image_url = excluded.image_url,
                product_url = excluded.product_url,
                category = excluded.category,
                availability = excluded.availability,
                is_active = excluded.is_active,
                updated_at = datetime('now', 'localtime')
        `);

        const tx = db.transaction(() => {
            for (const product of products) {
                if (!product.name) {
                    skipped += 1;
                    continue;
                }
                insert.run(
                    tenant.id,
                    product.sku,
                    product.name,
                    product.description,
                    product.price,
                    product.currency,
                    product.image_url,
                    product.product_url,
                    product.category,
                    product.availability,
                    product.is_active
                );
                imported += 1;
            }
        });
        tx();

        res.json({ success: true, imported, skipped });
    } catch (error) {
        console.error('[MessengerBot] Product import error:', error);
        res.status(500).json({ error: 'فشل استيراد المنتجات' });
    } finally {
        cleanupFile(req.file?.path);
    }
});

router.post('/assets/upload', botImageUpload.single('file'), (req, res) => {
    try {
        const tenant = requireTenant(req, res);
        if (!tenant) {
            cleanupFile(req.file?.path);
            return;
        }
        if (!req.file) return res.status(400).json({ error: 'الصورة مطلوبة' });

        const url = `${resolvePublicApiBase(req)}/bot-assets/${encodeURIComponent(req.file.filename)}`;
        res.status(201).json({
            url,
            filename: req.file.filename,
            original_name: req.file.originalname,
            mime_type: req.file.mimetype,
            size: req.file.size,
        });
    } catch (error) {
        cleanupFile(req.file?.path);
        console.error('[MessengerBot] Asset upload error:', error);
        res.status(500).json({ error: 'فشل رفع صورة البوت' });
    }
});

router.get('/flows', (req, res) => {
    try {
        const tenant = requireTenant(req, res);
        if (!tenant) return;
        const flows = db.prepare(`
            SELECT f.*, tp.page_name,
                   n.node_type, n.body, n.config_json
            FROM bot_flows f
            LEFT JOIN tenant_pages tp ON tp.id = f.linked_page_id
            LEFT JOIN bot_flow_nodes n ON n.flow_id = f.id AND n.node_key = 'start'
            WHERE f.tenant_id = ?
            ORDER BY f.status = 'active' DESC, f.priority ASC, f.id DESC
        `).all(tenant.id);
        res.json(flows.map(flow => attachFlowDiagnostics(flow, tenant.id)));
    } catch (error) {
        console.error('[MessengerBot] Flows list error:', error);
        res.status(500).json({ error: 'فشل جلب مسارات البوت' });
    }
});

router.get('/flows/:id', (req, res) => {
    try {
        const tenant = requireTenant(req, res);
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
        const tenant = requireTenant(req, res);
        if (!tenant) return;
        const { flow, nodes } = normalizeFlowPayload(req.body);
        if (!flow.name) return res.status(400).json({ error: 'اسم المسار مطلوب' });
        if (flow.linked_page_id && !validateLinkedPage(tenant.id, flow.linked_page_id)) {
            return res.status(400).json({ error: 'صفحة فيسبوك غير صالحة لهذا العميل' });
        }
        const diagnostics = getFlowDiagnostics({ ...flow, id: 0 }, nodes, tenant.id);
        if (flow.status === 'active' && diagnostics.errors.length > 0) {
            return res.status(400).json({ error: 'لا يمكن تفعيل المسار قبل معالجة الأخطاء', diagnostics });
        }

        const tx = db.transaction(() => {
            const result = db.prepare(`
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
                flow.description
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
        const tenant = requireTenant(req, res);
        if (!tenant) return;
        const existing = getFlowWithNode(req.params.id, tenant.id);
        if (!existing) return res.status(404).json({ error: 'المسار غير موجود' });

        const { flow, nodes } = normalizeFlowPayload({ ...existing, node: existing.node, nodes: existing.nodes, ...req.body });
        if (!flow.name) return res.status(400).json({ error: 'اسم المسار مطلوب' });
        if (flow.linked_page_id && !validateLinkedPage(tenant.id, flow.linked_page_id)) {
            return res.status(400).json({ error: 'صفحة فيسبوك غير صالحة لهذا العميل' });
        }
        const diagnostics = getFlowDiagnostics({ ...flow, id: existing.id }, nodes, tenant.id);
        if (flow.status === 'active' && diagnostics.errors.length > 0) {
            return res.status(400).json({ error: 'لا يمكن تفعيل المسار قبل معالجة الأخطاء', diagnostics });
        }

        const tx = db.transaction(() => {
            db.prepare(`
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
                tenant.id
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
        const tenant = requireTenant(req, res);
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
        db.prepare("UPDATE bot_flows SET status = ?, updated_at = datetime('now', 'localtime') WHERE id = ? AND tenant_id = ?")
            .run(nextStatus, req.params.id, tenant.id);
        res.json(attachFlowDiagnostics(getFlowWithNode(req.params.id, tenant.id), tenant.id));
    } catch (error) {
        console.error('[MessengerBot] Flow toggle error:', error);
        res.status(500).json({ error: 'فشل تغيير حالة المسار' });
    }
});

router.delete('/flows/:id', (req, res) => {
    try {
        const tenant = requireTenant(req, res);
        if (!tenant) return;
        const result = db.prepare('DELETE FROM bot_flows WHERE id = ? AND tenant_id = ?').run(req.params.id, tenant.id);
        if (result.changes === 0) return res.status(404).json({ error: 'المسار غير موجود' });
        res.json({ success: true });
    } catch (error) {
        console.error('[MessengerBot] Flow delete error:', error);
        res.status(500).json({ error: 'فشل حذف المسار' });
    }
});

router.post('/flows/:id/test', (req, res) => {
    try {
        const tenant = requireTenant(req, res);
        if (!tenant) return;
        const flow = getFlowWithNode(req.params.id, tenant.id);
        if (!flow) return res.status(404).json({ error: 'المسار غير موجود' });
        res.json({
            flow_id: flow.id,
            preview: buildNodePreview(flow.node || {}, tenant.id),
        });
    } catch (error) {
        console.error('[MessengerBot] Flow test error:', error);
        res.status(500).json({ error: 'فشل اختبار المسار' });
    }
});

router.get('/flows/:id/events', (req, res) => {
    try {
        const tenant = requireTenant(req, res);
        if (!tenant) return;
        const flow = getFlowWithNode(req.params.id, tenant.id);
        if (!flow) return res.status(404).json({ error: 'المسار غير موجود' });
        const limit = Math.min(Math.max(toInt(req.query.limit, 50), 1), 200);
        const events = db.prepare(`
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

router.get('/sessions', (req, res) => {
    try {
        const tenant = requireTenant(req, res);
        if (!tenant) return;
        const { linked_page_id, conversation_id, status } = req.query;
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

        const sessions = db.prepare(`
            SELECT s.*, fc.user_name, fc.user_profile_pic, fc.last_message, fc.last_message_time,
                   tp.page_name, f.name AS flow_name
            FROM bot_sessions s
            LEFT JOIN fb_conversations fc ON fc.id = s.conversation_id
            LEFT JOIN tenant_pages tp ON tp.id = s.linked_page_id
            LEFT JOIN bot_flows f ON f.id = s.active_flow_id
            WHERE ${clauses.join(' AND ')}
            ORDER BY s.updated_at DESC
            LIMIT 100
        `).all(...params);
        res.json(sessions);
    } catch (error) {
        console.error('[MessengerBot] Sessions list error:', error);
        res.status(500).json({ error: 'فشل جلب جلسات البوت' });
    }
});

router.patch('/sessions/:id', (req, res) => {
    try {
        const tenant = requireTenant(req, res);
        if (!tenant) return;
        const status = String(req.body.status || '').trim();
        if (!VALID_SESSION_STATUSES.has(status)) {
            return res.status(400).json({ error: 'حالة الجلسة غير صالحة' });
        }
        const existing = db.prepare('SELECT * FROM bot_sessions WHERE id = ? AND tenant_id = ?').get(req.params.id, tenant.id);
        if (!existing) return res.status(404).json({ error: 'جلسة البوت غير موجودة' });

        db.prepare(`
            UPDATE bot_sessions
            SET status = ?, updated_at = datetime('now', 'localtime')
            WHERE id = ? AND tenant_id = ?
        `).run(status, req.params.id, tenant.id);

        res.json(db.prepare('SELECT * FROM bot_sessions WHERE id = ?').get(req.params.id));
    } catch (error) {
        console.error('[MessengerBot] Session update error:', error);
        res.status(500).json({ error: 'فشل تحديث جلسة البوت' });
    }
});

export default router;
