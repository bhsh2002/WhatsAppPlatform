import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
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
import settingsRouter from './routes/settings.js';
import billingRouter from './routes/billing.js';
import messengerBotRouter from './routes/messengerBot.js';
import facebookContentStudioRouter from './routes/facebookContentStudio.js';
import dataDeletionRouter from './routes/dataDeletion.js';
import metricsRouter from './routes/metrics.js';

// Import services
import eventBus from './services/eventBus.js';

// Import middleware
import { authMiddleware, adminMiddleware } from './middleware/auth.js';
import { tenantMiddleware } from './middleware/tenant.js';
import { apiKeyAuth } from './middleware/apiKeyAuth.js';

// Import database and services
import db from './db/database.js';
import { getMigrationStatusSync } from './db/migrator.js';
import { startMaintenanceScheduler } from './services/maintenance.js';
import { botAssetsDir, uploadDir } from './config/upload.js';
import { AUTH_RATE_LIMIT, GLOBAL_RATE_LIMIT } from './config/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { initEncryption } from './services/encryption.js';
import { installGlobalFetchTimeout } from './runtime/fetchTimeout.js';
import { requestObservability } from './services/observability.js';
import { createOriginGuard } from './middleware/originGuard.js';
import { createMetricsAuth } from './middleware/metricsAuth.js';
import { ensureBootstrapAdmin } from './services/bootstrapAdmin.js';
import { startFacebookContentScheduler } from './services/facebookContentScheduler.js';

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

if (!/^[0-9a-fA-F]{64}$/.test(process.env.CRYPTO_KEY)) {
    console.error('❌ FATAL: CRYPTO_KEY must be exactly 64 hexadecimal characters (32 bytes).');
    console.error('   Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    process.exit(1);
}

if (process.env.NODE_ENV === 'production') {
    const requiredProductionMetaSecrets = ['META_APP_SECRET', 'WEBHOOK_VERIFY_TOKEN'];
    const missingMetaSecrets = requiredProductionMetaSecrets.filter(name => !process.env[name]);
    if (missingMetaSecrets.length > 0) {
        console.error(`❌ FATAL: Missing production Meta secret(s): ${missingMetaSecrets.join(', ')}`);
        console.error('   These are required for signed webhooks and Meta App verification in production.');
        process.exit(1);
    }
}

if (process.env.METRICS_TOKEN && process.env.METRICS_TOKEN.trim().length < 32) {
    console.error('❌ FATAL: METRICS_TOKEN must be at least 32 characters when metrics scraping is enabled.');
    process.exit(1);
}

// Initialize encryption service
try {
    initEncryption();
} catch (err) {
    console.error('❌ FATAL: Failed to initialize encryption:', err.message);
    process.exit(1);
}

// Every external fetch gets a bounded timeout unless the caller supplied a stricter signal.
installGlobalFetchTimeout();

const app = express();
// Requests normally arrive from Nginx over a private Docker network. Trust
// only local/private proxy hops so req.ip and rate limiting use the first
// untrusted client address without accepting spoofed public proxy headers.
app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);
const PORT = process.env.PORT || 3031;

// Bootstrap is explicit and completes before the listener starts. Credentials
// are never generated into or printed through application logs.
try {
    const bootstrap = await ensureBootstrapAdmin(db, {
        password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
        username: process.env.BOOTSTRAP_ADMIN_USERNAME,
        email: process.env.BOOTSTRAP_ADMIN_EMAIL,
        name: process.env.BOOTSTRAP_ADMIN_NAME,
    });
    if (bootstrap.created) {
        console.log(`Bootstrap administrator created: ${bootstrap.username}. Rotate the password after first login.`);
    }
} catch (error) {
    console.error(`❌ FATAL: ${error.message}`);
    process.exit(1);
}

// Middleware
const CORS_ORIGINS = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
    : ['http://localhost:5173', 'http://localhost:5174', 'http://127.0.0.1:5173'];

app.use(cors({
    origin: CORS_ORIGINS,
    credentials: true
}));

// Security headers
const fbScriptSrc = process.env.META_APP_ID ? ['https://connect.facebook.net'] : [];
const fbFrameSrc = process.env.META_APP_ID ? ['https://www.facebook.com', 'https://web.facebook.com'] : [];
const fbConnectSrc = process.env.META_APP_ID ? ['https://graph.facebook.com', 'https://connect.facebook.net'] : [];

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'", ...fbScriptSrc],
            imgSrc: ["'self'", 'data:', 'https:'],
            connectSrc: ["'self'", ...fbConnectSrc],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: fbFrameSrc.length > 0 ? fbFrameSrc : ["'none'"],
        },
    },
    crossOriginEmbedderPolicy: false, // Needed for SSE
}));

// Request body size limit
app.use(express.json({
    limit: '1mb',
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));

// Same-origin browser session requests are cookie-authenticated. Reject
// cross-origin mutations while retaining Origin-less API clients/webhooks.
app.use(createOriginGuard({ allowedOrigins: CORS_ORIGINS }));

// Structured request logs, correlation IDs and low-cardinality HTTP metrics.
app.use(requestObservability);

// Rate limiters
const authLimiter = rateLimit({
    windowMs: AUTH_RATE_LIMIT.windowMs,
    max: AUTH_RATE_LIMIT.max,
    message: { error: AUTH_RATE_LIMIT.message },
    standardHeaders: true,
    legacyHeaders: false,
});

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
    try {
        db.prepare('SELECT 1').get();
        const migrations = getMigrationStatusSync(db);
        const ready = migrations.pending === 0;
        return res.status(ready ? 200 : 503).json({
            status: ready ? 'ok' : 'not_ready',
            database: 'ok',
            migrations,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        console.error('[Health] Readiness check failed:', error.message);
        return res.status(503).json({
            status: 'not_ready',
            database: 'unavailable',
            timestamp: new Date().toISOString(),
        });
    }
});

// Prometheus scraping is disabled unless a dedicated high-entropy bearer token
// is configured. Browser/admin cookies are intentionally not accepted here.
app.use('/metrics', createMetricsAuth(), metricsRouter);

app.use('/bot-assets', express.static(botAssetsDir, {
    immutable: true,
    maxAge: '30d',
    index: false,
}));

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

// Meta compliance: public data-deletion callback and evidence-backed status page.
app.use(dataDeletionRouter);

// Auth routes (stricter rate limit only on credential-entry endpoints)
app.use('/auth/login', authLimiter);
app.use('/auth/register', authLimiter);
app.use('/auth/register-tenant', authLimiter);
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
app.use('/settings', authMiddleware, adminMiddleware, settingsRouter);
app.use('/billing', authMiddleware, adminMiddleware, billingRouter);
app.use('/messenger-bot', authMiddleware, adminMiddleware, messengerBotRouter);
app.use('/content-studio', authMiddleware, adminMiddleware, facebookContentStudioRouter);

// Protected API Routes - Tenant Portal
app.use('/portal/messenger-bot', authMiddleware, tenantMiddleware, messengerBotRouter);
app.use('/portal/content-studio', authMiddleware, tenantMiddleware, facebookContentStudioRouter);
app.use('/portal/fb-content', authMiddleware, tenantMiddleware, fbContentRouter);
app.use('/portal/fb-insights', authMiddleware, tenantMiddleware, fbInsightsRouter);
app.use('/portal', authMiddleware, tenantMiddleware, tenantPortalRouter);

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

    // Isolated smoke/E2E environments can disable process-local schedulers so
    // they never inspect shared uploads or call Meta while testing a temp DB.
    if (!['1', 'true'].includes(String(process.env.DISABLE_BACKGROUND_JOBS || '').toLowerCase())) {
        startMaintenanceScheduler(uploadDir);
        startFacebookContentScheduler();
    }
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
