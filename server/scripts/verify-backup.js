#!/usr/bin/env node
import { verifyBackupArchive } from '../services/databaseBackup.js';

const archivePath = process.argv[2];
if (!archivePath) {
    console.error('Usage: npm run verify:backup -- /path/to/platform_TIMESTAMP.db.gz');
    process.exit(2);
}

try {
    const result = await verifyBackupArchive(archivePath);
    console.log(`Restore drill passed: ${result.archivePath}`);
    console.log(`SHA-256: ${result.sha256}`);
    console.log(`Restored bytes: ${result.restoredBytes}; tables: ${result.tableCount}`);
} catch (error) {
    console.error(`Restore drill failed: ${error.message}`);
    process.exitCode = 1;
}
