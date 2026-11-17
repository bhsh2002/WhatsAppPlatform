import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import Database from 'better-sqlite3';
import { runMigrationsSync } from '../db/migrator.js';
import { readSavanaPricingImpact } from '../services/savanaPricingImpact.js';
import { SavanaIntegrationService } from '../services/savanaIntegration.js';
import { sharedPriceIsValid, sharedCurrencyIsValid } from '../services/sharedProductPricing.js';
import { createTenantIntegrationsRouter } from '../routes/savanaIntegrations.js';
import { applyThrough, migrationFiles, migrationText, seedSavanaUpgrade, sourceState } from '../test-support/savanaMigrationFixture.js';

const fixture = t => {
    const database = new Database(':memory:');
    t.after(() => database.close());
    seedSavanaUpgrade(database);
    return database;
};

test('tracked 054 to 057 upgrade preserves sources/identities and quarantines incomplete, malformed and stale copies', t => {
    const database = fixture(t);
    const sources = sourceState(database);
    const unchanged = database.prepare('SELECT * FROM bot_products WHERE id IN (1, 2, 6, 7, 8, 16) ORDER BY id').all();
    const request = database.prepare('SELECT * FROM savana_service_requests').get();
    const ids = database.prepare('SELECT id, tenant_id, sku, savana_projection_key FROM bot_products ORDER BY id').all();
    const before = readSavanaPricingImpact(database);
    assert.equal(before.counts.affected_by_057, 10);
    assert.equal(before.counts.potentially_newly_hidden, 10);
    assert.equal(before.counts.legacy_unqualified_identity, 3);
    const newMigrations = migrationFiles.filter(name => name > '054_meta_page_ownership.sql').length;
    assert.deepEqual(runMigrationsSync(database), { applied: newMigrations, skipped: migrationFiles.length - newMigrations });
    assert.deepEqual(sourceState(database), sources);
    assert.deepEqual(database.prepare('SELECT * FROM bot_products WHERE id IN (1, 2, 6, 7, 8, 16) ORDER BY id').all(), unchanged);
    assert.deepEqual(database.prepare('SELECT id, tenant_id, sku, savana_projection_key FROM bot_products ORDER BY id').all(), ids);
    for (const id of [3, 4, 5, 9, 10, 11, 12, 13, 14, 15]) {
        const product = database.prepare('SELECT * FROM bot_products WHERE id = ?').get(id);
        assert.equal(product.is_active, 0, `product ${id}`);
        assert.equal(product.availability, 'hidden');
        assert.equal(product.approval_status, 'draft');
    }
    assert.equal(database.prepare('SELECT price FROM bot_products WHERE id = 3').get().price, null);
    assert.equal(database.prepare('SELECT currency FROM bot_products WHERE id = 4').get().currency, null);
    assert.equal(database.prepare('SELECT price FROM bot_products WHERE id = 10').get().price, 12);
    assert.equal(database.prepare('SELECT price FROM bot_products WHERE id = 15').get().price, null);
    assert.deepEqual(database.prepare('SELECT * FROM savana_service_requests').get(), {
        ...request, reviewed_payload_hash: null, reviewed_by: null, reviewed_at: null,
    });
    assert.deepEqual(database.pragma('foreign_key_check'), []);
    assert.equal(database.pragma('quick_check', { simple: true }), 'ok');
    const after = readSavanaPricingImpact(database);
    assert.equal(after.counts.potentially_newly_hidden, 0);
    assert.equal(after.review_evidence_columns_present, true);
    assert.equal(after.migrations.every(migration => migration.applied && migration.checksum_matches), true);
    // Repeated transport/upgrade attempts cannot duplicate or unarchive rows.
    const products = database.prepare('SELECT * FROM bot_products ORDER BY id').all();
    assert.deepEqual(runMigrationsSync(database), { applied: 0, skipped: migrationFiles.length });
    assert.deepEqual(database.prepare('SELECT * FROM bot_products ORDER BY id').all(), products);
    assert.throws(() => database.prepare(`INSERT INTO bot_products (tenant_id, name, savana_projection_key)
        VALUES (1, 'Duplicate copy', 'canonical:valid')`).run(), /UNIQUE/);
    assert.deepEqual(database.prepare('SELECT id FROM bot_products WHERE id IN (7, 8) ORDER BY id').all(), [{ id: 7 }, { id: 8 }]);
});

for (const [index, target] of [
    '055_savana_request_review_evidence.sql',
    '056_savana_incomplete_product_pricing.sql',
    '057_savana_pricing_contract_guard.sql',
    '058_savana_delegated_read_sessions.sql',
    '059_savana_consumer_enrollment.sql',
    '060_savana_owner_portal.sql',
].entries()) {
    test(`${target} rolls back SQL when tracking fails and resumes via the tracked runner`, t => {
        const database = fixture(t);
        applyThrough(database, migrationFiles[migrationFiles.indexOf(target) - 1]);
        const sources = sourceState(database);
        const products = database.prepare('SELECT * FROM bot_products ORDER BY id').all();
        const columns = database.pragma('table_info(savana_service_requests)');
        database.exec(`CREATE TRIGGER fail_target BEFORE INSERT ON _migrations
            WHEN NEW.name = '${target}' BEGIN SELECT RAISE(ABORT, 'synthetic tracking failure'); END`);
        assert.throws(() => runMigrationsSync(database), /synthetic tracking failure/);
        assert.deepEqual(sourceState(database), sources);
        assert.deepEqual(database.prepare('SELECT * FROM bot_products ORDER BY id').all(), products);
        assert.deepEqual(database.pragma('table_info(savana_service_requests)'), columns);
        assert.equal(database.prepare('SELECT 1 FROM _migrations WHERE name = ?').get(target), undefined);
        database.exec('DROP TRIGGER fail_target');
        assert.equal(runMigrationsSync(database).applied,
            migrationFiles.filter(name => name > '054_meta_page_ownership.sql').length - index);
        assert.equal(database.prepare('SELECT is_active FROM bot_products WHERE id = 6').get().is_active, 0);
    });
}

test('applied migration checksums stay immutable and raw 055 replay is not a supported retry', t => {
    const database = fixture(t);
    runMigrationsSync(database);
    const before = sourceState(database);
    assert.throws(() => database.transaction(() => database.exec(migrationText('055_savana_request_review_evidence.sql')))(), /duplicate column/);
    database.prepare('UPDATE _migrations SET checksum = ? WHERE name = ?')
        .run('0'.repeat(64), '056_savana_incomplete_product_pricing.sql');
    assert.throws(() => runMigrationsSync(database), /Checksum mismatch.*056/);
    assert.deepEqual(sourceState(database), before);
});

test('runtime uses current decimal contract and explicit null/missing snapshot pricing cannot revive an old amount', t => {
    const database = fixture(t);
    runMigrationsSync(database);
    const service = new SavanaIntegrationService({ database, config: {}, fetchImpl: async () => { throw new Error('External calls forbidden'); } });
    for (const price of ['0x10', '1e2', '01.2', '12.', '1.2345', '', ' 12', '-1', '9'.repeat(310), true, null]) {
        assert.equal(sharedPriceIsValid(price), false, String(price));
    }
    for (const price of ['0', '12.500', 0, 12.5]) assert.equal(sharedPriceIsValid(price), true);
    for (const currency of ['usd', ' USD ', null]) assert.equal(sharedCurrencyIsValid(currency), false);
    service.upsertProduct(1, { canonical_product_id: 'valid', quantity_available: '9' }, '2026-11-17T10:00:00Z');
    assert.equal(database.prepare("SELECT price FROM savana_product_projection WHERE projection_key = 'canonical:valid'").get().price, '12.500');
    for (const missing of [{ online_price: null, currency: null }, { online_price: '', currency: 'USD' }, { currency: 'USD' }, { online_price: '12' }]) {
        service.applyProductSnapshot(1, { complete: true, products: [{ canonical_product_id: 'valid', name: 'Synthetic updated', is_active: true, ...missing }] });
        const product = database.prepare('SELECT * FROM bot_products WHERE id = 2').get();
        assert.equal(product.is_active, 0);
        assert.equal(product.availability, 'hidden');
        assert.equal(product.approval_status, 'draft');
    }
    service.reconcileIntegrationMembershipVisibility(1);
    assert.equal(database.prepare('SELECT is_active FROM bot_products WHERE id = 6').get().is_active, 0);
});

test('raw product picker endpoints expose readiness and never authorize archived or malformed copies', t => {
    const database = fixture(t);
    runMigrationsSync(database);
    const router = createTenantIntegrationsRouter({ database, service: {} });
    const get = route => {
        let data;
        router.stack.find(layer => layer.route?.path === route && layer.route.methods.get).route.stack[0].handle(
            { user: { tenant_id: 1 }, query: { limit: 100 } }, { json: body => { data = body.data; } },
        );
        return data;
    };
    const products = get('/products');
    assert.deepEqual(get('/pos/products'), products);
    assert.equal(products.find(product => product.canonical_product_id === 'valid').can_prepare_product_message, true);
    for (const canonical of ['archived', 'malformed', 'missing-currency', 'stale-copy', 'precision']) {
        const product = products.find(product => product.canonical_product_id === canonical);
        assert.equal(product.can_prepare_product_message, false, canonical);
        assert.ok(product.preparation_blockers.length);
    }
});

test('a stock delta and connection refresh cannot undo price quarantine without a new complete price fact', t => {
    const database = fixture(t);
    runMigrationsSync(database);
    const service = new SavanaIntegrationService({ database, config: {}, fetchImpl: async () => { throw new Error('External calls forbidden'); } });
    const quarantined = () => {
        const product = database.prepare('SELECT is_active, availability, approval_status FROM bot_products WHERE id = 10').get();
        assert.deepEqual(product, { is_active: 0, availability: 'hidden', approval_status: 'draft' });
    };
    service.reconcileIntegrationMembershipVisibility(1);
    quarantined();
    service.applyInventorySnapshot(1, { captured_at: '2026-11-17T11:00:00Z', items: [
        { canonical_product_id: 'stale-copy', quantity_available: '8' },
    ] });
    service.reconcileIntegrationMembershipVisibility(1);
    quarantined();
    service.applyProductSnapshot(1, {
        snapshot_id: 'new-price-fact', generated_at: '2026-11-17T12:00:00Z',
        page_number: 1, page_count: 1, complete: true,
        products: [{ canonical_product_id: 'stale-copy', name: 'New explicit source price',
            online_price: '12.000', currency: 'USD', is_active: true }],
    }, { integrationId: 1, source: 'catalog', eventType: 'catalog.product_snapshot.v1' });
    assert.deepEqual(database.prepare('SELECT is_active, approval_status FROM bot_products WHERE id = 10').get(), {
        is_active: 1, approval_status: 'approved',
    });
    assert.equal(database.prepare('SELECT is_active FROM bot_products WHERE id = 6').get().is_active, 0);
});

test('impact CLI requires an explicit existing file and performs only an aggregate read without changing it', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-impact-readonly-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const filename = path.join(directory, 'synthetic.db');
    const database = new Database(filename);
    seedSavanaUpgrade(database);
    const expected = readSavanaPricingImpact(database);
    database.close();
    const before = fs.readFileSync(filename);
    const script = new URL('../scripts/check-savana-migration-impact.js', import.meta.url);
    const run = args => spawnSync(process.execPath, [script.pathname, ...args], {
        encoding: 'utf8', env: { ...process.env, DATABASE_PATH: '/does-not-select-an-implicit-database' },
    });
    const result = run(['--database', filename]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), expected);
    assert.deepEqual(fs.readFileSync(filename), before);
    for (const secretOrValue of ['Synthetic local', 'same-legacy-barcode', 'source-audit-key', 'retain exactly']) {
        assert.equal(result.stdout.includes(secretOrValue), false);
    }
    assert.equal(run([]).status, 2);
    const missing = path.join(directory, 'not-created.db');
    assert.equal(run(['--database', missing]).status, 1);
    assert.equal(fs.existsSync(missing), false);
});
