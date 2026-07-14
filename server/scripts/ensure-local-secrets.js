import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(scriptDir, '..');
const envPath = path.join(serverDir, '.env');
const dbPath = path.join(serverDir, 'db', 'platform.db');

const parseEnvironment = (content) => Object.fromEntries(
    content
        .split(/\r?\n/)
        .map(line => line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/))
        .filter(Boolean)
        .map(match => [match[1], match[2].trim()])
);

const insecureJwtMarkers = [
    'whatsapp_platform_jwt_secret_key_2024_secure',
    'secret',
    'jwt_secret',
    'your-secret-key',
    'change-me',
];

const jwtSecretIsSafe = value => (
    typeof value === 'string'
    && value.length >= 32
    && !insecureJwtMarkers.some(marker => value.includes(marker))
);

const cryptoKeyIsValid = value => /^[0-9a-fA-F]{64}$/.test(value || '');

const encryptedDataExists = () => {
    if (!fs.existsSync(dbPath)) return false;

    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
        const tenantColumns = new Set(
            db.prepare('PRAGMA table_info(tenants)').all().map(column => column.name)
        );
        const pageColumns = new Set(
            db.prepare('PRAGMA table_info(tenant_pages)').all().map(column => column.name)
        );

        const tenantChecks = [
            'access_token_encrypted',
            'facebook_user_access_token_encrypted',
        ].filter(column => tenantColumns.has(column));
        const pageChecks = ['page_access_token_encrypted']
            .filter(column => pageColumns.has(column));

        const tenantCount = tenantChecks.length
            ? db.prepare(`SELECT COUNT(*) AS count FROM tenants WHERE ${tenantChecks.map(column => `${column} IS NOT NULL AND ${column} != ''`).join(' OR ')}`).get().count
            : 0;
        const pageCount = pageChecks.length
            ? db.prepare(`SELECT COUNT(*) AS count FROM tenant_pages WHERE ${pageChecks.map(column => `${column} IS NOT NULL AND ${column} != ''`).join(' OR ')}`).get().count
            : 0;

        return tenantCount + pageCount > 0;
    } finally {
        db.close();
    }
};

const bootstrapAdminRequired = () => {
    if (!fs.existsSync(dbPath)) return true;
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
        const usersTable = db.prepare(
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'users'"
        ).get().count;
        if (!usersTable) return true;
        return db.prepare('SELECT COUNT(*) AS count FROM users').get().count === 0;
    } finally {
        db.close();
    }
};

const current = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
const environment = parseEnvironment(current);
const updates = new Map();

if (!jwtSecretIsSafe(environment.JWT_SECRET)) {
    updates.set('JWT_SECRET', crypto.randomBytes(32).toString('hex'));
}

if (!cryptoKeyIsValid(environment.CRYPTO_KEY)) {
    if (encryptedDataExists()) {
        throw new Error(
            'CRYPTO_KEY is missing or invalid but encrypted database values exist. Restore the original key; do not generate a replacement.'
        );
    }
    updates.set('CRYPTO_KEY', crypto.randomBytes(32).toString('hex'));
}

if (!environment.BOOTSTRAP_ADMIN_PASSWORD && bootstrapAdminRequired()) {
    updates.set('BOOTSTRAP_ADMIN_PASSWORD', crypto.randomBytes(24).toString('base64url'));
}

if (updates.size === 0) {
    console.log('Local runtime secrets are already configured.');
    process.exit(0);
}

let next = current;
const missing = [];

for (const [name, value] of updates) {
    const matcher = new RegExp(`^\\s*${name}=.*$`, 'm');
    if (matcher.test(next)) {
        next = next.replace(matcher, `${name}=${value}`);
    } else {
        missing.push(`${name}=${value}`);
    }
}

if (missing.length > 0) {
    const separator = next.length > 0 && !next.endsWith('\n') ? '\n' : '';
    const heading = next.includes('# Local generated secrets')
        ? ''
        : '# Local generated secrets — never commit this file\n';
    next = `${next}${separator}${heading}${missing.join('\n')}\n`;
}

const tempPath = `${envPath}.tmp-${process.pid}`;
const mode = fs.existsSync(envPath) ? fs.statSync(envPath).mode : 0o600;

fs.writeFileSync(tempPath, next, { encoding: 'utf8', mode });
fs.renameSync(tempPath, envPath);

console.log(`Configured local secret(s): ${[...updates.keys()].join(', ')}`);
