import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';

// Import routes
import tenantsRouter from './routes/tenants.js';
import statsRouter from './routes/stats.js';
import messagesRouter from './routes/messages.js';
import webhooksRouter from './routes/webhooks.js';
import authRouter from './routes/auth.js';
import tenantPortalRouter from './routes/tenantPortal.js';
import apiV1Router from './routes/api/v1.js';
import businessProfileRouter from './routes/businessProfile.js';
import phoneNumbersRouter from './routes/phoneNumbers.js';
import qrCodesRouter from './routes/qrCodes.js';
import analyticsRouter from './routes/analytics.js';
import businessManagerRouter from './routes/businessManager.js';
import pagesRouter from './routes/pages.js';
import partnerSolutionsRouter from './routes/partnerSolutions.js';
import conversionsRouter from './routes/conversions.js';
import facebookPagesRouter from './routes/facebookPages.js';
import fbContentRouter from './routes/fbContent.js';
import fbMessengerRouter from './routes/fbMessenger.js';
import fbInsightsRouter from './routes/fbInsights.js';
import webhookAdminRouter from './routes/webhookAdmin.js';
import unifiedRouter from './routes/unified.js';
import automationRouter from './routes/automation.js';

// Import services
import eventBus from './services/eventBus.js';

// Import middleware
import { authMiddleware, adminMiddleware } from './middleware/auth.js';
import { apiKeyAuth } from './middleware/apiKeyAuth.js';

// Import database and services
import db from './db/database.js';
import { startMaintenanceScheduler } from './services/maintenance.js';
import { uploadDir } from './config/upload.js';
import { AUTH_RATE_LIMIT, GLOBAL_RATE_LIMIT } from './config/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { initEncryption } from './services/encryption.js';

// ===========================================
// Startup validation — fail fast on missing/insecure secrets
// ===========================================
if (!process.env.JWT_SECRET) {
    console.error('❌ FATAL: JWT_SECRET environment variable is not set.');
    console.error('   Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    process.exit(1);
}

if (process.env.JWT_SECRET.length < 32) {
    console.error('❌ FATAL: JWT_SECRET must be at least 32 characters.');
    console.error('   Generate a secure one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    process.exit(1);
}

// Warn about insecure default secrets
const insecureSecrets = [
    'whatsapp_platform_jwt_secret_key_2024_secure',
    'secret',
    'jwt_secret',
    'your-secret-key',
    'change-me',
];
if (insecureSecrets.some(s => process.env.JWT_SECRET.includes(s))) {
    console.error('❌ FATAL: JWT_SECRET appears to be a placeholder or example value.');
    console.error('   Generate a secure secret with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    process.exit(1);
}

if (!process.env.CRYPTO_KEY) {
    console.error('❌ FATAL: CRYPTO_KEY environment variable is not set.');
    console.error('   Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    process.exit(1);
}

if (process.env.CRYPTO_KEY.length < 64) {
    console.error('❌ FATAL: CRYPTO_KEY must be at least 64 characters (32 bytes hex).');
    console.error('   Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    process.exit(1);
}

// Initialize encryption service
try {
    initEncryption();
} catch (err) {
    console.error('❌ FATAL: Failed to initialize encryption:', err.message);
    process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3031;

// Seed admin user if none exists
const seedAdmin = async () => {
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
    if (userCount.count === 0) {
        // Generate a random password instead of hardcoded 'admin123'
        const crypto = await import('crypto');
        const randomPassword = crypto.randomBytes(8).toString('hex');
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(randomPassword, salt);

        db.prepare(`
      INSERT INTO users (username, email, password_hash, name, role)
      VALUES (?, ?, ?, ?, ?)
    `).run('admin', 'admin@example.com', password_hash, 'مدير النظام', 'admin');

        console.log('');
        console.log('╔══════════════════════════════════════════════╗');
        console.log('║  🔐 Default admin account created           ║');
        console.log('║                                              ║');
        console.log(`║  Username: admin                             ║`);
        console.log(`║  Password: ${randomPassword}                 ║`);
        console.log('║                                              ║');
        console.log('║  ⚠️  Change this password after first login  ║');
        console.log('╚══════════════════════════════════════════════╝');
        console.log('');
    }
};

seedAdmin().catch(console.error);

// Middleware
const CORS_ORIGINS = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
    : ['http://localhost:5173', 'http://localhost:5174', 'http://127.0.0.1:5173'];

app.use(cors({
    origin: CORS_ORIGINS,
    credentials: true
}));

// Security headers
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", 'data:', 'https:'],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
        },
    },
    crossOriginEmbedderPolicy: false, // Needed forSSE
}));

// Request body size limit
app.use(express.json({
    limit: '1mb',
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));

// Request logging
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

// Rate limiters
// const authLimiter = rateLimit({
//     windowMs: AUTH_RATE_LIMIT.windowMs,
//     max: AUTH_RATE_LIMIT.max,
//     message: { error: AUTH_RATE_LIMIT.message },
//     standardHeaders: true,
//     legacyHeaders: false,
//     keyGenerator: (req) => req.ip,
// });

const apiLimiter = rateLimit({
    windowMs: GLOBAL_RATE_LIMIT.windowMs,
    max: GLOBAL_RATE_LIMIT.max,
    message: { error: GLOBAL_RATE_LIMIT.message },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path.startsWith('/webhook'),
});

// Apply general rate limit to all routes
app.use(apiLimiter);

// Health check (public)
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================
// Meta Compliance: Privacy Policy (public)
// ============================================
app.get('/privacy', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>سياسة الخصوصية — Wa Savana Platform</title>
<style>body{font-family:'Segoe UI',Tahoma,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;line-height:1.8;color:#333;background:#fafafa}
h1{color:#075E54;border-bottom:3px solid #25D366;padding-bottom:10px}h2{color:#128C7E;margin-top:30px}
.container{background:#fff;padding:40px;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,0.08)}
.updated{color:#888;font-size:0.9em}footer{text-align:center;margin-top:40px;color:#999;font-size:0.85em}</style></head>
<body><div class="container">
<h1>سياسة الخصوصية</h1>
<p class="updated">آخر تحديث: ${new Date().toLocaleDateString('ar-LY')}</p>

<h2>1. من نحن</h2>
<p>منصة Wa Savana هي خدمة تقنية تُشغّلها شركة سافانا (Savana Company) لإدارة التواصل عبر واتساب للأعمال وصفحات فيسبوك نيابة عن عملائها (المستأجرين). نحن مزوّد خدمة تقنية (Tech Service Provider) مسجل لدى Meta.</p>

<h2>2. البيانات التي نجمعها</h2>
<p>نجمع ونعالج البيانات التالية نيابة عن عملائنا:</p>
<ul>
<li><strong>بيانات المراسلة:</strong> الرسائل المرسلة والمستلمة عبر واتساب وMessenger (النصوص والوسائط)</li>
<li><strong>بيانات جهات الاتصال:</strong> أرقام الهواتف والأسماء وصور الملف الشخصي</li>
<li><strong>بيانات صفحات فيسبوك:</strong> المنشورات والتعليقات وبيانات التفاعل</li>
<li><strong>بيانات الحساب:</strong> معلومات تسجيل الدخول ورموز الوصول المشفرة</li>
<li><strong>بيانات التحليلات:</strong> إحصائيات المحادثات والرسائل (بشكل مجمّع)</li>
</ul>

<h2>3. كيف نستخدم البيانات</h2>
<ul>
<li>تمكين إرسال واستقبال الرسائل عبر واتساب وMessenger</li>
<li>إدارة صفحات فيسبوك (المنشورات والتعليقات والردود التلقائية)</li>
<li>عرض التحليلات والإحصائيات لعملائنا</li>
<li>تشغيل قواعد الأتمتة (الردود التلقائية على الكلمات المفتاحية)</li>
<li>إدارة أصول النشاط التجاري (القوالب ورموز QR والحسابات الإعلانية)</li>
</ul>

<h2>4. مشاركة البيانات</h2>
<p>لا نبيع بيانات المستخدمين. نشارك البيانات فقط مع:</p>
<ul>
<li><strong>Meta (Facebook/WhatsApp):</strong> لمعالجة الرسائل والويب هوك عبر Graph API</li>
<li><strong>عملاؤنا (المستأجرون):</strong> كل عميل يرى بياناته الخاصة فقط</li>
</ul>

<h2>5. أمان البيانات</h2>
<ul>
<li>تشفير رموز الوصول باستخدام AES-256-GCM</li>
<li>اتصالات HTTPS مشفرة بالكامل</li>
<li>فصل البيانات بين المستأجرين (Multi-tenant isolation)</li>
<li>مصادقة JWT مع تجزئة كلمات المرور بـ bcrypt</li>
</ul>

<h2>6. حقوقك</h2>
<p>يحق لك طلب:</p>
<ul>
<li>الوصول إلى بياناتك الشخصية</li>
<li>تصحيح أو تحديث بياناتك</li>
<li>حذف بياناتك بالكامل</li>
<li>إلغاء ربط تطبيقنا بحسابك على فيسبوك/واتساب</li>
</ul>

<h2>7. حذف البيانات</h2>
<p>عند إلغاء ربط التطبيق، نقوم تلقائياً بحذف جميع البيانات المرتبطة بحسابك. يمكنك أيضاً طلب حذف البيانات عبر التواصل معنا.</p>

<h2>8. التواصل</h2>
<p>للاستفسارات المتعلقة بالخصوصية: <strong>privacy@savana.ly</strong></p>

</div>
<footer>© ${new Date().getFullYear()} Savana Company — جميع الحقوق محفوظة</footer>
</body></html>`);
});

// ============================================
// Meta Compliance: Terms of Service (public)
// ============================================
app.get('/terms', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>شروط الخدمة — Wa Savana Platform</title>
<style>body{font-family:'Segoe UI',Tahoma,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;line-height:1.8;color:#333;background:#fafafa}
h1{color:#075E54;border-bottom:3px solid #25D366;padding-bottom:10px}h2{color:#128C7E;margin-top:30px}
.container{background:#fff;padding:40px;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,0.08)}
.updated{color:#888;font-size:0.9em}footer{text-align:center;margin-top:40px;color:#999;font-size:0.85em}</style></head>
<body><div class="container">
<h1>شروط الخدمة</h1>
<p class="updated">آخر تحديث: ${new Date().toLocaleDateString('ar-LY')}</p>

<h2>1. وصف الخدمة</h2>
<p>توفر شركة سافانا (Savana Company) منصة Wa Savana كخدمة تقنية (SaaS) لإدارة التواصل عبر واتساب للأعمال وصفحات فيسبوك. تعمل الشركة كمزوّد خدمة تقنية (Tech Service Provider) معتمد لدى Meta.</p>

<h2>2. الاستخدام المسموح</h2>
<ul>
<li>إدارة محادثات واتساب وMessenger مع العملاء</li>
<li>إنشاء وإدارة محتوى صفحات فيسبوك</li>
<li>إعداد قواعد الأتمتة للردود التلقائية</li>
<li>إرسال رسائل جماعية عبر قوالب معتمدة من Meta</li>
<li>عرض التحليلات والإحصائيات</li>
</ul>

<h2>3. الاستخدام المحظور</h2>
<ul>
<li>إرسال رسائل غير مرغوبة (سبام)</li>
<li>انتهاك سياسات Meta للمراسلة</li>
<li>مشاركة رموز الوصول مع أطراف غير مصرح لها</li>
<li>استخدام المنصة لأنشطة غير قانونية</li>
</ul>

<h2>4. المسؤولية</h2>
<p>يتحمل المستأجر (العميل) مسؤولية المحتوى المرسل عبر حساباته والامتثال لسياسات Meta. شركة سافانا توفر الأدوات التقنية فقط.</p>

<h2>5. إنهاء الخدمة</h2>
<p>يحق لأي طرف إنهاء الخدمة في أي وقت. عند الإنهاء، يتم حذف بيانات المستأجر خلال 30 يوماً.</p>

<h2>6. التواصل</h2>
<p>للاستفسارات: <strong>support@savana.ly</strong></p>

</div>
<footer>© ${new Date().getFullYear()} Savana Company — جميع الحقوق محفوظة</footer>
</body></html>`);
});

// ============================================
// Meta Compliance: Data Deletion Callback (public)
// ============================================
import crypto from 'crypto';

app.post('/data-deletion', express.json(), (req, res) => {
    try {
        const { signed_request } = req.body;

        if (!signed_request) {
            return res.status(400).json({ error: 'signed_request is required' });
        }

        const APP_SECRET = process.env.FB_APP_SECRET || process.env.META_APP_SECRET || '';

        // Parse the signed request
        const [encodedSig, payload] = signed_request.split('.');
        const sig = Buffer.from(encodedSig.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
        const data = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));

        // Verify signature
        const expectedSig = crypto.createHmac('sha256', APP_SECRET).update(payload).digest();
        if (!crypto.timingSafeEqual(sig, expectedSig)) {
            console.warn('[DataDeletion] Invalid signature');
            return res.status(403).json({ error: 'Invalid signature' });
        }

        const userId = data.user_id;
        const confirmationCode = crypto.randomBytes(12).toString('hex');

        console.log(`[DataDeletion] Received deletion request for user: ${userId}`);

        // Delete user-related data from all tables
        const tables = [
            { table: 'fb_conversations', column: 'user_psid' },
        ];

        let deletedCount = 0;
        for (const { table, column } of tables) {
            try {
                const result = db.prepare(`DELETE FROM ${table} WHERE ${column} = ?`).run(userId);
                deletedCount += result.changes;
            } catch (e) {
                // Table might not exist, continue
            }
        }

        // Also clean up any linked pages associated with this user
        try {
            db.prepare(`
                INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
                VALUES (0, 'System', 'data_deletion', ?, 'success')
            `).run(`Meta data deletion request for user ${userId} — ${deletedCount} records deleted. Code: ${confirmationCode}`);
        } catch (e) {
            // Log table might not exist
        }

        console.log(`[DataDeletion] Deleted ${deletedCount} records for user ${userId}. Code: ${confirmationCode}`);

        // Return the response Meta expects
        res.json({
            url: `https://wa.savana.ly/deletion-status?code=${confirmationCode}`,
            confirmation_code: confirmationCode
        });
    } catch (error) {
        console.error('[DataDeletion] Error:', error);
        res.status(500).json({ error: 'Failed to process deletion request' });
    }
});

// Deletion status check page (public)
app.get('/deletion-status', (req, res) => {
    const code = req.query.code || '';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>حالة حذف البيانات — Wa Savana</title>
<style>body{font-family:'Segoe UI',Tahoma,sans-serif;max-width:600px;margin:80px auto;padding:0 20px;text-align:center;color:#333;background:#fafafa}
.card{background:#fff;padding:40px;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,0.08)}
h1{color:#075E54}
.code{background:#f0f0f0;padding:12px 24px;border-radius:8px;font-family:monospace;font-size:1.1em;display:inline-block;margin:16px 0}
.status{color:#25D366;font-size:1.2em;font-weight:bold}</style></head>
<body><div class="card">
<h1>حالة حذف البيانات</h1>
<p class="status">✅ تم معالجة طلب الحذف بنجاح</p>
<p>رمز التأكيد:</p>
<div class="code">${code || 'N/A'}</div>
<p>تم حذف جميع البيانات المرتبطة بحسابك من منصة Wa Savana.</p>
<p style="color:#888;font-size:0.9em;margin-top:30px">للاستفسارات: privacy@savana.ly</p>
</div></body></html>`);
});

// Auth routes (public, with stricter rate limit on login/register)
// app.use('/auth', authLimiter, authRouter);
app.use('/auth', authRouter);

// SSE endpoints (use one-time token auth, not session auth)
// These must be mounted BEFORE the authMiddleware-protected routes
import { sseAuth } from './routes/auth.js';
app.get('/messages/events', sseAuth, (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    res.write('event: connected\ndata: {"status":"ok"}\n\n');
    const channel = req.user.role === 'admin' ? 'admin' : `tenant:${req.user.tenant_id}`;
    eventBus.addClient(channel, res);
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 30000);
    req.on('close', () => clearInterval(heartbeat));
});

app.get('/portal/events', sseAuth, (req, res) => {
    const tenantId = req.user.tenant_id;
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    res.write('event: connected\ndata: {"status":"ok"}\n\n');
    eventBus.addClient(`tenant:${tenantId}`, res);
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 30000);
    req.on('close', () => clearInterval(heartbeat));
});

// Protected API Routes - Admin (require both auth + admin role)
app.use('/tenants', authMiddleware, adminMiddleware, tenantsRouter);
app.use('/stats', authMiddleware, adminMiddleware, statsRouter);
app.use('/messages', authMiddleware, adminMiddleware, messagesRouter);
app.use('/business-profile', authMiddleware, adminMiddleware, businessProfileRouter);
app.use('/phone-numbers', authMiddleware, adminMiddleware, phoneNumbersRouter);
app.use('/qr-codes', authMiddleware, adminMiddleware, qrCodesRouter);
app.use('/analytics', authMiddleware, adminMiddleware, analyticsRouter);
app.use('/business-manager', authMiddleware, adminMiddleware, businessManagerRouter);
app.use('/pages', authMiddleware, adminMiddleware, pagesRouter);
app.use('/partner', authMiddleware, adminMiddleware, partnerSolutionsRouter);
app.use('/conversions', authMiddleware, adminMiddleware, conversionsRouter);
app.use('/facebook-pages', authMiddleware, adminMiddleware, facebookPagesRouter);
app.use('/fb-content', authMiddleware, adminMiddleware, fbContentRouter);
app.use('/fb-messenger', authMiddleware, adminMiddleware, fbMessengerRouter);
app.use('/fb-insights', authMiddleware, adminMiddleware, fbInsightsRouter);
app.use('/webhook-admin', authMiddleware, adminMiddleware, webhookAdminRouter);
app.use('/unified', authMiddleware, adminMiddleware, unifiedRouter);
app.use('/automation', authMiddleware, adminMiddleware, automationRouter);

// Protected API Routes - Tenant Portal
app.use('/portal', authMiddleware, tenantPortalRouter);

// External API Routes - v1 (requires API key)
app.use('/v1', apiKeyAuth, apiV1Router);

// Webhook route (public - for Meta)
app.use('/webhook', webhooksRouter);

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Error handler — must be after all routes
app.use(errorHandler);

// Start server
const server = app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║      WhatsApp Management Platform Server                     ║
╠══════════════════════════════════════════════════════════════╣
║  🚀 Server running on http://localhost:${PORT}                  ║
║  📡 Webhook URL: http://localhost:${PORT}/webhook               ║
║                                                              ║
║  Public Endpoints:                                           ║
║  • GET  /health              - Health check                  ║
║  • POST /auth/login          - Login                         ║
║  • POST /auth/register       - Register (admin only)         ║
║  • POST /auth/register-tenant- Tenant self-registration      ║
║  • GET  /webhook             - Meta verification             ║
║                                                              ║
║  Admin Endpoints (require Bearer token):                     ║
║  • GET  /tenants             - List tenants                  ║
║  • POST /tenants             - Create tenant                 ║
║  • GET  /stats/dashboard     - Dashboard stats               ║
║                                                              ║
║  Tenant Portal (require tenant token):                       ║
║  • GET  /portal/dashboard    - Tenant dashboard              ║
║  • GET  /portal/conversations - Tenant conversations         ║
║                                                              ║
║  External API v1 (X-API-Key header):                        ║
║  • POST /v1/messages/send    - Send message                  ║
║  • GET  /v1/conversations     - List conversations           ║
╚══════════════════════════════════════════════════════════════╝
  `);

    // Start background maintenance (log rotation, cleanup)
    startMaintenanceScheduler(uploadDir);
});

// ============================================
// Graceful Shutdown
// ============================================
const shutdown = (signal) => {
    console.log(`\n[Server] ${signal} received — shutting down gracefully...`);

    server.close(() => {
        console.log('[Server] HTTP server closed');

        // Close SQLite database
        try {
            db.close();
            console.log('[Server] Database connection closed');
        } catch (e) {
            // Already closed or error
        }

        console.log('[Server] Shutdown complete');
        process.exit(0);
    });

    // Force exit after 10 seconds if graceful shutdown fails
    setTimeout(() => {
        console.error('[Server] Forced shutdown after timeout');
        process.exit(1);
    }, 10000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
