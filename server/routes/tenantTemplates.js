import express from 'express';

import { META_API_BASE } from '../config/index.js';
import { requestMetaJson, sendMetaFailure } from '../services/metaHttp.js';
import { parseListPagination } from '../services/pagination.js';
import { resolveTenantWhatsAppContext } from '../services/whatsappNumbers.js';

const TEMPLATE_COLUMNS = `
    id, tenant_id, name, language, category, header_type, header_content,
    body, footer, buttons, variables, status, meta_template_id,
    quality_score, parameter_format, created_at, updated_at
`;
const VALID_CATEGORIES = new Set(['MARKETING', 'UTILITY', 'AUTHENTICATION']);
const VALID_HEADER_TYPES = new Set(['none', 'text', 'image', 'video', 'document', 'location', 'gif']);
const VALID_PARAMETER_FORMATS = new Set(['positional', 'named']);

const parsePositiveId = value => {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 && String(parsed) === String(value).trim() ? parsed : null;
};

const normalizeString = (value, maxLength, { allowEmpty = false } = {}) => {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    if ((!normalized && !allowEmpty) || normalized.length > maxLength) return null;
    return normalized;
};

const normalizeLanguage = value => {
    const language = normalizeString(value ?? 'ar', 32);
    return language && /^[A-Za-z_-]{2,32}$/.test(language) ? language : null;
};

const normalizeCategory = value => {
    const category = normalizeString(value ?? 'UTILITY', 32)?.toUpperCase();
    return VALID_CATEGORIES.has(category) ? category : null;
};

const serializeOptional = value => {
    if (value == null) return null;
    return JSON.stringify(value);
};

const parseMetaComponents = components => {
    let headerType = 'none';
    let headerContent = '';
    let body = '';
    let footer = '';
    let buttons = null;
    for (const component of Array.isArray(components) ? components : []) {
        if (!component || typeof component !== 'object') continue;
        switch (String(component.type || '').toUpperCase()) {
            case 'HEADER':
                headerType = String(component.format || 'text').toLowerCase();
                headerContent = headerType === 'text'
                    ? component.text || ''
                    : component.example?.header_handle?.[0] || '';
                break;
            case 'BODY':
                body = component.text || '';
                break;
            case 'FOOTER':
                footer = component.text || '';
                break;
            case 'BUTTONS':
                buttons = component.buttons || [];
                break;
            default:
                break;
        }
    }
    return { headerType, headerContent, body, footer, buttons };
};

const normalizeMetaNextUrl = (value, apiBase) => {
    if (!value) return null;
    try {
        const next = new URL(value);
        const base = new URL(apiBase);
        return next.protocol === 'https:' && next.origin === base.origin
            ? next.toString()
            : null;
    } catch {
        return null;
    }
};

export function createTenantTemplatesRouter({
    database,
    accessTokenForTenant,
    requestMeta = requestMetaJson,
    apiBase = META_API_BASE,
} = {}) {
    if (!database || typeof accessTokenForTenant !== 'function') {
        throw new TypeError('Tenant templates router requires database and credentials');
    }
    const router = express.Router();

    const resolveContext = (req, res) => {
        const context = resolveTenantWhatsAppContext({
            database,
            tenantId: req.user?.tenant_id,
            request: req,
            accessTokenForTenant,
        });
        if (context.error) {
            res.status(context.status).json({ error: context.error, code: context.code });
            return null;
        }
        return context;
    };

    const selectTemplate = (id, tenantId) => database.prepare(`
        SELECT ${TEMPLATE_COLUMNS}
        FROM templates
        WHERE id = ? AND tenant_id = ?
    `).get(id, tenantId);

    router.get('/templates', (req, res) => {
        try {
            const { limit, offset } = parseListPagination(req.query, {
                defaultLimit: 100,
                maxLimit: 200,
            });
            const templates = database.prepare(`
                SELECT ${TEMPLATE_COLUMNS}
                FROM templates
                WHERE tenant_id = ?
                ORDER BY created_at DESC, id DESC
                LIMIT ? OFFSET ?
            `).all(req.user.tenant_id, limit, offset);
            return res.json(templates);
        } catch (error) {
            console.error('[TenantTemplates] List error:', error);
            return res.status(500).json({ error: 'فشل جلب القوالب' });
        }
    });

    router.get('/templates/:id', (req, res) => {
        try {
            const templateId = parsePositiveId(req.params.id);
            if (!templateId) return res.status(400).json({ error: 'معرّف القالب غير صالح' });
            const template = selectTemplate(templateId, req.user.tenant_id);
            if (!template) return res.status(404).json({ error: 'القالب غير موجود' });
            return res.json(template);
        } catch (error) {
            console.error('[TenantTemplates] Get error:', error);
            return res.status(500).json({ error: 'فشل جلب القالب' });
        }
    });

    router.post('/templates', (req, res) => {
        try {
            const tenantId = req.user.tenant_id;
            const name = normalizeString(req.body?.name, 512);
            const body = normalizeString(req.body?.body, 32768);
            const language = normalizeLanguage(req.body?.language);
            const category = normalizeCategory(req.body?.category);
            const headerType = normalizeString(req.body?.header_type ?? 'none', 32)?.toLowerCase();
            if (!name || !body) {
                return res.status(400).json({ error: 'اسم القالب والمحتوى مطلوبان' });
            }
            if (!language || !category || !VALID_HEADER_TYPES.has(headerType)) {
                return res.status(400).json({ error: 'لغة أو فئة أو نوع ترويسة القالب غير صالح' });
            }
            const existing = database.prepare(`
                SELECT id FROM templates WHERE tenant_id = ? AND name = ? AND language = ?
            `).get(tenantId, name, language);
            if (existing) return res.status(409).json({ error: 'القالب موجود مسبقاً' });

            const result = database.prepare(`
                INSERT INTO templates (
                    tenant_id, name, language, category, header_type,
                    header_content, body, footer, buttons, variables
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                tenantId,
                name,
                language,
                category,
                headerType,
                normalizeString(req.body?.header_content ?? '', 32768, { allowEmpty: true }) || null,
                body,
                normalizeString(req.body?.footer ?? '', 4096, { allowEmpty: true }) || null,
                serializeOptional(req.body?.buttons),
                serializeOptional(req.body?.variables)
            );
            return res.status(201).json(selectTemplate(result.lastInsertRowid, tenantId));
        } catch (error) {
            console.error('[TenantTemplates] Create error:', error);
            return res.status(500).json({ error: 'فشل إنشاء القالب' });
        }
    });

    router.put('/templates/:id', (req, res) => {
        try {
            const tenantId = req.user.tenant_id;
            const templateId = parsePositiveId(req.params.id);
            if (!templateId) return res.status(400).json({ error: 'معرّف القالب غير صالح' });
            if (!selectTemplate(templateId, tenantId)) {
                return res.status(404).json({ error: 'القالب غير موجود' });
            }

            const updates = [];
            const values = [];
            const addString = (key, column, maxLength, options = {}) => {
                if (!Object.hasOwn(req.body || {}, key)) return true;
                const value = normalizeString(req.body[key], maxLength, options);
                if (value === null) return false;
                updates.push(`${column} = ?`);
                values.push(value || null);
                return true;
            };
            if (!addString('name', 'name', 512) || !addString('body', 'body', 32768)) {
                return res.status(400).json({ error: 'اسم القالب أو المحتوى غير صالح' });
            }
            if (Object.hasOwn(req.body || {}, 'language')) {
                const language = normalizeLanguage(req.body.language);
                if (!language) return res.status(400).json({ error: 'لغة القالب غير صالحة' });
                updates.push('language = ?');
                values.push(language);
            }
            if (Object.hasOwn(req.body || {}, 'category')) {
                const category = normalizeCategory(req.body.category);
                if (!category) return res.status(400).json({ error: 'فئة القالب غير صالحة' });
                updates.push('category = ?');
                values.push(category);
            }
            if (Object.hasOwn(req.body || {}, 'header_type')) {
                const headerType = normalizeString(req.body.header_type, 32)?.toLowerCase();
                if (!VALID_HEADER_TYPES.has(headerType)) {
                    return res.status(400).json({ error: 'نوع ترويسة القالب غير صالح' });
                }
                updates.push('header_type = ?');
                values.push(headerType);
            }
            if (!addString('header_content', 'header_content', 32768, { allowEmpty: true })
                || !addString('footer', 'footer', 4096, { allowEmpty: true })) {
                return res.status(400).json({ error: 'محتوى الترويسة أو التذييل غير صالح' });
            }
            for (const key of ['buttons', 'variables']) {
                if (Object.hasOwn(req.body || {}, key)) {
                    updates.push(`${key} = ?`);
                    values.push(serializeOptional(req.body[key]));
                }
            }
            if (updates.length === 0) return res.status(400).json({ error: 'لا توجد حقول للتحديث' });
            updates.push("updated_at = datetime('now', 'localtime')");
            database.prepare(`
                UPDATE templates SET ${updates.join(', ')}
                WHERE id = ? AND tenant_id = ?
            `).run(...values, templateId, tenantId);
            return res.json(selectTemplate(templateId, tenantId));
        } catch (error) {
            if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                return res.status(409).json({ error: 'اسم القالب واللغة موجودان مسبقاً' });
            }
            console.error('[TenantTemplates] Update error:', error);
            return res.status(500).json({ error: 'فشل تحديث القالب' });
        }
    });

    // Literal route must remain before /templates/:id.
    router.delete('/templates/delete-meta', async (req, res) => {
        try {
            const tenantId = req.user.tenant_id;
            const name = normalizeString(req.query?.name, 512);
            if (!name) return res.status(400).json({ error: 'اسم القالب مطلوب' });
            const context = resolveContext(req, res);
            if (!context) return;
            if (!context.wabaId) {
                return res.status(400).json({ error: 'إعدادات WhatsApp API غير مكتملة' });
            }
            const result = await requestMeta(
                `${apiBase}/${encodeURIComponent(context.wabaId)}/message_templates?name=${encodeURIComponent(name)}`,
                { method: 'DELETE', headers: { Authorization: `Bearer ${context.accessToken}` } }
            );
            if (!result.ok) return sendMetaFailure(res, result, 'فشل حذف القالب من Meta');
            database.transaction(() => {
                database.prepare('DELETE FROM templates WHERE tenant_id = ? AND name = ?')
                    .run(tenantId, name);
                database.prepare(`
                    INSERT INTO activity_logs (
                        tenant_id, tenant_name, event_type, description, status
                    ) VALUES (?, ?, 'template_deleted_meta', ?, 'success')
                `).run(tenantId, context.tenant.name, `حذف قالب من Meta: ${name}`);
            })();
            return res.json({ success: true });
        } catch (error) {
            console.error('[TenantTemplates] Delete Meta error:', error);
            return res.status(500).json({ error: 'فشل حذف القالب من Meta' });
        }
    });

    router.delete('/templates/:id', (req, res) => {
        try {
            const tenantId = req.user.tenant_id;
            const templateId = parsePositiveId(req.params.id);
            if (!templateId) return res.status(400).json({ error: 'معرّف القالب غير صالح' });
            if (!selectTemplate(templateId, tenantId)) {
                return res.status(404).json({ error: 'القالب غير موجود' });
            }
            database.prepare('DELETE FROM templates WHERE id = ? AND tenant_id = ?')
                .run(templateId, tenantId);
            return res.json({ message: 'تم حذف القالب بنجاح' });
        } catch (error) {
            console.error('[TenantTemplates] Delete error:', error);
            return res.status(500).json({ error: 'فشل حذف القالب' });
        }
    });

    router.post('/templates/sync', async (req, res) => {
        try {
            const tenantId = req.user.tenant_id;
            const context = resolveContext(req, res);
            if (!context) return;
            const { accessToken } = context;

            let wabaId = context.wabaId;
            if (!wabaId && context.phoneNumberId) {
                const wabaResult = await requestMeta(
                    `${apiBase}/${encodeURIComponent(context.phoneNumberId)}/whatsapp_business_account`,
                    { headers: { Authorization: `Bearer ${accessToken}` } }
                );
                if (wabaResult.ok && wabaResult.data?.id) {
                    wabaId = String(wabaResult.data.id);
                    database.prepare('UPDATE tenants SET waba_id = ? WHERE id = ?')
                        .run(wabaId, tenantId);
                } else {
                    const debugResult = await requestMeta(
                        `${apiBase}/debug_token?input_token=${encodeURIComponent(accessToken)}`,
                        { headers: { Authorization: `Bearer ${accessToken}` } }
                    );
                    const scopes = Array.isArray(debugResult.data?.data?.granular_scopes)
                        ? debugResult.data.data.granular_scopes
                        : [];
                    const wabaScope = scopes.find(scope => (
                        scope.scope === 'whatsapp_business_management'
                        || scope.scope === 'whatsapp_business_messaging'
                    ));
                    if (wabaScope?.target_ids?.length > 0) wabaId = String(wabaScope.target_ids[0]);
                }
            }
            if (!wabaId) {
                return res.status(400).json({
                    error: 'لم يتم العثور على معرف حساب WhatsApp Business.',
                    hint: 'تواصل مع المدير لإضافة WABA ID في إعدادات العميل.',
                });
            }

            let url = `${apiBase}/${encodeURIComponent(wabaId)}/message_templates?limit=100&fields=name,language,status,category,components,quality_score,parameter_format`;
            const metaTemplates = [];
            for (let page = 0; url && page < 20; page += 1) {
                const result = await requestMeta(url, {
                    headers: { Authorization: `Bearer ${accessToken}` },
                });
                if (!result.ok) return sendMetaFailure(res, result, 'فشل جلب القوالب من WhatsApp');
                const rows = Array.isArray(result.data?.data) ? result.data.data : [];
                metaTemplates.push(...rows.slice(0, Math.max(0, 2000 - metaTemplates.length)));
                if (metaTemplates.length >= 2000) break;
                const nextValue = result.data?.paging?.next;
                const next = normalizeMetaNextUrl(nextValue, apiBase);
                if (nextValue && !next) {
                    return res.status(502).json({ error: 'Meta returned an invalid pagination URL' });
                }
                url = next;
            }

            let created = 0;
            let updated = 0;
            let unchanged = 0;
            database.transaction(() => {
                for (const template of metaTemplates) {
                    const parsed = parseMetaComponents(template.components);
                    const status = String(template.status || '').toLowerCase();
                    const qualityScore = template.quality_score?.score || 'UNKNOWN';
                    const parameterFormat = VALID_PARAMETER_FORMATS.has(template.parameter_format)
                        ? template.parameter_format
                        : 'positional';
                    const existing = database.prepare(`
                        SELECT id, status, body
                        FROM templates
                        WHERE tenant_id = ? AND name = ? AND language = ?
                    `).get(tenantId, template.name, template.language);
                    if (existing) {
                        if (existing.status === status && existing.body === parsed.body) {
                            unchanged += 1;
                            continue;
                        }
                        database.prepare(`
                            UPDATE templates
                            SET status = ?, category = ?, header_type = ?, header_content = ?,
                                body = ?, footer = ?, buttons = ?, meta_template_id = ?,
                                quality_score = ?, parameter_format = ?,
                                updated_at = datetime('now', 'localtime')
                            WHERE id = ? AND tenant_id = ?
                        `).run(
                            status,
                            template.category,
                            parsed.headerType,
                            parsed.headerContent,
                            parsed.body,
                            parsed.footer,
                            serializeOptional(parsed.buttons),
                            template.id,
                            qualityScore,
                            parameterFormat,
                            existing.id,
                            tenantId
                        );
                        updated += 1;
                    } else {
                        database.prepare(`
                            INSERT INTO templates (
                                tenant_id, name, language, category, status, header_type,
                                header_content, body, footer, buttons, meta_template_id,
                                quality_score, parameter_format
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `).run(
                            tenantId,
                            template.name,
                            template.language,
                            template.category,
                            status,
                            parsed.headerType,
                            parsed.headerContent,
                            parsed.body,
                            parsed.footer,
                            serializeOptional(parsed.buttons),
                            template.id,
                            qualityScore,
                            parameterFormat
                        );
                        created += 1;
                    }
                }
            })();
            const templates = database.prepare(`
                SELECT ${TEMPLATE_COLUMNS}
                FROM templates
                WHERE tenant_id = ?
                ORDER BY created_at DESC, id DESC
                LIMIT 500
            `).all(tenantId);
            return res.json({
                success: true,
                synced: metaTemplates.length,
                created,
                updated,
                unchanged,
                templates,
            });
        } catch (error) {
            console.error('[TenantTemplates] Sync error:', error);
            return res.status(500).json({ error: 'فشل مزامنة القوالب' });
        }
    });

    router.post('/templates/import', (req, res) => {
        try {
            const tenantId = req.user.tenant_id;
            const name = normalizeString(req.body?.name, 512);
            const language = normalizeLanguage(req.body?.language);
            const category = normalizeCategory(req.body?.category);
            const components = Array.isArray(req.body?.components) && req.body.components.length <= 50
                ? req.body.components
                : [];
            if (!name || !language || !category) {
                return res.status(400).json({ error: 'بيانات القالب غير صالحة' });
            }
            const existing = database.prepare(`
                SELECT id FROM templates WHERE tenant_id = ? AND name = ? AND language = ?
            `).get(tenantId, name, language);
            if (existing) return res.status(409).json({ error: 'القالب موجود مسبقاً' });
            const parsed = parseMetaComponents(components);
            const status = normalizeString(req.body?.status ?? 'approved', 32)?.toLowerCase();
            const result = database.prepare(`
                INSERT INTO templates (
                    tenant_id, name, language, category, header_type,
                    header_content, body, footer, buttons, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                tenantId,
                name,
                language,
                category,
                parsed.headerType,
                parsed.headerContent || null,
                parsed.body,
                parsed.footer || null,
                serializeOptional(parsed.buttons),
                status || 'approved'
            );
            return res.status(201).json(selectTemplate(result.lastInsertRowid, tenantId));
        } catch (error) {
            console.error('[TenantTemplates] Import error:', error);
            return res.status(500).json({ error: 'فشل استيراد القالب' });
        }
    });

    router.post('/templates/create-meta', async (req, res) => {
        try {
            const tenantId = req.user.tenant_id;
            const context = resolveContext(req, res);
            if (!context) return;
            if (!context.wabaId) {
                return res.status(400).json({
                    error: 'إعدادات WhatsApp API غير مكتملة (يجب توفر Access Token و WABA ID)',
                });
            }
            const name = normalizeString(req.body?.name, 512);
            const language = normalizeLanguage(req.body?.language);
            const category = normalizeCategory(req.body?.category);
            const parameterFormat = req.body?.parameter_format ?? 'positional';
            const components = Array.isArray(req.body?.components) && req.body.components.length <= 50
                ? req.body.components
                : null;
            if (!name || !language || !category || !components
                || !VALID_PARAMETER_FORMATS.has(parameterFormat)) {
                return res.status(400).json({ error: 'name, category, and valid components are required' });
            }
            const result = await requestMeta(
                `${apiBase}/${encodeURIComponent(context.wabaId)}/message_templates`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${context.accessToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        name,
                        language,
                        category,
                        parameter_format: parameterFormat,
                        components,
                    }),
                }
            );
            if (!result.ok) return sendMetaFailure(res, result, 'فشل إنشاء القالب في Meta');
            database.prepare(`
                INSERT INTO activity_logs (
                    tenant_id, tenant_name, event_type, description, status
                ) VALUES (?, ?, 'template_created_meta', ?, 'success')
            `).run(tenantId, context.tenant.name, `إنشاء قالب في Meta: ${name}`);
            return res.json({ success: true, data: result.data || {} });
        } catch (error) {
            console.error('[TenantTemplates] Create Meta error:', error);
            return res.status(500).json({ error: 'فشل إنشاء القالب في Meta' });
        }
    });

    return router;
}

export default createTenantTemplatesRouter;
