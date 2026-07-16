import express from 'express';

import {
    BILLING_OPERATIONS,
    BillingError,
    commit as commitBilling,
    handleBillingError,
    release as releaseBilling,
    reserve as reserveBilling,
} from '../services/billing.js';
import {
    FACEBOOK_CONTENT_AI_ACTIONS,
    FACEBOOK_CONTENT_PROMPT_VERSION,
    requestFacebookContent,
} from '../services/facebookContentAi.js';
import {
    boundedInteger,
    boundedText,
    contentError,
    getEffectiveContentSettings,
    normalizeOptionalUrl,
    normalizeStringList,
    requireContentPage,
    requireContentTenant,
    requireSharedProduct,
    sendContentError,
} from './facebookContentStudioShared.js';

const variantBody = variant => [
    variant.body,
    variant.cta,
    normalizeStringList(variant.hashtags)
        .map(tag => tag.startsWith('#') ? tag : `#${tag.replace(/\s+/g, '_')}`)
        .join(' '),
].filter(Boolean).join('\n\n').trim();

const clientSafeAiError = error => {
    if (error instanceof BillingError) return error;
    if (['AI_DISABLED', 'AI_INPUT_REQUIRED', 'INVALID_AI_ACTION'].includes(error?.code)) {
        return error;
    }
    const messages = {
        AI_NOT_CONFIGURED: ['مساعد الكتابة غير مهيأ على الخادم', 503],
        AI_CAPACITY_EXCEEDED: ['خدمة مساعد الكتابة مشغولة حالياً. حاول مرة أخرى بعد قليل.', 429],
        AI_SERVICE_UNAVAILABLE: ['خدمة مساعد الكتابة غير متاحة حالياً. حاول مرة أخرى لاحقاً.', 502],
        AI_REQUEST_REFUSED: ['تعذر إنشاء هذا المحتوى. عدّل النص وحاول مرة أخرى.', 422],
        AI_POLICY_VIOLATION: ['المحتوى الناتج لم يطابق قواعد الكتابة المحددة', 422],
    };
    const matched = messages[error?.code];
    if (matched) return contentError(matched[0], matched[1], error.code);
    console.error('[FacebookContentAI] Unclassified generation error:', {
        code: error?.code || null,
        status: error?.status || null,
        message: String(error?.message || '').slice(0, 500),
    });
    return contentError(
        'تعذر إنشاء المحتوى حالياً. حاول مرة أخرى لاحقاً.',
        502,
        'AI_GENERATION_FAILED',
    );
};

export function createFacebookContentAiRouter({
    database,
    generate = requestFacebookContent,
    billing = {
        reserve: reserveBilling,
        commit: commitBilling,
        release: releaseBilling,
    },
} = {}) {
    if (!database) throw new TypeError('database is required');
    const router = express.Router();

    router.get('/ai/history', (req, res) => {
        try {
            const tenant = requireContentTenant(database, req, res);
            if (!tenant) return;
            const limit = boundedInteger(req.query.limit, {
                field: 'الحد',
                min: 1,
                max: 100,
                fallback: 25,
            });
            const sourcePostId = req.query.source_post_id
                ? boundedText(req.query.source_post_id, {
                    field: 'معرف المنشور المصدر',
                    max: 512,
                    required: true,
                })
                : null;
            const rows = database.prepare(`
                SELECT id, linked_page_id, product_id, source_post_id,
                       source_post_url, action,
                       input_tokens, output_tokens, status, error_code, error_message,
                       created_at
                FROM facebook_content_ai_generations
                WHERE tenant_id = ?
                  ${sourcePostId ? 'AND source_post_id = ?' : ''}
                ORDER BY created_at DESC, id DESC
                LIMIT ?
            `).all(...(sourcePostId ? [tenant.id, sourcePostId, limit] : [tenant.id, limit]));
            res.json(rows);
        } catch (error) {
            sendContentError(res, error, 'فشل جلب سجل التوليد');
        }
    });

    router.post('/ai/generate', async (req, res) => {
        let reservation = null;
        let generationId = null;
        try {
            const tenant = requireContentTenant(database, req, res);
            if (!tenant) return;
            const page = req.body.linked_page_id
                ? requireContentPage(database, tenant.id, req.body.linked_page_id)
                : null;
            const linkedPageId = page?.id || null;
            const product = req.body.product_id
                ? requireSharedProduct(database, tenant.id, req.body.product_id, { activeOnly: true })
                : null;
            const settings = getEffectiveContentSettings(database, tenant.id, linkedPageId);
            if (!settings.ai_enabled) throw contentError('مساعد المحتوى معطل لهذه الصفحة', 403, 'AI_DISABLED');
            const action = FACEBOOK_CONTENT_AI_ACTIONS.has(req.body.action)
                ? req.body.action
                : 'generate';
            const inputText = boundedText(req.body.input_text, {
                field: 'النص المدخل',
                max: 5000,
                fallback: '',
            });
            if (!inputText && !product) {
                throw contentError('أدخل فكرة أو اختر منتجاً للتوليد', 400, 'AI_INPUT_REQUIRED');
            }
            if (!['generate', 'variants'].includes(action) && !inputText) {
                throw contentError('النص مطلوب لتنفيذ هذه المهمة', 400, 'AI_INPUT_REQUIRED');
            }
            const taskInstruction = boundedText(req.body.task_instruction, {
                field: 'تعليمات المهمة',
                max: 1000,
                fallback: '',
            });
            const sourcePostId = boundedText(req.body.source_post_id, {
                field: 'معرف المنشور المصدر',
                max: 512,
                fallback: null,
            });
            const sourcePostUrl = normalizeOptionalUrl(
                req.body.source_post_url,
                'رابط المنشور المصدر',
            );
            if (sourcePostId && !page) {
                throw contentError(
                    'اختر صفحة المنشور المصدر',
                    400,
                    'SOURCE_PAGE_REQUIRED',
                );
            }
            const variants = boundedInteger(req.body.variants, {
                field: 'عدد البدائل',
                min: 1,
                max: 5,
                fallback: action === 'variants' ? 3 : 1,
            });
            const pending = database.prepare(`
                INSERT INTO facebook_content_ai_generations (
                    tenant_id, linked_page_id, product_id, source_post_id,
                    source_post_url, action, model, prompt_version, input_text,
                    status, created_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
            `).run(
                tenant.id,
                linkedPageId,
                product?.id || null,
                sourcePostId,
                sourcePostUrl,
                action,
                'pending',
                FACEBOOK_CONTENT_PROMPT_VERSION,
                inputText || null,
                req.user?.id || null,
            );
            generationId = Number(pending.lastInsertRowid);
            reservation = billing.reserve({
                tenantId: tenant.id,
                operationKey: BILLING_OPERATIONS.FACEBOOK_AI_GENERATION,
                quantity: 1,
                referenceType: 'facebook_content_ai',
                referenceId: String(generationId),
                idempotencyKey: `facebook-ai:${generationId}`,
                metadata: {
                    action,
                    linked_page_id: linkedPageId,
                    product_id: product?.id || null,
                    source_post_id: sourcePostId,
                    requested_variants: variants,
                },
            });
            const generated = await generate({
                action,
                inputText,
                page,
                product,
                settings,
                taskInstruction,
                variants,
            });
            const itemStatus = sourcePostId
                ? 'draft'
                : (settings.approval_mode === 'automatic' ? 'approved' : 'review');
            const createdItems = [];
            if (req.body.create_items === true && action !== 'comment_reply') {
                const insertItem = database.prepare(`
                    INSERT INTO facebook_content_items (
                        tenant_id, linked_page_id, product_id, kind, title, body,
                        link_url, media_url, tags_json, status, source_text,
                        prompt_version, source_post_id, source_post_url,
                        approved_by, approved_at, created_by
                    ) VALUES (?, ?, ?, 'ai', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);
                const createItems = database.transaction(() => {
                    for (const variant of generated.variants) {
                        const result = insertItem.run(
                            tenant.id,
                            linkedPageId,
                            product?.id || null,
                            variant.title,
                            variantBody(variant),
                            product?.product_url || null,
                            product?.image_url || null,
                            JSON.stringify(normalizeStringList(variant.hashtags)),
                            itemStatus,
                            inputText || null,
                            generated.prompt_version,
                            sourcePostId,
                            sourcePostUrl,
                            itemStatus === 'approved' ? (req.user?.id || null) : null,
                            itemStatus === 'approved' ? new Date().toISOString() : null,
                            req.user?.id || null,
                        );
                        createdItems.push(Number(result.lastInsertRowid));
                    }
                });
                createItems();
            }
            database.prepare(`
                UPDATE facebook_content_ai_generations
                SET model = ?, output_json = ?, input_tokens = ?, output_tokens = ?,
                    status = 'completed'
                WHERE id = ? AND tenant_id = ?
            `).run(
                generated.model,
                JSON.stringify(generated.variants),
                generated.usage.input_tokens,
                generated.usage.output_tokens,
                generationId,
                tenant.id,
            );
            billing.commit(reservation, {
                referenceId: String(generationId),
                description: `خصم مساعد محتوى Facebook (${action})`,
            });
            res.json({
                generation_id: generationId,
                variants: generated.variants,
                created_item_ids: createdItems,
                usage: generated.usage,
            });
        } catch (error) {
            const responseError = clientSafeAiError(error);
            if (reservation) {
                try {
                    billing.release(reservation, responseError.message);
                } catch (releaseError) {
                    console.error('[FacebookContentAI] Billing release error:', releaseError);
                }
            }
            if (generationId) {
                database.prepare(`
                    UPDATE facebook_content_ai_generations
                    SET status = ?, error_code = ?, error_message = ?
                    WHERE id = ?
                `).run(
                    error.refused ? 'refused' : 'failed',
                    responseError.code,
                    responseError.message,
                    generationId,
                );
            }
            if (handleBillingError(res, error)) return;
            sendContentError(res, responseError, 'فشل توليد المحتوى');
        }
    });

    return router;
}
