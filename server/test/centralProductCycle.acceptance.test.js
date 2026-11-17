// Opt-in real Catalog -> central -> WA HTTP acceptance. The Python controller
// starts only owner-published synthetic factories; no transport/source mocks
// qualify as evidence for this suite. Secrets stay in child pipes and memory.
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { startOwnedProductFixture } from '../test-support/centralProductCycleProcess.js';
import { countEffects, startAuthenticatedWaReadServer } from '../test-support/centralProductCycleWaServer.js';

const serverRoot = fileURLToPath(new URL('../', import.meta.url));
const repositoryRoot = path.dirname(serverRoot);
const centralRoot = path.resolve(repositoryRoot, '../../savana-control-plane');
const catalogRoot = path.resolve(repositoryRoot, '../../_catalog');
const handoffRoot = path.resolve(repositoryRoot, '../../../.organization/2026-11-17/integration-plan/project-handoffs');
const optedIn = process.env.WA_RUN_PRODUCT_CYCLE_ACCEPTANCE === '1';

const requireReadyHandoff = () => {
    const status = JSON.parse(fs.readFileSync(path.join(handoffRoot, 'shared-contracts-status.json'), 'utf8'));
    assert.equal(status.read_http_ready_for_isolated_consumers, true, 'Central read HTTP must be explicitly ready for isolated consumers');
    assert.equal(status.product_ingest_contract?.ready_for_isolated_consumer_testing, true,
        'Actual central product intake HTTP must be explicitly ready for isolated consumers');
    for (const contract of [status.http_contracts.find(item => item.id === 'integration-read-http-v1'), status.product_ingest_contract]) {
        assert.equal(createHash('sha256').update(fs.readFileSync(contract.path)).digest('hex'), contract.sha256,
            'The consumed actual contract must match the central-published fingerprint');
    }
    const source = JSON.parse(fs.readFileSync(path.join(handoffRoot, 'Catalog/product-source-handoff/status.json'), 'utf8'));
    assert.equal(source.ready_for_isolated_consumer_testing, true,
        'Actual Catalog source has an unresolved implementation/readiness dependency');
    assert.ok(fs.existsSync(path.join(handoffRoot, 'savana-control-plane/product-cycle-handoff')), 'Central product-cycle contract/factory is not published yet');
    return { center_revision: status.revision, source_declared_ready: source.ready_for_isolated_consumer_testing,
        source_declared_status: source.status,
        read_contract_sha256: status.http_contracts.find(item => item.id === 'integration-read-http-v1').sha256,
        ingest_contract_sha256: status.product_ingest_contract.sha256 };
};

const assertSafeEnvelope = response => {
    assert.equal(response.body.enabled, true);
    assert.equal(response.body.read_only, true);
    assert.equal(response.body.execution_ready, false);
    assert.equal(response.body.pricing_use_allowed, false);
    assert.equal(response.headers['cache-control']?.includes('no-store'), true);
};

test('real native Catalog product cycle preserves authorized identity/version/lifecycle through central HTTP and WA', {
    skip: !optedIn && 'Explicit WA_RUN_PRODUCT_CYCLE_ACCEPTANCE=1 required for owned cross-project HTTP fixtures',
    timeout: 180000,
}, async t => {
    let handoffEvidence;
    let cycle;
    let wa;
    let evidence;
    let stage = 'handoff_readiness';
    let failure;
    const scenarios = [];
    const evidencePath = path.join(handoffRoot, 'WA-Savana/product-cycle-acceptance-results.json');
    t.after(async () => {
        let cleanupError;
        try { if (wa) await wa.close(); } catch (error) { cleanupError = error; }
        try { if (cycle) await cycle.stop(); } catch (error) { cleanupError ||= error; }
        const cleanup = {
            wa_server_stopped: wa?.cleanup.wa_server_stopped === true,
            wa_temp_database_removed: wa?.cleanup.wa_temp_database_removed === true,
            catalog_factory_cleaned: cycle?.cleanup.catalog_factory_cleaned === true,
            central_factory_cleaned: cycle?.cleanup.central_factory_cleaned === true,
            factory_contexts_closed_before_final_stop: cycle?.cleanup.factory_contexts_closed_before_final_stop === true,
            child_exit_code: cycle?.cleanup.child_exit_code ?? null,
        };
        if (!cleanupError && evidence && (!cleanup.wa_server_stopped || !cleanup.wa_temp_database_removed
            || !cleanup.catalog_factory_cleaned || !cleanup.central_factory_cleaned || cleanup.child_exit_code !== 0)) {
            cleanupError = new Error('Owned fixture cleanup was not fully confirmed');
        }
        const result = evidence || {
            project: 'WA-Savana', date: '2026-11-17', timezone: 'Africa/Tripoli',
            status: 'failed_actual_http_acceptance', handoff: handoffEvidence || null,
            scenarios, failure: failure || { layer: stage, code: 'acceptance_incomplete' },
            data_kind: 'synthetic_only_no_business_data', deployment_or_runtime_activation: false,
        };
        if (cleanupError) {
            result.status = 'failed_fixture_cleanup';
            result.failure = { layer: 'owned_fixture_cleanup', code: cleanupError.code || cleanupError.name };
        }
        result.cleanup = { ...cleanup, evidence_written_after_cleanup_attempts: true,
            cleanup_fully_confirmed: !cleanupError && cleanup.wa_server_stopped && cleanup.wa_temp_database_removed
                && cleanup.catalog_factory_cleaned && cleanup.central_factory_cleaned && cleanup.child_exit_code === 0 };
        fs.writeFileSync(evidencePath, JSON.stringify(result, null, 2) + '\n');
        if (cleanupError) throw cleanupError;
    });
    handoffEvidence = requireReadyHandoff();
    const runCase = (name, verify) => t.test(name, async () => {
        stage = name;
        try { await verify(); scenarios.push({ name, status: 'passed' }); }
        catch (error) {
            failure ||= { layer: name, code: error.code || error.name };
            scenarios.push({ name, status: 'failed' }); throw error;
        }
    });
    const controller = fileURLToPath(new URL('../test-support/centralProductCycleFixture.py', import.meta.url));
    const catalogEvidence = JSON.parse(fs.readFileSync(path.join(handoffRoot, 'Catalog/runtime-acceptance-results.json'), 'utf8'));
    const catalogPython = catalogEvidence.verification.runtime_environments.catalog;
    stage = 'official_central_and_catalog_factory_startup';
    cycle = await startOwnedProductFixture({
        python: path.join(centralRoot, '.venv/bin/python'), controller,
        pythonPaths: [centralRoot, path.join(centralRoot, 'services/connect/src'), path.join(centralRoot, 'services/connect/tests')],
        input: { catalog_root: catalogRoot, catalog_python: catalogPython },
    });
    const ready = cycle.metadata;
    assert.equal(ready.source_kind, 'native_catalog_http_and_real_outbox');
    stage = 'real_wa_auth_read_http_server_startup';
    wa = await startAuthenticatedWaReadServer({
        baseUrl: ready.center.base_url, platformToken: ready.consumer.platform_token,
        binding: {
            accessToken: ready.consumer.access_token, expiresAt: ready.consumer.expires_at,
            scope: ready.consumer.scope, consumerInstallationId: ready.consumer.installation_id,
            consumerAccountId: ready.consumer.account_id, centralActorId: ready.consumer.actor_id,
        },
    });

    await runCase('actual local auth and an explicitly bound central OIDC session are both required', async () => {
        const anonymous = await wa.read('/shared-products', { auth: {} });
        assert.equal(anonymous.status, 401);
        const unrelated = await wa.read('/shared-products', { auth: wa.unrelatedHeaders });
        assert.equal(unrelated.status, 403);
        assert.equal(unrelated.body.clear_previous, true);
    });

    let entityId;
    let sourceIdentity;
    let firstVersion;
    let after;
    await runCase('native Catalog create and publisher yield exactly one central product with allowed fields', async () => {
        const created = await cycle.command({ command: 'create_and_publish' });
        assert.equal(created.event, 'published');
        entityId = created.entity_id;
        sourceIdentity = created.source;
        firstVersion = created.version;
        assert.equal(created.external_effects, 0);
        const read = await wa.read(`/shared-products/${encodeURIComponent(entityId)}`);
        assert.equal(read.status, 200);
        assertSafeEnvelope(read);
        assert.equal(read.body.record.entity_id, entityId);
        assert.equal(read.body.record.version, firstVersion);
        assert.deepEqual(read.body.record.source, sourceIdentity);
        assert.deepEqual(read.body.record.data, created.allowed_data);
        assert.equal('price' in read.body.record.data, false);
        assert.equal('base_unit' in read.body.record.data, false);
        assert.equal('description' in read.body.record.data, false);
        assert.equal('private_note' in read.body.record.data, false);
        assert.equal(JSON.stringify(read.body).includes(ready.consumer.access_token), false);
        assert.equal(JSON.stringify(read.body).includes(ready.consumer.platform_token), false);
        assert.equal(JSON.stringify(read.body).includes('must-never-be-published'), false);
        const hiddenSearch = await wa.read('/shared-products?q=must-never-be-published&limit=10');
        assert.equal(hiddenSearch.status, 200);
        assert.deepEqual(hiddenSearch.body.records, []);
        const deniedFieldSearch = await wa.read('/shared-products?q=Synthetic%20public%20source%20description&limit=10');
        assert.equal(deniedFieldSearch.status, 200);
        assert.deepEqual(deniedFieldSearch.body.records, []);
        const allowedSearch = await wa.read('/shared-products?q=Synthetic%20WA%20source%20product&limit=10');
        assert.equal(allowedSearch.status, 200);
        assert.equal(allowedSearch.body.records[0]?.entity_id, entityId);
        const changes = await wa.read('/shared-product-changes?after=0&limit=100');
        assert.equal(changes.status, 200);
        assertSafeEnvelope(changes);
        assert.ok(changes.body.changes.some(change => change.record?.entity_id === entityId || change.entity_id === entityId));
        after = changes.body.cursor;
    });

    await runCase('browser selectors/forged platform headers cannot replace server-owned scope or credentials', async () => {
        const spoofed = await wa.read(`/shared-products/${encodeURIComponent(entityId)}?organization_id=untrusted`);
        assert.equal(spoofed.status, 422);
        assert.equal(spoofed.body.clear_previous, true);
        const forged = await wa.read(`/shared-products/${encodeURIComponent(entityId)}`, {
            extraHeaders: { 'X-Savana-Platform-Code': 'catalog', 'X-Savana-Platform-Token': 'browser-is-not-a-service-principal' },
        });
        assert.equal(forged.status, 200);
        assert.equal(forged.body.record.entity_id, entityId);
        const missing = await wa.read('/shared-products/unknown-synthetic-central-identity');
        assert.equal(missing.status, 404);
        assert.equal(missing.body.clear_previous, true);
        assert.equal(missing.body.record, undefined);
        assert.equal(missing.body.state, undefined);
    });

    await runCase('a real delegated read token cannot publish and a source worker credential cannot replace read authorization', async () => {
        const separated = await cycle.command({ command: 'credential_roles_separate' });
        assert.equal(separated.event, 'checked');
        assert.equal(separated.read_token_publish_status, 401);
        assert.equal(separated.source_token_read_status, 401);
        assert.equal(separated.external_effects, 0);
        const stillReadable = await wa.read(`/shared-products/${encodeURIComponent(entityId)}`);
        assert.equal(stillReadable.status, 200);
        assert.equal(stillReadable.body.record.version, firstVersion);
    });

    await runCase('native update retains source-qualified identity and advances the actual shared version', async () => {
        const updated = await cycle.command({ command: 'update_and_publish' });
        assert.equal(updated.event, 'published');
        assert.equal(updated.entity_id, entityId);
        assert.ok(updated.version > firstVersion);
        assert.deepEqual(updated.source, sourceIdentity);
        const read = await wa.read(`/shared-products/${encodeURIComponent(entityId)}`);
        assert.equal(read.status, 200);
        assert.equal(read.body.record.version, updated.version);
        assert.deepEqual(read.body.record.data, updated.allowed_data);
        const changes = await wa.read(`/shared-product-changes?after=${encodeURIComponent(after)}&limit=100`);
        assert.equal(changes.status, 200);
        assert.ok(changes.body.cursor >= after);
        after = changes.body.cursor;
    });

    await runCase('duplicate and already-applied older delivery cannot duplicate or overwrite a record', async () => {
        const before = await wa.read(`/shared-products/${encodeURIComponent(entityId)}`);
        const duplicate = await cycle.command({ command: 'retry_duplicate_and_reverse' });
        assert.equal(duplicate.event, 'checked');
        assert.equal(duplicate.duplicate_effects, 0);
        const afterRead = await wa.read(`/shared-products/${encodeURIComponent(entityId)}`);
        assert.equal(afterRead.status, 200);
        assert.deepEqual(afterRead.body.record, before.body.record);
        assert.equal(duplicate.external_effects, 0);
    });

    await runCase('unseen later partial revision is deferred/rejected, then the actual source worker resumes in order', async () => {
        const before = await wa.read(`/shared-products/${encodeURIComponent(entityId)}`);
        const resumed = await cycle.command({ command: 'unseen_reverse_order_and_resume' });
        assert.equal(resumed.event, 'checked');
        assert.equal(resumed.worker_waited, true);
        assert.equal(resumed.gap_status, 409);
        assert.equal(resumed.resumed, true);
        assert.equal(resumed.entity_id, entityId);
        assert.deepEqual(resumed.source, sourceIdentity);
        const afterRead = await wa.read(`/shared-products/${encodeURIComponent(entityId)}`);
        assert.equal(afterRead.status, 200);
        assert.ok(afterRead.body.record.version > before.body.record.version);
        assert.equal(afterRead.body.record.version, resumed.version);
        assert.deepEqual(afterRead.body.record.data, resumed.allowed_data);
        assert.equal(resumed.external_effects, 0);
    });

    await runCase('native archive is explicit and an older source fact cannot revive it', async () => {
        const archived = await cycle.command({ command: 'archive_and_publish' });
        assert.equal(archived.event, 'published');
        assert.equal(archived.entity_id, entityId);
        const read = await wa.read(`/shared-products/${encodeURIComponent(entityId)}`);
        assert.equal(read.status, 200);
        assert.equal(archived.state, 'archived');
        assert.equal(read.body.record.state, archived.state);
        await cycle.command({ command: 'retry_old_active' });
        const stillArchived = await wa.read(`/shared-products/${encodeURIComponent(entityId)}`);
        assert.equal(stillArchived.status, 200);
        assert.equal(stillArchived.body.record.state, read.body.record.state);
        assert.equal(stillArchived.body.record.version, read.body.record.version);
    });

    await runCase('current grant revocation overrides the previous successful read without cached fallback', async () => {
        await cycle.command({ command: 'revoke_wa_read_grant' });
        const revoked = await wa.read(`/shared-products/${encodeURIComponent(entityId)}`);
        assert.equal(revoked.status, 403);
        assert.equal(revoked.body.clear_previous, true);
        assert.equal(revoked.body.record, undefined);
        await cycle.command({ command: 'restore_wa_read_grant' });
        const fresh = await wa.read(`/shared-products/${encodeURIComponent(entityId)}`);
        assert.equal(fresh.status, 200);
    });

    await runCase('local session revocation prevents reuse of a previous central read binding', async () => {
        wa.database.prepare('UPDATE users SET auth_version = 1 WHERE id = 1').run();
        const revoked = await wa.read(`/shared-products/${encodeURIComponent(entityId)}`);
        assert.equal(revoked.status, 401);
        wa.database.prepare('UPDATE users SET auth_version = 0 WHERE id = 1').run();
        wa.bindings.revoke(wa.principals.reader);
        const unbound = await wa.read(`/shared-products/${encodeURIComponent(entityId)}`);
        assert.equal(unbound.status, 403);
        assert.equal(unbound.body.clear_previous, true);
    });

    await runCase('an unavailable authority is not a deletion and cannot return stale authorization', async () => {
        wa.bindings.bind(wa.principals.reader, {
            accessToken: ready.consumer.access_token, expiresAt: ready.consumer.expires_at,
            scope: ready.consumer.scope, consumerInstallationId: ready.consumer.installation_id,
            consumerAccountId: ready.consumer.account_id, centralActorId: ready.consumer.actor_id,
        });
        await cycle.command({ command: 'stop_center_http' });
        const unavailable = await wa.read(`/shared-products/${encodeURIComponent(entityId)}`);
        assert.equal(unavailable.status, 503);
        assert.equal(unavailable.body.clear_previous, true);
        assert.equal(unavailable.body.record, undefined);
        assert.equal(unavailable.body.lifecycle, undefined);
    });

    assert.deepEqual(countEffects(wa.database), wa.baseline);
    assert.deepEqual(wa.database.prepare('SELECT * FROM bot_products ORDER BY id').all(), wa.legacyBefore);
    assert.equal(wa.effects.external_network, 0);
    assert.equal(wa.effects.channel_requests, 0);
    assert.equal(scenarios.every(scenario => scenario.status === 'passed'), true);
    evidence = {
        project: 'WA-Savana', date: '2026-11-17', timezone: 'Africa/Tripoli',
        status: 'passed_real_catalog_source_center_wa_http_cycle_in_owned_synthetic_fixtures',
        handoff: handoffEvidence, source_acceptance_attribution: 'This run tests actual Catalog source HTTP and publisher as used by WA; it does not claim Catalog chat ran or accepted its own tests.',
        scenario_count: scenarios.length, scenarios,
        verification: {
            unique_http_scenarios_passed: scenarios.filter(scenario => scenario.status === 'passed').length,
            node_tests_including_parent: scenarios.length + 1,
            failures: scenarios.filter(scenario => scenario.status === 'failed').length,
            retries_counted_as_extra_scenarios: false,
            final_cleanup_confirming_run_is_authoritative: true,
            runtime: process.version,
        },
        services: ['Actual Catalog native Offering HTTP + ProductSourcePublisher', 'Actual central source/record/search/change/context/eligibility HTTP with source credentials and OIDC', 'Actual WA authMiddleware + tenantMiddleware + shared read router/adapter'],
        no_effects: { external_network_attempts: wa.effects.external_network, channel_requests: wa.effects.channel_requests,
            local_effect_tables_unchanged: true, legacy_quarantined_product_rows_unchanged: true,
            effect_table_counts_before: wa.baseline, effect_table_counts_after: countEffects(wa.database) },
        actual_modules: {
            wa_adapter: 'server/services/centralProductRead.js', wa_router: 'server/routes/sharedProductReads.js',
            wa_auth: ['server/middleware/auth.js', 'server/middleware/tenant.js'],
            central_factory: 'tools/product_cycle_acceptance_fixture.py',
            catalog_factory: 'backend/src/tests/acceptance/catalog_product_source.py',
            catalog_worker: 'backend/src/app/integrations/product_source_publisher.py',
        },
        data_kind: 'synthetic_only_no_business_data', deployment_or_runtime_activation: false,
        modified_other_project_sources: false, new_shared_contracts: false,
        catalog_own_test_execution_claimed: false, sawemly_adapter_acceptance_claimed: false,
        limitations: ['No actual POS source/package accessed or executed.', 'Catalog native archive was tested; tombstone is not emitted by its native source path.', 'WA reads through fresh authorization and stores no inbox/projection/cursor.', 'No real grants/field ownership/units/prices or production credentials were configured.'],
    };
});
