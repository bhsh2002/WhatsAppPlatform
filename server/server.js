import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';

// Import routes
import tenantsRouter from './routes/tenants.js';
import statsRouter from './routes/stats.js';
import messagesRouter from './routes/messages.js';
import webhooksRouter from './routes/webhooks.js';
import authRouter from './routes/auth.js';

// Import middleware
import { authMiddleware } from './middleware/auth.js';

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
app.use(express.json());

// Request logging
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

// Health check (public)
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Auth routes (public)
app.use('/auth', authRouter);

// Protected API Routes
app.use('/tenants', authMiddleware, tenantsRouter);
app.use('/stats', authMiddleware, statsRouter);
app.use('/messages', authMiddleware, messagesRouter);

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
║══════════════════════════════════════════════════════════════║
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
║  Protected Endpoints (require Bearer token):                 ║
║  • GET  /tenants           - List tenants                    ║
║  • POST /tenants           - Create tenant                   ║
║  • GET  /stats/dashboard   - Dashboard stats                 ║
║  • POST /messages/send     - Send WhatsApp message           ║
╚══════════════════════════════════════════════════════════════╝
  `);
});

export default app;
