import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
    MAX_FILE_SIZE,
    MAX_IMAGE_SIZE,
    ALLOWED_DOCUMENT_MIMES,
    ALLOWED_MEDIA_MIMES,
} from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================
// Centralized Upload Configuration
// ============================================

// Shared upload directory
export const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Shared disk storage with unique filenames
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    },
});

/**
 * General file upload — 16MB limit, no MIME filtering.
 * Used by admin message routes for any file type.
 */
export const generalUpload = multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE },
});

/**
 * Document upload — 16MB limit, restricted to document MIME types.
 * Used by tenant portal for document attachments.
 */
export const documentUpload = multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: (req, file, cb) => {
        if (ALLOWED_DOCUMENT_MIMES.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('نوع الملف غير مدعوم. يُسمح فقط بالمستندات (PDF, DOC, XLS, PPT, TXT)'));
        }
    },
});

/**
 * Media upload — 16MB limit, restricted to image/video/audio MIME types.
 * Used by tenant portal for media messages.
 */
export const mediaUpload = multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: (req, file, cb) => {
        if (ALLOWED_MEDIA_MIMES.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('نوع الملف غير مدعوم'));
        }
    },
});

/**
 * Simple dest-based upload — uses multer's temp directory.
 * Used by API v1 where the file will be streamed directly to Meta.
 */
export const simpleUpload = multer({
    dest: uploadDir,
    limits: { fileSize: MAX_FILE_SIZE },
});

/**
 * Clean up a temp file safely.
 */
export function cleanupFile(filePath) {
    try {
        if (filePath && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch (e) {
        console.error('[Upload] Failed to clean up temp file:', filePath, e.message);
    }
}
