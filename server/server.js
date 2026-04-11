import 'dotenv/config';
import express from 'express';
import cors from 'cors';
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

// Import middleware
import { authMiddleware, adminMiddleware } from './middleware/auth.js';
import { apiKeyAuth } from './middleware/apiKeyAuth.js';

// Import database for seeding
import db from './db/database.js';

const app = express();
const PORT = process.env.PORT || 3031;

// Seed admin user if none exists
const seedAdmin = async () => {
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
    if (userCount.count === 0) {
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash('admin123', salt);

        db.prepare(`
      INSERT INTO users (username, email, password_hash, name, role)
      VALUES (?, ?, ?, ?, ?)
    `).run('admin', 'admin@example.com', password_hash, 'مدير النظام', 'admin');

        console.log('[Auth] Created default admin user: admin / admin123');
    }
};

seedAdmin().catch(console.error);

// Middleware
app.use(cors({
    origin: ['http://localhost:5173', 'http://localhost:5174', 'http://127.0.0.1:5173', 'http://localhost', 'http://127.0.0.1', 'https://wa.savana.ly', 'http://wa.savana.ly'],
    credentials: true
}));
app.use(express.json({
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
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 attempts per window
    message: { error: 'محاولات كثيرة. حاول مرة أخرى بعد 15 دقيقة.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const apiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100, // 100 requests per minute
    message: { error: 'طلبات كثيرة. حاول مرة أخرى.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Apply general rate limit to all routes
app.use(apiLimiter);

// Health check (public)
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Auth routes (public, with stricter rate limit on login/register)
app.use('/auth', authLimiter, authRouter);

// Protected API Routes - Admin (require both auth + admin role)
app.use('/tenants', authMiddleware, adminMiddleware, tenantsRouter);
app.use('/stats', authMiddleware, adminMiddleware, statsRouter);
app.use('/messages', authMiddleware, adminMiddleware, messagesRouter);
app.use('/business-profile', authMiddleware, businessProfileRouter);
app.use('/phone-numbers', authMiddleware, adminMiddleware, phoneNumbersRouter);
app.use('/qr-codes', authMiddleware, qrCodesRouter);
app.use('/analytics', authMiddleware, analyticsRouter);
app.use('/business-manager', authMiddleware, adminMiddleware, businessManagerRouter);
app.use('/pages', authMiddleware, adminMiddleware, pagesRouter);
app.use('/partner', authMiddleware, adminMiddleware, partnerSolutionsRouter);
app.use('/conversions', authMiddleware, conversionsRouter);

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

// Error handler
app.use((err, req, res, next) => {
    console.error('[Error]', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║      WhatsApp Management Platform Server                     ║
╠══════════════════════════════════════════════════════════════╣
║  🚀 Server running on http://localhost:${PORT}                  ║
║  📡 Webhook URL: http://localhost:${PORT}/webhook               ║
║  🔐 Auth enabled - Default: admin / admin123                 ║
║                                                              ║
║  Public Endpoints:                                           ║
║  • GET  /health              - Health check                  ║
║  • POST /auth/login          - Login                         ║
║  • POST /auth/register       - Register                      ║
║  • GET  /auth/me             - Current user                  ║
║  • GET  /webhook             - Meta verification             ║
║  • POST /webhook             - Meta events                   ║
║                                                              ║
║  Admin Endpoints (require Bearer token):                     ║
║  • GET  /tenants             - List tenants                  ║
║  • POST /tenants             - Create tenant                 ║
║  • POST /tenants/:id/create-account - Create tenant login    ║
║  • GET  /stats/dashboard     - Dashboard stats               ║
║  • POST /messages/send       - Send WhatsApp message         ║
║                                                              ║
║  Tenant Portal (require tenant token):                       ║
║  • GET  /portal/dashboard    - Tenant dashboard              ║
║  • GET  /portal/conversations - Tenant conversations         ║
║  • GET  /portal/templates    - Tenant templates              ║
║  • GET  /portal/settings/api - API settings                  ║
║                                                              ║
║  External API v1 (require X-API-Key header):                 ║
║  • POST /api/v1/messages/send    - Send message              ║
║  • POST /api/v1/messages/send-media - Send media via URL     ║
║  • POST /api/v1/messages/send-document - Upload & send file  ║
║  • GET  /api/v1/conversations     - List conversations       ║
║  • GET  /api/v1/conversations/:phone/messages - Get messages║
║  • GET  /api/v1/templates         - List templates           ║
║  • GET  /api/v1/health            - API health check          ║
╚══════════════════════════════════════════════════════════════╝
  `);
});

export default app;

