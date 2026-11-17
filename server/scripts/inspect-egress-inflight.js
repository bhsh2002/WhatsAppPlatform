#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { getEgressInflightInventory } from '../services/egressInflightInventory.js';

const args = process.argv.slice(2);
let databasePath;
let requireIdle = false;
let invalid = false;
for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--database' && databasePath === undefined) {
        databasePath = args[index + 1];
        index += 1;
    } else if (args[index] === '--require-idle' && !requireIdle) {
        requireIdle = true;
    } else invalid = true;
}
if (invalid || !databasePath || !path.isAbsolute(databasePath)) {
    console.error('Usage: node scripts/inspect-egress-inflight.js --database /absolute/existing/database.db [--require-idle]');
    process.exitCode = 2;
} else {
    let database;
    try {
        if (!fs.statSync(databasePath).isFile()) throw new Error('not_a_file');
        database = new Database(databasePath, { readonly: true, fileMustExist: true });
        database.pragma('query_only = ON');
        const inventory = getEgressInflightInventory(database);
        console.log(JSON.stringify(inventory, null, 2));
        if (requireIdle && (!inventory.schema_complete || inventory.unresolved_count !== 0)) {
            process.exitCode = 2;
        }
    } catch {
        console.error('Inflight inventory unavailable; no idle conclusion can be made.');
        process.exitCode = 2;
    } finally {
        database?.close();
    }
}
