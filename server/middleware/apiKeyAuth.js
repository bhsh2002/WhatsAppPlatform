import db from '../db/database.js';

/**
 * API Key Authentication Middleware
 * Validates X-API-Key header for external API access
 */
export const apiKeyAuth = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey) {
        return res.status(401).json({ 
            error: 'API key required',
            message: 'Include X-API-Key header with your API key'
        });
    }
    
    try {
        const settings = db.prepare('SELECT * FROM tenant_api_settings WHERE api_key = ?').get(apiKey);
        
        if (!settings) {
            return res.status(401).json({ 
                error: 'Invalid API key',
                message: 'The provided API key is not valid'
            });
        }
        
        // Check if API is active
        if (settings.is_active === 0) {
            return res.status(403).json({ 
                error: 'API key disabled',
                message: 'This API key has been disabled. Contact support.'
            });
        }
        
        // Attach tenant info to request
        req.tenantId = settings.tenant_id;
        req.tenantSettings = settings;
        
        next();
    } catch (error) {
        console.error('[ApiKeyAuth] Error:', error);
        return res.status(500).json({ 
            error: 'Authentication error',
            message: 'An error occurred while validating the API key'
        });
    }
};

/**
 * Optional API Key Authentication
 * Adds tenant info if API key is present, but doesn't fail if missing
 */
export const optionalApiKeyAuth = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey) {
        return next();
    }
    
    try {
        const settings = db.prepare('SELECT * FROM tenant_api_settings WHERE api_key = ?').get(apiKey);
        
        if (settings && settings.is_active !== 0) {
            req.tenantId = settings.tenant_id;
            req.tenantSettings = settings;
        }
    } catch (error) {
        console.error('[OptionalApiKeyAuth] Error:', error);
    }
    
    next();
};