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

    def test_faults_are_typed_owned_provider_controls_never_arbitrary_methods(self):
        instance = self.instance()
        with mock.patch.object(instance, 'exchange', return_value={'configured': True}) as exchange:
            instance.dispatch('fault', {'target': 'message_provider', 'mode': 'commit_then_drop_ack'})
            self.assertEqual(exchange.call_count, 1)
            self.assert_code('unsupported_fault', instance.dispatch, 'fault', {'target': 'public', 'mode': 'commit_then_drop_ack'})
            self.assert_code('unsupported_fault', instance.dispatch, 'fault', {'target': 'message_provider', 'mode': 'success'})
            self.assert_code('invalid_request', instance.dispatch, 'fault', {'target': 'message_provider', 'mode': 'restore', 'body': {}})
            self.assertEqual(exchange.call_count, 1)

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
        self.assertNotIn('inventory_sales_transfers_counts', journeys)
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

    def test_factory_identity_invalidates_when_either_fixture_only_evidence_helper_changes(self):
        controller = self.root / 'tools/factory.py'; controller.parent.mkdir(); controller.write_text('synthetic controller')
        support = self.root / 'server/test-support'; support.mkdir(parents=True)
        helpers = [support / name for name in ['ownerJourneyCapabilityProofs.js', 'ownerJourneyConsumerEvidence.js']]
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
