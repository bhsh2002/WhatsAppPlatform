import { META_API_BASE } from '../config/index.js';
import { decrypt } from './encryption.js';
import {
    BILLING_OPERATIONS,
    commit as commitBilling,
    release as releaseBilling,
    reserve as reserveBilling,
} from './billing.js';
import { readMetaResponse } from './metaHttp.js';

const publisherError = (message, {
    code = 'FACEBOOK_PUBLISH_FAILED',
    retryable = false,
    status = 502,
} = {}) => {
    const error = new Error(message);
    error.code = code;
    error.retryable = retryable;
    error.status = status;
    return error;
};

export const resolveFacebookPageCredentials = (database, tenantId, linkedPageId) => {
    const page = database.prepare(`
        SELECT id, tenant_id, page_id, page_name, page_access_token_encrypted
        FROM tenant_pages
        WHERE id = ? AND tenant_id = ? AND is_active = 1
        LIMIT 1
    `).get(linkedPageId, tenantId);
    if (!page) throw publisherError('صفحة Facebook غير موجودة أو غير مفعلة', {
        code: 'PAGE_NOT_FOUND',
        status: 404,
    });
    const accessToken = decrypt(page.page_access_token_encrypted);
    if (!accessToken) throw publisherError('رمز وصول صفحة Facebook غير صالح', {
        code: 'PAGE_TOKEN_INVALID',
        status: 400,
    });
    return { page, accessToken };
};

const formBody = values => {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) {
        if (value !== undefined && value !== null && value !== '') body.set(key, String(value));
    }
    return body;
};

export async function publishFacebookContent({
    database,
    publication,
    fetchImpl = globalThis.fetch,
    credentialResolver = resolveFacebookPageCredentials,
    billing = {
        reserve: reserveBilling,
        commit: commitBilling,
        release: releaseBilling,
    },
    metaApiBase = META_API_BASE,
} = {}) {
    if (!database) throw new TypeError('database is required');
    if (!publication?.id) throw new TypeError('publication is required');
    const { page, accessToken } = credentialResolver(
        database,
        publication.tenant_id,
        publication.linked_page_id,
    );
    const isPhoto = Boolean(publication.media_url);
    const operationKey = isPhoto
        ? BILLING_OPERATIONS.FACEBOOK_PHOTO_POST_CREATE
        : BILLING_OPERATIONS.FACEBOOK_POST_CREATE;
    const reservation = billing.reserve({
        tenantId: publication.tenant_id,
        operationKey,
        quantity: 1,
        referenceType: 'facebook_content_publication',
        referenceId: String(publication.id),
        idempotencyKey: `facebook-publication:${publication.id}`,
        metadata: {
            publication_id: publication.id,
            campaign_id: publication.campaign_id || null,
            linked_page_id: publication.linked_page_id,
            page_id: page.page_id,
            source: publication.product_id ? 'product' : 'library',
        },
    });

    let metaResult;
    try {
        const path = isPhoto ? `${page.page_id}/photos` : `${page.page_id}/feed`;
        const body = isPhoto
            ? formBody({
                url: publication.media_url,
                caption: publication.rendered_message,
            })
            : formBody({
                message: publication.rendered_message,
                link: publication.link_url,
            });
        const response = await fetchImpl(`${metaApiBase}/${path}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body,
        });
        metaResult = await readMetaResponse(response);
    } catch (error) {
        billing.release(reservation, error.message);
        throw publisherError('تعذر الاتصال بخدمة Meta لنشر المحتوى', {
            code: 'META_TRANSPORT_ERROR',
            retryable: true,
        });
    }

    if (!metaResult.ok) {
        billing.release(reservation, metaResult.error?.message || 'Meta publish failed');
        throw publisherError(metaResult.error?.message || 'فشل نشر المحتوى على Facebook', {
            code: metaResult.error?.code ? `META_${metaResult.error.code}` : 'META_PUBLISH_FAILED',
            retryable: Boolean(metaResult.error?.retryable),
            status: metaResult.status >= 400 && metaResult.status < 500 ? metaResult.status : 502,
        });
    }

    const postId = metaResult.data?.post_id || metaResult.data?.id || null;
    let billingWarning = null;
    try {
        billing.commit(reservation, {
            referenceId: postId || String(publication.id),
            description: `خصم نشر محتوى Facebook على ${page.page_name || page.page_id}`,
        });
    } catch (error) {
        // The remote post already exists. Never retry the Meta mutation because
        // a local billing write failed; surface the warning for reconciliation.
        billingWarning = String(error.message || 'Billing commit failed').slice(0, 500);
        console.error('[FacebookContentPublisher] Billing commit warning:', billingWarning);
    }

    return {
        post_id: postId,
        page_id: page.page_id,
        page_name: page.page_name,
        billing_warning: billingWarning,
    };
}
