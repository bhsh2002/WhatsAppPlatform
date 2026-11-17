#!/usr/bin/env node
import path from 'node:path';
import Database from 'better-sqlite3';
import { readSavanaPricingImpact } from '../services/savanaPricingImpact.js';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--database' || !path.isAbsolute(args[1])) {
    console.error('Usage: node scripts/check-savana-migration-impact.js --database /absolute/path/to/approved.db');
    process.exitCode = 2;
} else {
    let database;
    try {
        // Deliberately no environment default, dotenv, application bootstrap,
        // migration runner, credential loader or network client.
        database = new Database(args[1], { readonly: true, fileMustExist: true });
        database.pragma('query_only = ON');
        console.log(JSON.stringify(readSavanaPricingImpact(database), null, 2));
    } catch {
        console.error('Read-only impact scan failed; verify the explicitly selected file and WA schema.');
        process.exitCode = 1;
    } finally {
        database?.close();
    }
}
