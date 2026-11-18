import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location('wa_owner_factory', Path(__file__).resolve().parents[1] / 'wa_owner_journey_factory.py')
factory = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(factory)
NODE = Path('/Users/savana/Dev/.tools/whatsapp/node-v22.23.5-darwin-arm64/bin/node')


class OwnerJourneyFactoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()

    def params(self):
        urls = {key: f'http://127.0.0.1:{19500 + offset}' for key, offset in factory.OFFSETS.items()}
        urls['catalog_domain_proxy'] = 'https://127.0.0.1:19510'
        return {'run_id': 'synthetic_parser_only', 'state_root': str(self.root / 'state'), 'port_base': 19500, 'urls': urls,
                'credentials': {key: 'synthetic-only-' + key + '-not-a-real-secret' for key in
                    ['platform_token', 'callback_token', 'subscriptions_platform_token', 'subscription_signing']},
                'peers': {'wa_savana': dict(factory.PEER_METADATA)}, 'source_revision': 'a' * 40, 'source_sha256': 'b' * 64,
                'identity': {'client_id': 'synthetic-public-native-client', 'redirect_uri': urls['wa_frontend'] + factory.PEER_METADATA['oidc_redirect_path'],
                    'issuer': urls['portal'], 'discovery_url': urls['portal'] + '/.well-known/openid-configuration',
                    'subscriptions_url': urls['subscriptions'], 'portal_url': urls['portal'], 'ingress_service': 'portal',
                    'ingress_url': urls['portal'], 'api_base_url': urls['portal'], 'authorization_endpoint': urls['portal'] + '/oauth/authorize',
                    'token_endpoint': urls['portal'] + '/v1/oidc/token', 'userinfo_endpoint': urls['portal'] + '/v1/oidc/userinfo',
                    'jwks_uri': urls['portal'] + '/.well-known/jwks.json'}}

    def instance(self):
        with mock.patch.object(factory, 'executable', return_value=str(NODE)):
            return factory.Factory(str(NODE), 'a' * 40, 'b' * 64, 'c' * 64)

    def assert_code(self, code, function, *args):
        with self.assertRaises(factory.ProtocolError) as caught:
            function(*args)
        self.assertEqual(caught.exception.code, code)

    def test_protocol_rejects_unknown_commands_duplicate_keys_nonfinite_and_oversize(self):
        valid = {'id': 'r-1', 'command': 'diagnostics', 'params': {}}
        self.assertEqual(factory.parse_request(json.dumps(valid)), valid)
        for line in ['{"id":"x","id":"y","command":"stop","params":{}}',
                     '{"id":"x","command":"eval","params":{}}',
                     '{"id":"x","command":"start","params":{"bad":NaN}}',
                     json.dumps({**valid, 'shell': 'forbidden'}), '[]']:
            self.assert_code('invalid_request', factory.parse_request, line)
        self.assert_code('request_too_large', factory.parse_request, 'x' * (factory.MAX_LINE + 1))

    def test_start_requires_exact_declared_loopback_offsets_and_fresh_external_child(self):
        self.assertEqual(factory.start_params(self.params()), self.params())
        for key in ('wa_savana', 'connect', 'message_provider'):
            params = self.params()
            params['urls'][key] = 'http://example.invalid:19500'
            self.assert_code('published_schema_invalid', factory.start_params, params)
        params = self.params(); params['port_base'] = True
        self.assert_code('published_schema_invalid', factory.start_params, params)
        params = self.params(); params['state_root'] = str(self.root)
        self.assert_code('new_owned_state_required', factory.start_params, params)
        link = self.root / 'link'; link.symlink_to(self.root, target_is_directory=True)
        params = self.params(); params['state_root'] = str(link / 'state')
        self.assert_code('new_owned_state_required', factory.start_params, params)

    def test_occupied_local_port_is_refused_without_touching_listener(self):
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0)); listener.listen()
            port = listener.getsockname()[1]
            self.assert_code('owned_port_occupied', factory.refuse_listeners, port - 5)
            self.assertEqual(listener.getsockname()[1], port)

    def test_absent_real_factory_fails_before_any_state_or_process_is_created(self):
        instance = self.instance()
        with mock.patch.object(factory, 'APPLICATION', self.root / 'absent.js'):
            self.assert_code('application_factory_unavailable', instance.start, self.params())
        self.assertFalse((self.root / 'state').exists())
        self.assertIsNone(instance.child)

    def test_failed_start_cleans_only_allocated_state_and_owned_process(self):
        instance = self.instance()
        sentinel = self.root / 'untouched'; sentinel.write_text('unrelated synthetic file')
        module = self.root / 'application.js'; module.write_text('source marker only; not an app')
        with mock.patch.object(factory, 'APPLICATION', module), mock.patch.object(factory, 'source_identity', return_value=('b' * 64, [])), \
                mock.patch.object(instance, 'launch', side_effect=factory.ProtocolError('application_factory_unavailable')):
            self.assert_code('application_factory_unavailable', instance.start, self.params())
        self.assertFalse((self.root / 'state').exists())
        self.assertTrue(sentinel.is_file())
        self.assertIsNone(instance.config)

    def test_stop_terminates_real_owned_child_but_preserves_sibling_state(self):
        instance = self.instance()
        owned = self.root / 'state'; owned.mkdir()
        (owned / 'owned.txt').write_text('synthetic')
        sibling = self.root / 'sibling.txt'; sibling.write_text('preserve')
        instance.state = owned
        instance.state_identity = (owned.stat().st_dev, owned.stat().st_ino)
        instance.child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        child = instance.child
        try:
            self.assertEqual(instance.stop({}), {'owned_process_stopped': True, 'owned_state_removed': True})
            self.assertIsNotNone(child.poll())
            self.assertFalse(owned.exists())
            self.assertEqual(sibling.read_text(), 'preserve')
        finally:
            if child.poll() is None:
                child.kill(); child.wait()

    def test_stop_refuses_replaced_state_directory_and_never_follows_symlink(self):
        instance = self.instance()
        owned = self.root / 'state'; owned.mkdir()
        instance.state = owned
        instance.state_identity = (owned.stat().st_dev, owned.stat().st_ino)
        owned.rmdir()
        sibling = self.root / 'preserve'; sibling.mkdir()
        (sibling / 'sentinel').write_text('preserve')
        owned.symlink_to(sibling, target_is_directory=True)
        self.assert_code('owned_state_identity_changed', instance.stop, {})
        self.assertEqual((sibling / 'sentinel').read_text(), 'preserve')
        owned.unlink()
        owned.symlink_to(self.root / 'missing-target', target_is_directory=True)
        self.assert_code('owned_state_identity_changed', instance.stop, {})
        self.assertTrue(owned.is_symlink())

    def test_canonical_fault_calls_owned_driver_once_and_returns_only_actual_typed_arming_receipt(self):
        instance = self.instance()
        for boundary in ('owned_provider_http', 'native_adapter_http'):
            receipt = {'fault': 'commit_then_drop_ack_once', 'armed': True, 'boundary': boundary}
            with mock.patch.object(instance, 'exchange', return_value=receipt) as exchange, \
                    mock.patch.object(factory, 'validate_schema') as diagnostic_validator:
                self.assertEqual(instance.dispatch('fault', {'fault': 'commit_then_drop_ack_once'}), receipt)
                exchange.assert_called_once_with('fault', {'target': 'message_provider', 'mode': 'commit_then_drop_ack'})
                diagnostic_validator.assert_not_called()

    def test_fault_rejects_unpublished_controls_and_unknown_keys_before_driver(self):
        instance = self.instance()
        with mock.patch.object(instance, 'exchange') as exchange:
            for params in ({}, {'target': 'message_provider', 'mode': 'commit_then_drop_ack'},
                           {'fault': 'commit_then_drop_ack_once', 'target': 'payment_provider'},
                           {'fault': 'commit_then_drop_ack_once', 'correlation': 'unpublished-selector'},
                           {'fault': 'commit_then_drop_ack_once', 'url': 'https://outside.invalid'},
                           {'fault': 'commit_then_drop_ack_once', 'body': {}}, []):
                self.assert_code('invalid_request', instance.dispatch, 'fault', params)
            for fault in ('restore', 'commit_then_drop_ack', 'success', None, True, {}):
                self.assert_code('unsupported_fault', instance.dispatch, 'fault', {'fault': fault})
            exchange.assert_not_called()

    def test_fault_never_fabricates_armed_ack_from_diagnostic_false_or_malformed_runtime_response(self):
        instance = self.instance()
        valid = {'fault': 'commit_then_drop_ack_once', 'armed': True, 'boundary': 'owned_provider_http'}
        malformed = [None, {}, {'configured': True}, {'facts': {}}, {**valid, 'armed': False},
                     {**valid, 'armed': 1}, {**valid, 'armed': 'true'}, {**valid, 'fault': 'restore'},
                     {**valid, 'boundary': 'public_provider'}, {**valid, 'boundary': []},
                     {key: value for key, value in valid.items() if key != 'boundary'},
                     {**valid, 'secret': 'synthetic-private-value'}]
        for response in malformed:
            with self.subTest(response=response), mock.patch.object(instance, 'exchange', return_value=response) as exchange:
                self.assert_code('runtime_protocol_invalid', instance.dispatch, 'fault', {'fault': 'commit_then_drop_ack_once'})
                exchange.assert_called_once()
        with mock.patch.object(instance, 'exchange', side_effect=factory.ProtocolError('runtime_not_running')) as exchange:
            self.assert_code('runtime_not_running', instance.dispatch, 'fault', {'fault': 'commit_then_drop_ack_once'})
            exchange.assert_called_once()

    def test_restart_reuses_private_memory_and_drops_credentials_from_response(self):
        instance = self.instance()
        instance.config = {'run_id': 'synthetic'}
        instance.private_runtime = {'password': 'synthetic-in-memory'}
        original = instance.config
        original_private = instance.private_runtime
        with mock.patch.object(instance, 'stop_process') as stop, mock.patch.object(instance, 'launch', return_value={'run_id': 'test', 'browser_context': {'ordinary_owner': 'never-public'}}):
            result = instance.dispatch('restart', {})
        self.assertIs(instance.config, original)
        self.assertIs(instance.private_runtime, original_private)
        self.assertEqual(stop.call_count, 1)
        self.assertNotIn('browser_context', result)

    def test_manifest_is_new_public_metadata_with_explicit_source_and_runtime_pins(self):
        instance_args = type('Args', (), {'source_revision': 'a' * 40, 'python': sys.executable, 'node': str(NODE), 'output': str(self.root / 'manifest.json')})()
        with mock.patch.object(factory.subprocess, 'check_output', return_value=('a' * 40 + '\n').encode()), \
                mock.patch.object(factory, 'source_identity', return_value=('b' * 64, [{'path': 'server/start.js'}])), \
                mock.patch.object(factory, 'executable', side_effect=lambda value, kind: value):
            manifest = factory.publish_manifest(instance_args)
        self.assertEqual(manifest['source_sha256'], 'b' * 64)
        self.assertEqual(manifest['entrypoint']['args'], ['--stdio'])
        bootstrap = Path(manifest['entrypoint']['script']).read_bytes()
        self.assertEqual(factory.digest(bootstrap), manifest['entrypoint']['sha256'])
        self.assertIn(b'fixture_sha256=', bootstrap)
        self.assertFalse(manifest['loads_real_env_or_shared_database'])
        self.assertFalse(manifest['acceptance_performed'])
        self.assertEqual(manifest['services']['wa_savana']['port_offset'], 5)
        self.assertEqual(manifest['oidc_redirect_service'], 'wa_frontend')
        self.assertEqual(manifest['connect_callback_path'], '/api/integrations/connect/events')
        journeys = manifest['owner_journeys']
        self.assertEqual(journeys['ordinary_owner_login']['owner_entrypoints'], [{'service': 'wa_frontend', 'path': '/login'}])
        self.assertEqual(journeys['named_activity_permissions']['owner_entrypoints'][0]['path'],
                         '/portal/integrations?workspace=shared&action=capability-grants.manage')
        self.assertEqual(journeys['units_variants_owner_context']['capability_codes'], ['products.read'])
        self.assertNotIn('units.variants', journeys['units_variants_owner_context']['capability_codes'])
        linked = {
            'deficit_and_reconciliation': ['inventory.read'],
            'inventory_sales_transfers_counts': ['inventory.read', 'inventory.facts', 'inventory.transfer', 'inventory.count'],
            'orders_request_fulfil_cancel': ['orders.request', 'orders.fulfil'],
        }
        for scenario, codes in linked.items():
            self.assertEqual(journeys[scenario], {
                'owner_entrypoints': [{'service': 'wa_frontend', 'path': '/portal/integrations?workspace=shared'}],
                'capability_codes': codes,
            })
        declarations = manifest['owner_journey_declarations']
        self.assertIn('current operator-validated source owner_action_url', declarations['inventory_and_order_scope'])
        self.assertIn('WA declares no native stock/order handler or inventory ledger', declarations['inventory_and_order_scope'])
        self.assertIn('not WA native handler registration or every-provider support', declarations['linked_source_capability_tags'])
        self.assertIn('global proof union', declarations['linked_source_capability_tags'])
        self.assertIn('do not prove initiation', declarations['deficit_reconciliation_evidence'])
        self.assertIn('source-native Catalog deficit body', declarations['deficit_reconciliation_evidence'])
        self.assertIn('checked absence of WA inventory ledgers', declarations['deficit_reconciliation_evidence'])
        self.assertIn('explicit Parent criterion correction', declarations['deficit_reconciliation_evidence'])
        self.assertIn('no counter is invented', declarations['deficit_reconciliation_evidence'])
        self.assertFalse(any('http://' in entry['path'] or 'https://' in entry['path']
                             for scenario in linked for entry in journeys[scenario]['owner_entrypoints']))
        self.assertNotIn('collections_payment_refund', journeys)
        self.assertIn('does not certify a Catalog-owned', manifest['owner_journey_declarations']['media_scope'])
        app_routes = (factory.ROOT / 'client/src/App.jsx').read_text()
        for journey in journeys.values():
            for entry in journey['owner_entrypoints']:
                self.assertEqual(entry['service'], 'wa_frontend')
                self.assertIn('path="' + entry['path'].split('?', 1)[0] + '"', app_routes)
        self.assertNotIn('factory_ready', manifest)
        text = Path(instance_args.output).read_text()
        self.assertNotIn('password', text)
        with mock.patch.object(factory.subprocess, 'check_output', return_value=('a' * 40 + '\n').encode()), \
                mock.patch.object(factory, 'source_identity', return_value=('b' * 64, [])), \
                mock.patch.object(factory, 'executable', side_effect=lambda value, kind: value):
            self.assert_code('new_absolute_output_required', factory.publish_manifest, instance_args)

    def test_factory_identity_invalidates_when_any_fixture_only_helper_changes(self):
        controller = self.root / 'tools/factory.py'; controller.parent.mkdir(); controller.write_text('synthetic controller')
        support = self.root / 'server/test-support'; support.mkdir(parents=True)
        helpers = [support / name for name in ['ownerJourneyCapabilityProofs.js', 'ownerJourneyConsumerEvidence.js', 'ownerJourneyProviderFault.js', 'ownerJourneyResultDelivery.js']]
        for helper in helpers:
            helper.write_text('synthetic evidence helper version one')
        with mock.patch.object(factory, 'ROOT', self.root), mock.patch.object(factory, '__file__', str(controller)), \
                mock.patch.object(factory, 'RUNTIME', support / 'runtime.mjs'), \
                mock.patch.object(factory, 'APPLICATION', support / 'application.js'), \
                mock.patch.object(factory, 'CONTRACTS', support / 'contracts'):
            original, rows = factory.factory_identity()
            self.assertTrue({str(helper.relative_to(self.root)) for helper in helpers} <= {row['path'] for row in rows})
            for helper in helpers:
                helper.write_text('synthetic evidence helper version two')
                self.assertNotEqual(factory.factory_identity()[0], original)
                helper.write_text('synthetic evidence helper version one')
                self.assertEqual(factory.factory_identity()[0], original)

    def diagnostic(self, platform='wa_savana', **extra):
        return {'run_id': 'synthetic', 'platform': platform, 'source_revision': 'a' * 40,
                'source_sha256': 'b' * 64, 'owned_state': True, 'facts': {}, 'observations': [], **extra}

    def catalog_result_row(self):
        # Published synthetic example only: shape validation, no delivered-data or acceptance claim.
        return {'command_id': 'synthetic-count-command', 'version': 2, 'approval_fingerprint': 'a' * 64,
                'provider_ref': 'synthetic-catalog-provider', 'source_installation_id': 'synthetic-catalog-source',
                'scope': {'organization_id': 'synthetic-org', 'activity_id': 'synthetic-activity',
                          'branch_id': 'synthetic-branch', 'warehouse_id': 'synthetic-warehouse'},
                'capability_code': 'inventory.count', 'operation': 'inventory.count_delta',
                'source_result': {'local_entity_id': 'synthetic-reconciliation-fact', 'source_revision': 1,
                                  'result_reference': '/synthetic/owner/reconciliation-result'},
                'content_type': 'application/json', 'byte_length': 27, 'content_sha256': 'b' * 64,
                'observed_at': '2026-11-18T00:00:02+00:00', 'consumer_identity_sha256': 'c' * 64}

    def test_diagnostic_v2_primary_schema_pins_and_historical_snapshot_are_exact(self):
        for filename, expected in {
            'owner-factory-diagnostic-v2.schema.json': '922f8d711eeb725e586270a4e3f3e15cf05ec23a6a64860207f19130bb534ca3',
            'wa-catalog-result-evidence-v1.schema.json': 'facde2374b1b5ef2a0e48c230ebbc173e828455e5b7f3f3628b8a8c274bbd5c9',
            'owner-factory-diagnostic.schema.json': '315e835eaf0b98e5ee47e2fde6f7f893857f0e358b6deb380e34705575eaab50',
        }.items():
            self.assertEqual(factory.digest((factory.CONTRACTS / filename).read_bytes()), expected)
        self.assertEqual(factory.validate_schema('diagnostic', self.diagnostic()), self.diagnostic())
        schema = json.loads((factory.CONTRACTS / 'wa-catalog-result-evidence-v1.schema.json').read_text())
        self.assertTrue(factory.schema_matches(schema, {'catalog_result_reads': [self.catalog_result_row()]}))

    def test_populated_v2_diagnostic_is_accepted_on_actual_controller_start_diagnostics_and_checkpoint_paths(self):
        proof = self.diagnostic(catalog_result_reads=[self.catalog_result_row()])
        instance = self.instance(); instance.config = self.params()
        with mock.patch.object(factory, 'source_identity', return_value=('b' * 64, [])), \
                mock.patch.object(factory, 'factory_identity', return_value=('c' * 64, [])), \
                mock.patch.object(factory.subprocess, 'check_output', return_value=('a' * 40 + '\n').encode()), \
                mock.patch.object(factory, 'refuse_listeners'), mock.patch.object(factory.subprocess, 'Popen'), \
                mock.patch.object(instance, 'exchange', return_value={**copy.deepcopy(proof), '_private_runtime': {'synthetic': 'private'}}) as exchange:
            self.assertEqual(instance.launch(), proof)
            self.assertEqual(exchange.call_args.args[0], 'start')
        for command, params in [('diagnostics', {}), ('checkpoint', {'scenario': 'deficit_and_reconciliation'})]:
            with mock.patch.object(instance, 'exchange', return_value=copy.deepcopy(proof)) as exchange:
                self.assertEqual(instance.dispatch(command, params), proof)
                exchange.assert_called_once_with(command, params)

    def test_v2_closed_evidence_rows_reject_bad_types_scopes_dates_and_unpublished_fields(self):
        changes = [{'unexpected': 'not a published field'}, {'command_id': ' '}, {'command_id': 'x' * 256},
                   {'command_id': 'synthetic\x00value'}, {'version': True}, {'version': 2.0}, {'version': 0},
                   {'version': 9007199254740992}, {'byte_length': True}, {'byte_length': 1.0}, {'byte_length': 0},
                   {'byte_length': 4194305}, {'approval_fingerprint': 'A' * 64}, {'approval_fingerprint': 'a' * 64 + '\n'},
                   {'content_sha256': 'b' * 64 + '\n'}, {'content_sha256': 'bad'},
                   {'consumer_identity_sha256': False}, {'content_type': 'text/html'},
                   {'observed_at': '2026-11-18T00:00:02'}, {'observed_at': '2026-02-31T00:00:02Z'},
                   {'capability_code': 'inventory.read'}, {'operation': 'inventory.read'},
                   {'source_result': {'local_entity_id': 'x', 'source_revision': True, 'result_reference': 'x'}},
                   {'source_result': {'local_entity_id': 'x', 'source_revision': 1, 'result_reference': 'x', 'secret': 'unpublished'}},
                   {'scope': {'organization_id': 'synthetic-org', 'activity_id': 'synthetic-activity'}},
                   {'scope': {'organization_id': 'synthetic-org', 'activity_id': 'synthetic-activity', 'branch_id': None, 'warehouse_id': 'warehouse'}},
                   {'scope': {'organization_id': 'synthetic-org', 'activity_id': 'synthetic-activity', 'branch_id': None, 'warehouse_id': None, 'tenant_id': 1}}]
        for change in changes:
            with self.subTest(change=change):
                row = {**self.catalog_result_row(), **change}
                self.assert_code('published_schema_invalid', factory.validate_schema, 'diagnostic', self.diagnostic(catalog_result_reads=[row]))
        for invalid in (None, {}, True, 'not an array'):
            self.assert_code('published_schema_invalid', factory.validate_schema, 'diagnostic', self.diagnostic(catalog_result_reads=invalid))

    def test_v2_evidence_maximum_and_platform_ownership_are_enforced_without_native_authority_inference(self):
        row = self.catalog_result_row()
        self.assertEqual(len(factory.validate_schema('diagnostic', self.diagnostic(catalog_result_reads=[row] * 512))['catalog_result_reads']), 512)
        self.assert_code('published_schema_invalid', factory.validate_schema, 'diagnostic', self.diagnostic(catalog_result_reads=[row] * 513))
        read = {**row, 'capability_code': 'inventory.read', 'operation': 'inventory.read',
                'scope': {**row['scope'], 'branch_id': None, 'warehouse_id': None}}
        factory.validate_schema('diagnostic', self.diagnostic(catalog_result_reads=[read]))
        reconciliation = {key: value for key, value in row.items() if key != 'consumer_identity_sha256'}
        reconciliation.update(ledger_record_ref=row['source_result']['local_entity_id'], deficit_ledger_record_ref='synthetic-preceding-deficit-fact')
        factory.validate_schema('diagnostic', self.diagnostic('catalog', catalog_reconciliations=[reconciliation]))
        for platform in ('core', 'catalog', 'sawemly'):
            self.assert_code('published_schema_invalid', factory.validate_schema, 'diagnostic', self.diagnostic(platform, catalog_result_reads=[row]))
        for platform in ('core', 'wa_savana', 'sawemly'):
            self.assert_code('published_schema_invalid', factory.validate_schema, 'diagnostic', self.diagnostic(platform, catalog_reconciliations=[reconciliation]))
        for platform in ('core', 'catalog', 'sawemly', 'wa_savana'):
            factory.validate_schema('diagnostic', self.diagnostic(platform, catalog_result_reads=[], catalog_reconciliations=[]))

    def test_invalid_v2_child_diagnostic_never_escapes_controller_checkpoint_validation(self):
        instance = self.instance()
        invalid = self.diagnostic(catalog_result_reads=[{**self.catalog_result_row(), 'arbitrary_header': 'unpublished'}])
        for command in ('diagnostics', 'checkpoint'):
            with mock.patch.object(instance, 'exchange', return_value=invalid):
                self.assert_code('published_schema_invalid', instance.dispatch, command, {})

    def test_actual_schema_rejects_legacy_wire_authority_fields_wrong_identity_and_unmeasured_counters(self):
        params = self.params(); factory.start_params(params)
        old = dict(params); old['owned_state_root'] = old.pop('state_root')
        self.assert_code('published_schema_invalid', factory.start_params, old)
        wrong = self.params(); wrong['identity']['redirect_uri'] = wrong['urls']['wa_savana'] + factory.PEER_METADATA['oidc_redirect_path']
        self.assert_code('identity_registration_mismatch', factory.start_params, wrong)
        wrong = self.params(); wrong['identity']['issuer'] = wrong['urls']['connect']
        self.assert_code('identity_registration_mismatch', factory.start_params, wrong)
        wrong = self.params(); wrong['credentials']['ready'] = True
        self.assert_code('published_schema_invalid', factory.start_params, wrong)
        proof = {'run_id': 'synthetic', 'platform': 'wa_savana', 'source_revision': 'a' * 40, 'source_sha256': 'b' * 64,
                 'owned_state': True, 'facts': {}, 'observations': []}
        factory.validate_schema('diagnostic', proof)
        for facts in [{'confirmed_message_results': None}, {'confirmed_message_results': True}, {'not_canonical': 0}]:
            self.assert_code('published_schema_invalid', factory.validate_schema, 'diagnostic', {**proof, 'facts': facts})
        observation = {'service': 'wa_savana', 'method': 'POST', 'path_template': '/api/auth/login', 'status': 200}
        self.assert_code('published_schema_invalid', factory.validate_schema, 'diagnostic', {**proof, 'observations': [observation]})

    def test_current_runtime_identity_includes_working_new_files_and_modes_without_git_metadata_or_state(self):
        repository = self.root / 'repo'; repository.mkdir()
        subprocess.run(['git', 'init', '-q', str(repository)], check=True)
        (repository / 'tools').mkdir()
        shutil.copyfile(factory.ROOT / 'tools/package_wa_production_candidate.py', repository / 'tools/package_wa_production_candidate.py')
        def write(name, text):
            target = repository / name; target.parent.mkdir(parents=True, exist_ok=True); target.write_text(text)
            return target
        runtime = write('server/services/newJourney.js', 'export const current = 1;\n')
        write('client/src/pages/Logs/Logs.jsx', 'export default function Logs() {}\n')
        for name in ('server/.env', 'server/local.db', 'server/node_modules/local.js', 'client/dist/local.js', 'server/test-support/local.js', 'docs/local.md'):
            write(name, 'must not enter runtime identity')
        first, rows = factory.source_identity(repository)
        self.assertEqual([row['path'] for row in rows], ['client/src/pages/Logs/Logs.jsx', 'server/services/newJourney.js'])
        subprocess.run(['git', 'add', '--all'], cwd=repository, check=True)
        subprocess.run(['git', '-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '-qm', 'synthetic identity only'], cwd=repository, check=True)
        self.assertEqual(factory.source_identity(repository)[0], first)
        write('docs/local.md', 'nonruntime metadata changed')
        self.assertEqual(factory.source_identity(repository)[0], first)
        runtime.write_text('export const current = 2;\n')
        second = factory.source_identity(repository)[0]
        self.assertNotEqual(second, first)
        runtime.chmod(0o755)
        self.assertNotEqual(factory.source_identity(repository)[0], second)
        runtime.unlink(); runtime.symlink_to(repository / 'docs/local.md')
        self.assert_code('source_input_unavailable', factory.source_identity, repository)

    def test_stdio_errors_redact_private_input_and_eof_cleans(self):
        args = type('Args', (), {'node': str(NODE), 'source_revision': 'a' * 40, 'source_sha256': 'b' * 64, 'fixture_sha256': 'c' * 64})()
        instance = self.instance()
        payload = json.dumps({'id': 'private-test', 'command': 'eval', 'params': {'password': 'must-not-echo'}}) + '\n'
        output = io.StringIO()
        with mock.patch.object(factory, 'Factory', return_value=instance), mock.patch.object(sys, 'stdin', io.StringIO(payload)), \
                mock.patch.object(sys, 'stdout', output), mock.patch.object(instance, 'stop', return_value={}) as stop:
            factory.serve(args)
        self.assertNotIn('must-not-echo', output.getvalue())
        self.assertEqual(json.loads(output.getvalue())['data'], {'error_code': 'invalid_request'})
        stop.assert_called_once_with({})


if __name__ == '__main__':
    unittest.main()
