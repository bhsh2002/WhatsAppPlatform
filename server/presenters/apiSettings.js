export function presentApiSettings(settings, revealed = {}) {
    return {
        id: settings.id,
        tenant_id: settings.tenant_id,
        webhook_url: settings.webhook_url,
        callback_url: settings.callback_url,
        is_active: settings.is_active,
        created_at: settings.created_at,
        updated_at: settings.updated_at,
        has_api_key: Boolean(settings.api_key_hash || settings.api_key),
        has_webhook_secret: Boolean(settings.webhook_secret),
        ...(revealed.apiKey
            ? { api_key: revealed.apiKey, api_key_visible_once: true }
            : {}),
        ...(revealed.webhookSecret
            ? { webhook_secret: revealed.webhookSecret, webhook_secret_visible_once: true }
            : {}),
    };
}
