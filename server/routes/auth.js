import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../db/database.js';

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.warn('⚠️ WARNING: JWT_SECRET environment variable is not set. Authentication will fail.');
}
const JWT_EXPIRES_IN = '7d';

// Register new user
router.post('/register', async (req, res) => {
    try {
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

        // Generate token
        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

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

        const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

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

// Logout (client-side, just for logging)
router.post('/logout', (req, res) => {
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

        res.json({ message: 'تم تغيير كلمة المرور بنجاح' });
    } catch (error) {
        console.error('[Auth] Change password error:', error);
        res.status(500).json({ error: 'فشل تغيير كلمة المرور' });
    }
});

export default router;
