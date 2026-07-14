import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
    MAX_FILE_SIZE,
    MAX_IMAGE_SIZE,
} from './index.js';
import { normalizeFilename } from '../services/filenames.js';
import { validateUploadContent } from '../security/fileContent.js';

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

export const botAssetsDir = path.join(uploadDir, 'bot-assets');
if (!fs.existsSync(botAssetsDir)) {
    fs.mkdirSync(botAssetsDir, { recursive: true });
}

function createVerifiedStorage(destination, policy) {
    const diskStorage = multer.diskStorage({
        destination: (req, file, cb) => cb(null, destination),
        filename: (req, file, cb) => {
            file.originalname = normalizeFilename(file.originalname, 'upload');
            cb(null, `${crypto.randomUUID()}.upload`);
        },
    });

    return {
        _handleFile(req, file, cb) {
            diskStorage._handleFile(req, file, (error, info) => {
                if (error) return cb(error);

                fs.promises.readFile(info.path)
                    .then((buffer) => validateUploadContent(buffer, {
                        policy,
                        declaredMime: file.mimetype,
                    }))
                    .then(async ({ mime, extension, detectedMime }) => {
                        const baseName = info.filename.replace(/\.upload$/, '');
                        const filename = `${baseName}.${extension}`;
                        const verifiedPath = path.join(info.destination, filename);
                        await fs.promises.rename(info.path, verifiedPath);
                        cb(null, {
                            ...info,
                            filename,
                            path: verifiedPath,
                            mimetype: mime,
                            detectedMime,
                        });
                    })
                    .catch(async (validationError) => {
                        try {
                            await fs.promises.unlink(info.path);
                        } catch (cleanupError) {
                            if (cleanupError.code !== 'ENOENT') {
                                console.error('[Upload] Failed to remove rejected upload:', cleanupError.message);
                            }
                        }
                        cb(validationError);
                    });
            });
        },
        _removeFile(req, file, cb) {
            diskStorage._removeFile(req, file, cb);
        },
    };
}

const createUpload = ({ destination = uploadDir, policy, fileSize = MAX_FILE_SIZE }) => multer({
    storage: createVerifiedStorage(destination, policy),
    limits: { fileSize },
});

/**
 * Document upload — 16MB limit, restricted to document MIME types.
 * Used by tenant portal for document attachments.
 */
export const documentUpload = multer({
    storage: createVerifiedStorage(uploadDir, 'document'),
    limits: { fileSize: MAX_FILE_SIZE },
});

/**
 * Media upload — 16MB limit, restricted to image/video/audio MIME types.
 * Used by tenant portal for media messages.
 */
export const mediaUpload = createUpload({ policy: 'media' });

/**
 * Public bot image upload — image-only, stored under /uploads/bot-assets.
 * Used for Messenger product cards and quick reply option icons.
 */
export const botImageUpload = createUpload({
    destination: botAssetsDir,
    policy: 'image',
    fileSize: MAX_IMAGE_SIZE,
});

/**
 * Private photo upload, verified from its bytes before reaching a route.
 */
export const imageUpload = createUpload({ policy: 'image', fileSize: MAX_IMAGE_SIZE });

/**
 * Text CSV import. Binary spreadsheets and files merely labelled as CSV fail.
 */
export const csvUpload = createUpload({ policy: 'csv' });

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
