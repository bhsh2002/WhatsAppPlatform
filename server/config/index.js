// ============================================
// Centralized Configuration — Single Source of Truth
// ============================================

// Meta WhatsApp Cloud API
export const META_API_VERSION = 'v25.0';
export const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

// JWT
export const JWT_SECRET = process.env.JWT_SECRET;
export const JWT_EXPIRES_IN = '7d';

// File upload limits
export const MAX_FILE_SIZE = 16 * 1024 * 1024;        // 16MB — Meta max for media
export const MAX_IMAGE_SIZE = 10 * 1024 * 1024;       // 10MB — reasonable image cap
export const MAX_DOCUMENT_SIZE = 16 * 1024 * 1024;    // 16MB — Meta max for documents

// Allowed MIME types for media uploads
export const ALLOWED_IMAGE_MIMES = [
    'image/jpeg',
    'image/png',
    'image/webp',
];

export const ALLOWED_DOCUMENT_MIMES = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
];

export const ALLOWED_MEDIA_MIMES = [
    ...ALLOWED_IMAGE_MIMES,
    ...ALLOWED_DOCUMENT_MIMES,
    'video/mp4',
    'video/3gpp',
    'audio/aac',
    'audio/amr',
    'audio/mp4',
    'audio/mpeg',
    'audio/ogg',
];

// Rate limiting
export const GLOBAL_RATE_LIMIT = {
    windowMs: 60 * 1000,            // 1 minute
    max: 120,                        // 120 requests per minute (2/sec avg)
    message: 'طلبات كثيرة. حاول مرة أخرى.',
};

export const AUTH_RATE_LIMIT = {
    windowMs: 15 * 60 * 1000,       // 15 minutes
    max: 10,                         // 10 login attempts per 15 min
    message: 'محاولات كثيرة. حاول مرة أخرى بعد 15 دقيقة.',
};

// Meta App credentials (for token health monitoring)
export const META_APP_ID = process.env.META_APP_ID || '';
export const META_APP_SECRET = process.env.META_APP_SECRET || '';
export const META_WEBHOOK_CALLBACK_URL = process.env.META_WEBHOOK_CALLBACK_URL || '';

// Facebook OAuth (self-service page linking)
export const FACEBOOK_REDIRECT_URI = process.env.FACEBOOK_REDIRECT_URI || '';

// Facebook Content Studio AI provider (server-side only)
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
export const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-luna';
export const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
export const CONTENT_SCHEDULER_INTERVAL_MS = Math.max(
    Number(process.env.CONTENT_SCHEDULER_INTERVAL_MS) || 60_000,
    10_000,
);
export const CONTENT_SCHEDULER_BATCH_SIZE = Math.min(
    Math.max(Number(process.env.CONTENT_SCHEDULER_BATCH_SIZE) || 10, 1),
    50,
);

// WhatsApp Embedded Signup
export const WA_EMBEDDED_SIGNUP_CONFIG_ID = process.env.WA_EMBEDDED_SIGNUP_CONFIG_ID || '';
