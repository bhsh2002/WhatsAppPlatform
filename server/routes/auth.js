import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import db from '../db/database.js';
import { JWT_SECRET, JWT_EXPIRES_IN } from '../config/index.js';

const router = express.Router();

// Helper: sign a JWT with a unique jti for revocation support
function signToken(payload) {
    const jti = crypto.randomUUID();
    const token = jwt.sign({ ...payload, jti }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    return { token, jti };
}

// Helper: revoke a specific token by jti
function revokeToken(jti, userId) {
    // Calculate expiry (7 days from now — matches JWT_EXPIRES_IN)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('INSERT OR IGNORE INTO revoked_tokens (jti, user_id, expires_at) VALUES (?, ?, ?)')
        .run(jti, userId, expiresAt);
}

// Helper: revoke ALL tokens for a user
function revokeAllUserTokens(userId) {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    // We can't enumerate all JTIs, but we record a user-level revocation
    // The middleware checks both jti and user-level revocation
    db.prepare('INSERT OR IGNORE INTO revoked_tokens (jti, user_id, expires_at) VALUES (?, ?, ?)')
        .run(`user_revoke_${userId}_${Date.now()}`, userId, expiresAt);
}

// Register new user (admin only — requires valid admin token)
router.post('/register', async (req, res) => {
    try {
        // Verify admin authorization
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'التسجيل مقتصر على المديرين فقط' });
        }
        try {
            const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
            if (decoded.role !== 'admin') {
                return res.status(403).json({ error: 'صلاحيات غير كافية — فقط المديرون يمكنهم إنشاء حسابات' });
            }
        } catch {
            return res.status(401).json({ error: 'رمز غير صالح أو منتهي الصلاحية' });
        }

        const { username, email, password, name } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبة' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
        }

        // Check if username exists
        const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
        if (existing) {
            return res.status(400).json({ error: 'اسم المستخدم موجود مسبقاً' });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);

        // Insert user
        const stmt = db.prepare(`
      INSERT INTO users (username, email, password_hash, name, role)
      VALUES (?, ?, ?, ?, 'user')
    `);

        const result = stmt.run(username, email || null, password_hash, name || username);

        // Get created user (without password)
        const user = db.prepare('SELECT id, username, email, name, role, created_at FROM users WHERE id = ?')
            .get(result.lastInsertRowid);

        // Generate token with jti for revocation support
        const { token } = signToken({ id: user.id, username: user.username, role: user.role });

        res.status(201).json({
            message: 'تم إنشاء الحساب بنجاح',
            user,
            token
        });
    } catch (error) {
        console.error('[Auth] Register error:', error);
        res.status(500).json({ error: 'فشل إنشاء الحساب' });
    }
});

// Login
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبة' });
        }

        // Find user
        const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
        if (!user) {
            return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
        }

        // Check if active
        if (!user.is_active) {
            return res.status(401).json({ error: 'الحساب غير مُفعّل' });
        }

        // Verify password
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
        }

        // Update last login
        db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);

        // Generate token with tenant_id if applicable
        const tokenPayload = {
            id: user.id,
            username: user.username,
            role: user.role
        };

        if (user.tenant_id) {
            tokenPayload.tenant_id = user.tenant_id;
        }

        const { token } = signToken(tokenPayload);

        // Return user without password
        const { password_hash, ...userWithoutPassword } = user;

        // Include tenant info if user has a tenant_id (they are a tenant user)
        let tenant = null;
        if (user.tenant_id) {
            tenant = db.prepare('SELECT id, name, phone, status, tier, credits, quality, phone_number_id, waba_id, business_id, dataset_id FROM tenants WHERE id = ?')
                .get(user.tenant_id);
        }

        res.json({
            message: 'تم تسجيل الدخول بنجاح',
            user: userWithoutPassword,
            tenant,
            token
        });
    } catch (error) {
        console.error('[Auth] Login error:', error);
        res.status(500).json({ error: 'فشل تسجيل الدخول' });
    }
});

// Get current user (verify token)
router.get('/me', (req, res) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'غير مصرح' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET);

        const user = db.prepare('SELECT id, username, email, name, role, tenant_id, created_at, last_login FROM users WHERE id = ?')
            .get(decoded.id);

        if (!user) {
            return res.status(401).json({ error: 'المستخدم غير موجود' });
        }

        // If user has tenant_id, include tenant info
        let tenant = null;
        if (user.tenant_id) {
            tenant = db.prepare('SELECT id, name, phone, status, tier, credits, quality, phone_number_id, waba_id, business_id, dataset_id FROM tenants WHERE id = ?')
                .get(user.tenant_id);
        }

        res.json({ user, tenant });
    } catch (error) {
        return res.status(401).json({ error: 'رمز غير صالح' });
    }
});

// Logout — server-side token revocation
router.post('/logout', (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];
            const decoded = jwt.verify(token, JWT_SECRET, { ignoreExpiration: true });
            if (decoded.jti) {
                revokeToken(decoded.jti, decoded.id);
            }
        }
    } catch (e) {
        // Token invalid — no need to revoke
    }
    res.json({ message: 'تم تسجيل الخروج' });
});

// Change password
router.post('/change-password', async (req, res) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'غير مصرح' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'كلمة المرور الحالية والجديدة مطلوبة' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل' });
        }

        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.id);

        const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ error: 'كلمة المرور الحالية غير صحيحة' });
        }

        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(newPassword, salt);

        db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(password_hash, decoded.id);

        // Revoke the current token (user must re-login)
        if (decoded.jti) {
            revokeToken(decoded.jti, decoded.id);
        }

        // Issue a fresh token
        const { token: newToken } = signToken({ id: decoded.id, username: decoded.username, role: decoded.role, tenant_id: decoded.tenant_id });

        res.json({ message: 'تم تغيير كلمة المرور بنجاح', token: newToken });
    } catch (error) {
        console.error('[Auth] Change password error:', error);
        res.status(500).json({ error: 'فشل تغيير كلمة المرور' });
    }
});

// ============================================
// Tenant Self-Registration (public, rate-limited)
// ============================================
router.post('/register-tenant', async (req, res) => {
    try {
        const { business_name, phone, username, password, email, contact_name } = req.body;

        // Validation
        if (!business_name || !phone || !username || !password) {
            return res.status(400).json({
                error: 'جميع الحقول مطلوبة: اسم النشاط التجاري، رقم الهاتف، اسم المستخدم، وكلمة المرور',
            });
        }

        if (password.length < 8) {
            return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' });
        }

        // Check for duplicates
        const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
        if (existingUser) {
            return res.status(409).json({ error: 'اسم المستخدم مستخدم بالفعل' });
        }

        const existingTenant = db.prepare('SELECT id FROM tenants WHERE phone = ?').get(phone);
        if (existingTenant) {
            return res.status(409).json({ error: 'رقم الهاتف مسجل بالفعل' });
        }

        // Create tenant + user in a transaction
        const password_hash = await bcrypt.hash(password, 10);

        const result = db.transaction(() => {
            // Create tenant with Pending status
            const tenantResult = db.prepare(`
                INSERT INTO tenants (name, phone, status, tier, credits)
                VALUES (?, ?, 'Pending', '1K', 0)
            `).run(business_name, phone);

            const tenantId = tenantResult.lastInsertRowid;

            // Create user account
            db.prepare(`
                INSERT INTO users (username, email, password_hash, name, role, tenant_id, is_active)
                VALUES (?, ?, ?, ?, 'user', ?, 1)
            `).run(username, email || null, password_hash, contact_name || business_name, tenantId);

            return tenantId;
        })();

        // Log activity
        db.prepare(`
            INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
            VALUES (?, ?, 'tenant_registered', 'تسجيل عميل جديد (في انتظار الموافقة)', 'success')
        `).run(result, business_name);

        res.status(201).json({
            success: true,
            message: 'تم التسجيل بنجاح. حسابك في انتظار موافقة المدير.',
            tenant_id: result,
        });
    } catch (error) {
        console.error('[Auth] Tenant registration error:', error);
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({ error: 'البيانات المدخلة مسجلة بالفعل' });
        }
        res.status(500).json({ error: 'فشل التسجيل' });
    }
});

export default router;
