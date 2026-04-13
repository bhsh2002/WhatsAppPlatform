import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import db from '../db/database.js';

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
        // First, try to find by hashed key
        const allSettings = db.prepare('SELECT * FROM tenant_api_settings WHERE is_active = 1').all();
        
        for (const settings of allSettings) {
            // Check hashed key first
            if (settings.api_key_hash) {
                const match = await bcrypt.compare(apiKey, settings.api_key_hash);
                if (match) {
                    req.tenantId = settings.tenant_id;
                    req.tenantSettings = settings;
                    return next();
                }
            }
            // Fall back to plaintext for migration compatibility
            // This is temporary - remove after all keys are migrated
            else if (settings.api_key === apiKey) {
                req.tenantId = settings.tenant_id;
                req.tenantSettings = settings;
                // TODO: Log warning about plaintext API key
                return next();
            }
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
 * @returns {Promise<string>} Hashed API key for storage
 */
export async function hashApiKey(apiKey) {
    const salt = await bcrypt.genSalt(12);
    return bcrypt.hash(apiKey, salt);
}

/**
 * Generate a new API key
 * 
 * @returns {string} A random 32-character API key (base64url encoded)
 */
export function generateApiKey() {
    return crypto.randomBytes(24).toString('base64url');
}

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
        const allSettings = db.prepare('SELECT * FROM tenant_api_settings WHERE is_active = 1').all();
        
        for (const settings of allSettings) {
            if (settings.api_key_hash) {
                const match = await bcrypt.compare(apiKey, settings.api_key_hash);
                if (match) {
                    req.tenantId = settings.tenant_id;
                    req.tenantSettings = settings;
                    return next();
                }
            } else if (settings.api_key === apiKey) {
                req.tenantId = settings.tenant_id;
                req.tenantSettings = settings;
                return next();
            }
        }
    } catch (error) {
        console.error('[OptionalApiKeyAuth] Error:', error);
    }
    
    next();
};

/**
 * Hash an API key for storage
 * Use this when creating or rotating API keys
 * 
 * @param {string} apiKey - The plaintext API key
 * @returns {Promise<string>} Hashed API key for storage
 */
export async function hashApiKey(apiKey) {
    const salt = await bcrypt.genSalt(12);
    return bcrypt.hash(apiKey, salt);
}

/**
 * Generate a new API key
 * 
 * @returns {string} A random 32-character API key (base64url encoded)
 */
export function generateApiKey() {
    // Using sync since this is called during setup/configuration
    return new (await import('crypto')).randomBytes(24).toString('base64url');
}

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
        const allSettings = db.prepare('SELECT * FROM tenant_api_settings WHERE is_active = 1').all();
        
        for (const settings of allSettings) {
            if (settings.api_key_hash) {
                const match = await bcrypt.compare(apiKey, settings.api_key_hash);
                if (match) {
                    req.tenantId = settings.tenant_id;
                    req.tenantSettings = settings;
                    return next();
                }
            } else if (settings.api_key === apiKey) {
                req.tenantId = settings.tenant_id;
                req.tenantSettings = settings;
                return next();
            }
        }
    } catch (error) {
        console.error('[OptionalApiKeyAuth] Error:', error);
    }
    
    next();
};