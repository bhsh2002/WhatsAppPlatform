#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createVerifiedBackup } from '../services/databaseBackup.js';

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const serverDirectory = path.resolve(scriptsDirectory, '..');
const databasePath = path.resolve(process.env.DATABASE_PATH || path.join(serverDirectory, 'db/platform.db'));
const backupDirectory = path.resolve(process.env.BACKUP_DIR || path.join(serverDirectory, 'db/backups'));

try {
    const result = await createVerifiedBackup({
        databasePath,
        backupDirectory,
        retention: process.env.BACKUP_RETENTION,
    });
    console.log(`Backup verified: ${result.archivePath}`);
    console.log(`SHA-256: ${result.sha256}`);
    console.log(`Restored bytes: ${result.restoredBytes}; tables: ${result.tableCount}; pruned: ${result.pruned}`);
} catch (error) {
    console.error(`Backup failed: ${error.message}`);
    process.exitCode = 1;
}
