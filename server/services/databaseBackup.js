import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGunzip, createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';

import Database from 'better-sqlite3';

const ARCHIVE_PATTERN = /^[a-zA-Z0-9_-]+_\d{8}_\d{6}_\d{3}_[a-f0-9]{8}\.db\.gz$/;

function safeStem(databasePath) {
    return path.basename(databasePath, path.extname(databasePath))
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'platform';
}

function timestamp(now = new Date()) {
    return now.toISOString()
        .replace(/[-:]/g, '')
        .replace('T', '_')
        .replace('Z', '')
        .replace('.', '_');
}

function normalizeRetention(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed)) return 10;
    return Math.max(1, Math.min(100, parsed));
}

async function checksumFile(filePath) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
    return hash.digest('hex');
}

export function validateSQLiteDatabase(databasePath) {
    const db = new Database(databasePath, { readonly: true, fileMustExist: true });
    try {
        const quickCheck = db.pragma('quick_check', { simple: true });
        if (quickCheck !== 'ok') {
            throw new Error(`SQLite quick_check failed: ${quickCheck || 'unknown result'}`);
        }

        const foreignKeyViolations = db.pragma('foreign_key_check');
        if (foreignKeyViolations.length > 0) {
            throw new Error(`SQLite foreign_key_check found ${foreignKeyViolations.length} violation(s)`);
        }

        const tableCount = db.prepare(`
            SELECT COUNT(*) AS count
            FROM sqlite_master
            WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        `).get().count;

        return { quickCheck, foreignKeyViolations: 0, tableCount };
    } finally {
        db.close();
    }
}

export async function verifyBackupArchive(archivePath, { temporaryRoot = os.tmpdir() } = {}) {
    const resolvedArchive = path.resolve(archivePath);
    const archiveStat = await fs.promises.stat(resolvedArchive);
    if (!archiveStat.isFile() || archiveStat.size === 0) {
        throw new Error('Backup archive is empty or is not a regular file');
    }

    const temporaryDirectory = await fs.promises.mkdtemp(path.join(temporaryRoot, 'whatsapp-backup-verify-'));
    const restoredPath = path.join(temporaryDirectory, 'restored.db');

    try {
        await pipeline(
            fs.createReadStream(resolvedArchive),
            createGunzip(),
            fs.createWriteStream(restoredPath, { mode: 0o600 })
        );
        const validation = validateSQLiteDatabase(restoredPath);
        const restoredStat = await fs.promises.stat(restoredPath);
        return {
            ...validation,
            archivePath: resolvedArchive,
            archiveBytes: archiveStat.size,
            restoredBytes: restoredStat.size,
            sha256: await checksumFile(resolvedArchive),
        };
    } finally {
        await fs.promises.rm(temporaryDirectory, { recursive: true, force: true });
    }
}

async function pruneBackups(backupDirectory, retention) {
    const entries = await fs.promises.readdir(backupDirectory, { withFileTypes: true });
    const archives = await Promise.all(entries
        .filter((entry) => entry.isFile() && ARCHIVE_PATTERN.test(entry.name))
        .map(async (entry) => {
            const archivePath = path.join(backupDirectory, entry.name);
            const stat = await fs.promises.stat(archivePath);
            return { path: archivePath, modifiedAt: stat.mtimeMs };
        }));

    archives.sort((left, right) => right.modifiedAt - left.modifiedAt || right.path.localeCompare(left.path));
    const expired = archives.slice(retention);
    await Promise.all(expired.map((archive) => fs.promises.unlink(archive.path)));
    return expired.length;
}

export async function createVerifiedBackup({
    databasePath,
    backupDirectory,
    retention = 10,
    now = new Date(),
} = {}) {
    if (!databasePath || !backupDirectory) {
        throw new TypeError('databasePath and backupDirectory are required');
    }

    const resolvedDatabase = path.resolve(databasePath);
    const resolvedBackupDirectory = path.resolve(backupDirectory);
    const databaseStat = await fs.promises.stat(resolvedDatabase);
    if (!databaseStat.isFile()) throw new Error(`Database is not a regular file: ${resolvedDatabase}`);

    await fs.promises.mkdir(resolvedBackupDirectory, { recursive: true, mode: 0o700 });

    const basename = `${safeStem(resolvedDatabase)}_${timestamp(now)}_${crypto.randomBytes(4).toString('hex')}.db`;
    const temporaryDatabase = path.join(resolvedBackupDirectory, `${basename}.partial`);
    const temporaryArchive = path.join(resolvedBackupDirectory, `${basename}.gz.partial`);
    const archivePath = path.join(resolvedBackupDirectory, `${basename}.gz`);

    let source;
    try {
        source = new Database(resolvedDatabase, { readonly: true, fileMustExist: true });
        await source.backup(temporaryDatabase);
        source.close();
        source = null;

        validateSQLiteDatabase(temporaryDatabase);
        await pipeline(
            fs.createReadStream(temporaryDatabase),
            createGzip({ level: 9 }),
            fs.createWriteStream(temporaryArchive, { mode: 0o600, flags: 'wx' })
        );
        await fs.promises.rename(temporaryArchive, archivePath);

        const verification = await verifyBackupArchive(archivePath);
        const pruned = await pruneBackups(resolvedBackupDirectory, normalizeRetention(retention));
        return { ...verification, archivePath, pruned };
    } catch (error) {
        await fs.promises.rm(archivePath, { force: true });
        throw error;
    } finally {
        if (source?.open) source.close();
        await Promise.all([
            fs.promises.rm(temporaryDatabase, { force: true }),
            fs.promises.rm(`${temporaryDatabase}-wal`, { force: true }),
            fs.promises.rm(`${temporaryDatabase}-shm`, { force: true }),
            fs.promises.rm(temporaryArchive, { force: true }),
        ]);
    }
}
