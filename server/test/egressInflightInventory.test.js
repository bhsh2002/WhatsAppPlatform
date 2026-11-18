import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import Database from 'better-sqlite3';
import { runMigrationsSync } from '../db/migrator.js';
import { getEgressInflightInventory } from '../services/egressInflightInventory.js';

const cli = new URL('../scripts/inspect-egress-inflight.js', import.meta.url);

test('inflight inventory verifies the full migrated schema without changing any bytes', t => {
    const database = new Database(':memory:');
    t.after(() => database.close());
    runMigrationsSync(database);
    const before = database.serialize();
    database.pragma('query_only = ON');
    const inventory = getEgressInflightInventory(database);
    assert.equal(inventory.schema_complete, true);
    assert.equal(inventory.unresolved_count, 0);
    assert.equal(Object.keys(inventory.categories).length, 19);
    assert.deepEqual(database.serialize(), before);
});

test('inflight inventory retains unknown categories and never reports an absent table as idle', t => {
    const database = new Database(':memory:');
    t.after(() => database.close());
    database.exec(`
        CREATE TABLE broadcast_jobs(status TEXT, private_payload TEXT);
        INSERT INTO broadcast_jobs VALUES ('pending','recipient-secret'), ('running','recipient-secret'), ('completed','recipient-secret');
        CREATE TABLE tenant_api_callback_outbox(status TEXT);
        INSERT INTO tenant_api_callback_outbox VALUES ('processing'), ('pending');
        CREATE TABLE savana_owner_portal_intents(state TEXT);
        INSERT INTO savana_owner_portal_intents VALUES ('prepared'), ('inflight'), ('unknown'), ('completed');
        CREATE TABLE sms_messages(status TEXT, direction TEXT);
        INSERT INTO sms_messages VALUES ('pending','outgoing'), ('pending','incoming'), ('delivered','outgoing');
        CREATE TABLE sms_api_requests(status TEXT);
        INSERT INTO sms_api_requests VALUES ('processing'), ('failed'), ('accepted');
        CREATE TABLE billing_usage_events(status TEXT);
        INSERT INTO billing_usage_events VALUES ('reserved'), ('released'), ('committed');
    `);
    const before = database.serialize();
    database.pragma('query_only = ON');
    const inventory = getEgressInflightInventory(database);
    assert.equal(inventory.unresolved_count, 10);
    assert.equal(inventory.schema_complete, false);
    assert.equal(inventory.categories.consumer_enrollment.unresolved_count, null);
    assert.equal(inventory.categories.consumer_enrollment.reason, 'table_missing');
    assert.equal(inventory.categories.collaborative_executions.unresolved_count, null);
    assert.equal(inventory.categories.collaborative_effects.reason, 'table_missing');
    assert.equal(inventory.categories.workspace_intents.unresolved_count, null);
    assert.equal(inventory.categories.broadcast_jobs.states.pending, 1);
    assert.equal(inventory.categories.tenant_callbacks.states.processing, 1);
    assert.equal(inventory.categories.owner_portal_intents.states.unknown, 1);
    assert.equal(inventory.categories.sms_api_requests.states.failed, 1);
    assert.equal(inventory.categories.billing_reservations.states.reserved, 1);
    assert.equal(JSON.stringify(inventory).includes('recipient-secret'), false);
    assert.deepEqual(database.serialize(), before);
});

test('collaborative claims and uncertain individual effects block resume without exposing content', t => {
    const database = new Database(':memory:');
    t.after(() => database.close());
    database.exec(`
        CREATE TABLE savana_collaborative_executions(state TEXT, selection_json TEXT);
        INSERT INTO savana_collaborative_executions VALUES
            ('approved','private-native-selection'), ('scheduled','private-native-selection'),
            ('executing','private-native-selection'), ('unknown','private-native-selection'),
            ('completed','private-native-selection');
        CREATE TABLE savana_collaborative_effects(state TEXT, receipt_json TEXT);
        INSERT INTO savana_collaborative_effects VALUES
            ('prepared','private-native-receipt'), ('dispatching','private-native-receipt'),
            ('unknown','private-native-receipt'), ('accepted','private-native-receipt');
    `);
    const before = database.serialize();
    database.pragma('query_only = ON');
    const inventory = getEgressInflightInventory(database);
    assert.equal(inventory.unresolved_count, 4);
    assert.equal(inventory.categories.collaborative_executions.states.executing, 1);
    assert.equal(inventory.categories.collaborative_executions.states.unknown, 1);
    assert.equal(inventory.categories.collaborative_effects.states.dispatching, 1);
    assert.equal(inventory.categories.collaborative_effects.states.unknown, 1);
    assert.equal(JSON.stringify(inventory).includes('private-native'), false);
    assert.deepEqual(database.serialize(), before);
});

test('inflight CLI requires an explicit existing absolute database and fails closed when idle is unverified', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-inflight-cli-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const databasePath = path.join(directory, 'fixture.db');
    const database = new Database(databasePath);
    runMigrationsSync(database);
    database.close();
    const invoke = args => spawnSync(process.execPath, [cli.pathname, ...args], {
        encoding: 'utf8', env: { ...process.env, DATABASE_PATH: '/must-not-select-an-implicit-database' },
    });
    assert.equal(invoke([]).status, 2);
    assert.equal(invoke(['--database', 'relative.db', '--require-idle']).status, 2);
    assert.equal(invoke(['--database', path.join(directory, 'absent.db'), '--require-idle']).status, 2);
    assert.equal(fs.existsSync(path.join(directory, 'absent.db')), false);
    const before = fs.readFileSync(databasePath);
    const idle = invoke(['--database', databasePath, '--require-idle']);
    assert.equal(idle.status, 0, idle.stderr);
    assert.equal(JSON.parse(idle.stdout).unresolved_count, 0);
    assert.deepEqual(fs.readFileSync(databasePath), before);
    const writer = new Database(databasePath);
    writer.exec("INSERT INTO broadcast_jobs(status) VALUES ('pending')");
    writer.close();
    const blocked = invoke(['--database', databasePath, '--require-idle']);
    assert.equal(blocked.status, 2);
    assert.equal(JSON.parse(blocked.stdout).categories.broadcast_jobs.states.pending, 1);
});
