import db from './server/db/database.js';

try {
    const messages = db.prepare('SELECT id, sender, recipient, tenant_id, content FROM messages ORDER BY id DESC LIMIT 20').all();
    console.log('Last 20 messages:');
    console.table(messages);

    const conversations = db.prepare(`
        SELECT 
            t.contact,
            t.tenant_id,
            count(*) as count
        FROM (
            SELECT 
                tenant_id,
                CASE 
                    WHEN direction = 'incoming' THEN sender 
                    ELSE recipient 
                END as contact
            FROM messages
        ) t
        GROUP BY t.contact, t.tenant_id
    `).all();
    console.log('Conversations content:');
    console.table(conversations);

} catch (e) {
    console.error(e);
}
