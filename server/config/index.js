// ============================================
// Centralized Configuration — Single Source of Truth
// ============================================

// Meta WhatsApp Cloud API
export const META_API_VERSION = 'v22.0';
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
    'text/plain',
    'text/csv',
];

export const ALLOWED_MEDIA_MIMES = [
    ...ALLOWED_IMAGE_MIMES,
    ...ALLOWED_DOCUMENT_MIMES,
    'video/mp4',
    'video/3gpp',
    'audio/aac',
    'audio/mp4',
    'audio/mpeg',
    'audio/ogg',
];

// Rate limiting
export const GLOBAL_RATE_LIMIT = {
    windowMs: 15 * 60 * 1000,  // 15 minutes
    max: 100,
};

export const AUTH_RATE_LIMIT = {
    windowMs: 15 * 60 * 1000,
    max: 20,
};
