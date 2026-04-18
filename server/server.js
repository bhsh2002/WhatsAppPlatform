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
const authLimiter = rateLimit({
    windowMs: AUTH_RATE_LIMIT.windowMs,
    max: AUTH_RATE_LIMIT.max,
    message: { error: AUTH_RATE_LIMIT.message },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip,
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
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Auth routes (public, with stricter rate limit on login/register)
app.use('/auth', authLimiter, authRouter);

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
