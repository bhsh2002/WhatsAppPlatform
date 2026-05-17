import db from '../db/database.js';

// ============================================
// Contacts Service — Contact management operations
// ============================================

/**
 * Get a contact by phone number (optionally tenant-scoped)
 * 
 * @param {string} phone - Phone number
 * @param {number|null} tenantId - Optional tenant ID for tenant-scoped lookup
 * @returns {object|null} Contact record or null
 */
export function getContact(phone, tenantId = null) {
    if (tenantId) {
        return db.prepare('SELECT * FROM contacts WHERE tenant_id = ? AND phone = ?').get(tenantId, phone);
    }
    return db.prepare('SELECT * FROM contacts WHERE phone = ?').get(phone);
}

/**
 * Create or update a contact
 * 
 * @param {object} options
 * @param {number|null} options.tenantId - Tenant ID
 * @param {string} options.phone - Phone number
 * @param {string|null} options.profileName - Profile name from WhatsApp
 * @param {string|null} options.profilePictureUrl - Profile picture URL
 * @returns {object} The created/updated contact
 */
export function upsertContact({ tenantId, phone, profileName, profilePictureUrl }) {
    const existing = getContact(phone, tenantId);
    
    if (existing) {
        // Update existing contact
        const updates = [];
        const values = [];
        
        if (profileName !== undefined) {
            updates.push('profile_name = COALESCE(?, profile_name)');
            values.push(profileName);
        }
        if (profilePictureUrl !== undefined) {
            updates.push('profile_picture_url = COALESCE(?, profile_picture_url)');
            values.push(profilePictureUrl);
        }
        updates.push("updated_at = datetime('now', 'localtime')");
        
        if (updates.length > 1) {
            values.push(tenantId || null, phone);
            db.prepare(`UPDATE contacts SET ${updates.join(', ')} WHERE tenant_id IS ? AND phone = ?`)
                .run(...values);
        }
        
        return getContact(phone, tenantId);
    }
    
    // Create new contact
    const result = db.prepare(`
        INSERT INTO contacts (tenant_id, phone, profile_name, profile_picture_url)
        VALUES (?, ?, ?, ?)
    `).run(tenantId || null, phone, profileName || null, profilePictureUrl || null);
    
    return { id: result.lastInsertRowid, tenant_id: tenantId, phone, profile_name: profileName, profile_picture_url: profilePictureUrl };
}

/**
 * Update the last customer message timestamp for 24h window tracking
 * 
 * @param {string} phone - Phone number
 * @param {number|null} tenantId - Tenant ID
 */
export function updateLastCustomerMessage(phone, tenantId = null) {
    if (tenantId) {
        db.prepare(`
            UPDATE contacts 
            SET last_customer_message_at = datetime('now', 'localtime'), updated_at = datetime('now', 'localtime') 
            WHERE tenant_id = ? AND phone = ?
        `).run(tenantId, phone);
    } else {
        db.prepare(`
            UPDATE contacts 
            SET last_customer_message_at = datetime('now', 'localtime'), updated_at = datetime('now', 'localtime') 
            WHERE phone = ? AND tenant_id IS NULL
        `).run(phone);
    }
}

/**
 * Check if a conversation window is open (within 24h of last customer message)
 * 
 * @param {string} phone - Phone number
 * @param {number|null} tenantId - Tenant ID
 * @returns {{ isOpen: boolean, lastMessageAt: Date|null, closesAt: Date|null }}
 */
export function checkConversationWindow(phone, tenantId = null) {
    const contact = getContact(phone, tenantId);
    
    if (!contact || !contact.last_customer_message_at) {
        return { isOpen: false, lastMessageAt: null, closesAt: null };
    }
    
    const lastMessageAt = new Date(contact.last_customer_message_at);
    const windowMs = 24 * 60 * 60 * 1000; // 24 hours
    const closesAt = new Date(lastMessageAt.getTime() + windowMs);
    const isOpen = Date.now() < closesAt.getTime();
    
    return { isOpen, lastMessageAt, closesAt };
}

/**
 * Get all contacts for a tenant
 * 
 * @param {number} tenantId - Tenant ID
 * @param {object} options - Optional filters
 * @returns {Array} Array of contacts
 */
export function getTenantContacts(tenantId, { limit = 100, offset = 0 } = {}) {
    return db.prepare(`
        SELECT * FROM contacts 
        WHERE tenant_id = ? 
        ORDER BY updated_at DESC 
        LIMIT ? OFFSET ?
    `).all(tenantId, limit, offset);
}

/**
 * Search contacts by name or phone
 * 
 * @param {number} tenantId - Tenant ID
 * @param {string} query - Search query
 * @param {object} options - Optional filters
 * @returns {Array} Array of matching contacts
 */
export function searchContacts(tenantId, query, { limit = 50 } = {}) {
    const searchTerm = `%${query}%`;
    return db.prepare(`
        SELECT * FROM contacts 
        WHERE tenant_id = ? AND (phone LIKE ? OR profile_name LIKE ?)
        ORDER BY updated_at DESC 
        LIMIT ?
    `).all(tenantId, searchTerm, searchTerm, limit);
}
