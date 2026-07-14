import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { digestApiKey, isLegacyBcryptDigest } from '../security/apiKeys.js';
import { encrypt, initEncryption, isEncrypted } from '../services/encryption.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(scriptDir, '../db/platform.db');
const apply = process.argv.includes('--apply');
const backupConfirmed = process.argv.includes('--backup-confirmed');

if (apply && !backupConfirmed) {
    throw new Error('Refusing to apply without --backup-confirmed. Create and verify a database backup first.');
}

initEncryption();
const db = new Database(dbPath, { fileMustExist: true });
db.pragma('foreign_keys = ON');

try {
    const tenantRows = db.prepare(`
        SELECT id, access_token, access_token_encrypted
        FROM tenants
        WHERE access_token IS NOT NULL AND access_token != ''
    `).all();
    const apiRows = db.prepare(`
        SELECT id, api_key, api_key_hash, webhook_secret
        FROM tenant_api_settings
    `).all();

    const plaintextApiRows = apiRows.filter(row => row.api_key);
    const plaintextWebhookRows = apiRows.filter(
        row => row.webhook_secret && !isEncrypted(row.webhook_secret)
    );
    const bcryptApiRows = apiRows.filter(row => isLegacyBcryptDigest(row.api_key_hash));

    const summary = {
        plaintext_tenant_tokens: tenantRows.length,
        plaintext_api_keys: plaintextApiRows.length,
        plaintext_webhook_secrets: plaintextWebhookRows.length,
        bcrypt_api_keys_requiring_rotation: bcryptApiRows.length,
    };

    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...summary }, null, 2));

    if (!apply) {
        console.log('Dry run only. Use --apply --backup-confirmed after verifying a backup.');
        process.exit(0);
    }

    const migrate = db.transaction(() => {
        const updateTenant = db.prepare(`
            UPDATE tenants
            SET access_token = NULL,
                access_token_encrypted = ?,
                updated_at = datetime('now', 'localtime')
            WHERE id = ?
        `);
        for (const row of tenantRows) {
            updateTenant.run(
                row.access_token_encrypted || encrypt(row.access_token),
                row.id
            );
        }

        const updateApiKey = db.prepare(`
            UPDATE tenant_api_settings
            SET api_key = NULL,
                api_key_hash = ?,
                updated_at = datetime('now', 'localtime')
            WHERE id = ?
        `);
        for (const row of plaintextApiRows) {
            updateApiKey.run(digestApiKey(row.api_key), row.id);
        }

        const updateWebhookSecret = db.prepare(`
            UPDATE tenant_api_settings
            SET webhook_secret = ?,
                updated_at = datetime('now', 'localtime')
            WHERE id = ?
        `);
        for (const row of plaintextWebhookRows) {
            updateWebhookSecret.run(encrypt(row.webhook_secret), row.id);
        }
    });

    migrate();
    console.log('Credential migration applied. Legacy bcrypt API keys were not changed and must be rotated.');
} finally {
    db.close();
}
