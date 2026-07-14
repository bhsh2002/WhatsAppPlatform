// ============================================
// Standardized Error Handling Middleware
// ============================================
import { writeLog } from '../services/observability.js';

/**
 * Standard error response format:
 * {
 *   error: "Human-readable error message",
 *   code: "MACHINE_READABLE_CODE",
 *   status: 400
 * }
 */

/**
 * Custom application error with code and status.
 */
export class AppError extends Error {
    constructor(message, code = 'INTERNAL_ERROR', status = 500) {
        super(message);
        this.code = code;
        this.status = status;
    }
}

/**
 * Common error factory functions.
 */
export const Errors = {
    notFound: (resource = 'Resource') =>
        new AppError(`${resource} غير موجود`, 'NOT_FOUND', 404),
    unauthorized: (msg = 'غير مصرح') =>
        new AppError(msg, 'UNAUTHORIZED', 401),
    forbidden: (msg = 'صلاحيات غير كافية') =>
        new AppError(msg, 'FORBIDDEN', 403),
    badRequest: (msg = 'طلب غير صالح') =>
        new AppError(msg, 'BAD_REQUEST', 400),
    conflict: (msg = 'تعارض في البيانات') =>
        new AppError(msg, 'CONFLICT', 409),
    suspended: () =>
        new AppError('هذا العميل معلّق ولا يمكنه إرسال الرسائل', 'TENANT_SUSPENDED', 403),
    missingCredentials: () =>
        new AppError('Missing API credentials', 'MISSING_CREDENTIALS', 400),
};

/**
 * Global error handler middleware.
 * Must be registered AFTER all routes with app.use(errorHandler).
 */
export function errorHandler(err, req, res, next) {
    // Multer file size errors
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
            error: 'حجم الملف كبير جداً',
            code: 'FILE_TOO_LARGE',
            status: 413,
        });
    }

    // Multer file type errors
    if (err.code === 'INVALID_FILE_TYPE' || (err.message && err.message.includes('نوع الملف غير مدعوم'))) {
        return res.status(400).json({
            error: err.message,
            code: 'INVALID_FILE_TYPE',
            status: 400,
        });
    }

    // Known application errors
    if (err instanceof AppError) {
        return res.status(err.status).json({
            error: err.message,
            code: err.code,
            status: err.status,
        });
    }

    // SQLite constraint violations
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).json({
            error: 'البيانات موجودة مسبقاً',
            code: 'DUPLICATE_ENTRY',
            status: 409,
        });
    }

    // Unexpected errors
    writeLog('error', 'unhandled_error', {
        request_id: req.requestId || null,
        method: req.method,
        path: req.path,
        error: err,
    });
    res.status(500).json({
        error: 'حدث خطأ داخلي',
        code: 'INTERNAL_ERROR',
        status: 500,
    });
}
