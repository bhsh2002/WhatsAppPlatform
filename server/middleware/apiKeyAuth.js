import bcrypt from 'bcryptjs';
import db from '../db/database.js';
import {
    constantTimeEqual,
    digestApiKey,
    generateApiKey,
    isLegacyBcryptDigest,
} from '../security/apiKeys.js';

const attachTenantSettings = (req, settings) => {
    req.tenantId = settings.tenant_id;
    req.tenantSettings = settings;
};

const findTenantSettings = async (apiKey) => {
    const digest = digestApiKey(apiKey);
    const current = db.prepare(
        'SELECT * FROM tenant_api_settings WHERE api_key_hash = ? AND is_active = 1'
    ).get(digest);
    if (current) return current;

    // Transitional path only. New keys never enter this scan; a successful
    // plaintext match is upgraded to the indexed digest immediately.
    const legacySettings = db.prepare(`
        SELECT * FROM tenant_api_settings
        WHERE is_active = 1
          AND (
            (api_key IS NOT NULL AND api_key != '')
            OR api_key_hash LIKE '$2%'
          )
    `).all();

    for (const settings of legacySettings) {
        const bcryptMatch = isLegacyBcryptDigest(settings.api_key_hash)
            ? await bcrypt.compare(apiKey, settings.api_key_hash)
            : false;
        const plaintextMatch = settings.api_key
            ? constantTimeEqual(apiKey, settings.api_key)
            : false;

        if (bcryptMatch || plaintextMatch) {
            if (plaintextMatch) {
                db.prepare(`
                    UPDATE tenant_api_settings
                    SET api_key_hash = ?, api_key = NULL,
                        updated_at = datetime('now', 'localtime')
                    WHERE id = ?
                `).run(digest, settings.id);
                return { ...settings, api_key: null, api_key_hash: digest };
            }
            return settings;
        }
    }

    return null;
};

/**
 * API Key Authentication Middleware
 * Validates X-API-Key header for external API access
 * 
 * Supports both hashed API keys (preferred) and legacy plaintext keys during migration.
 */
export const apiKeyAuth = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey) {
        return res.status(401).json({ 
            error: 'API key required',
            message: 'Include X-API-Key header with your API key'
        });
    }
    
    try {
        const settings = await findTenantSettings(apiKey);
        if (settings) {
            attachTenantSettings(req, settings);
            return next();
        }
        
        return res.status(401).json({ 
            error: 'Invalid API key',
            message: 'The provided API key is not valid'
        });
    } catch (error) {
        console.error('[ApiKeyAuth] Error:', error);
        return res.status(500).json({ 
            error: 'Authentication error',
            message: 'An error occurred while validating the API key'
        });
    }
};

/**
 * Hash an API key for storage
 * Use this when creating or rotating API keys
 * 
 * @param {string} apiKey - The plaintext API key
 * @returns {string} SHA-256 digest for indexed storage
 */
export function hashApiKey(apiKey) {
    return digestApiKey(apiKey);
}

/**
 * Generate a new API key
 * 
 * @returns {string} A prefixed high-entropy API key
 */
export { generateApiKey };

/**
 * Optional API Key Authentication
 * Adds tenant info if API key is present, but doesn't fail if missing
 */
export const optionalApiKeyAuth = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey) {
        return next();
    }
    
    try {
        const settings = await findTenantSettings(apiKey);
        if (settings) {
            attachTenantSettings(req, settings);
            return next();
        }
    } catch (error) {
        console.error('[OptionalApiKeyAuth] Error:', error);
    }
    
    next();
};
