import bcrypt from 'bcryptjs';

const PLACEHOLDER_PASSWORDS = new Set([
    'admin123',
    'password',
    'change-me',
    'changeme',
]);

export class BootstrapAdminError extends Error {
    constructor(message, code) {
        super(message);
        this.name = 'BootstrapAdminError';
        this.code = code;
    }
}

export async function ensureBootstrapAdmin(db, {
    password,
    username = 'admin',
    email = 'admin@localhost.invalid',
    name = 'مدير النظام',
} = {}) {
    const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
    if (userCount > 0) return { created: false };

    const normalizedPassword = String(password || '');
    const normalizedUsername = String(username || '').trim();
    const normalizedEmail = String(email || '').trim() || null;

    if (!normalizedPassword) {
        throw new BootstrapAdminError(
            'No users exist. Set BOOTSTRAP_ADMIN_PASSWORD before the first startup.',
            'BOOTSTRAP_PASSWORD_REQUIRED'
        );
    }
    if (normalizedPassword.length < 16 || PLACEHOLDER_PASSWORDS.has(normalizedPassword.toLowerCase())) {
        throw new BootstrapAdminError(
            'BOOTSTRAP_ADMIN_PASSWORD must be at least 16 characters and must not be a placeholder.',
            'BOOTSTRAP_PASSWORD_WEAK'
        );
    }
    if (!/^[A-Za-z0-9._-]{3,64}$/.test(normalizedUsername)) {
        throw new BootstrapAdminError(
            'BOOTSTRAP_ADMIN_USERNAME must contain 3-64 letters, digits, dots, underscores, or hyphens.',
            'BOOTSTRAP_USERNAME_INVALID'
        );
    }

    const passwordHash = await bcrypt.hash(normalizedPassword, 12);
    db.prepare(`
        INSERT INTO users (username, email, password_hash, name, role, is_active)
        VALUES (?, ?, ?, ?, 'admin', 1)
    `).run(normalizedUsername, normalizedEmail, passwordHash, String(name || 'مدير النظام'));

    return { created: true, username: normalizedUsername };
}
