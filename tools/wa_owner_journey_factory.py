#!/usr/bin/env python3
"""Private JSONL controller for the source-owned WA ordinary-owner journey.

This does not certify a journey. Missing actual application wiring fails closed.
No environment files, existing databases, arbitrary modules or shell commands load.
"""
import argparse
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import select
import shutil
import socket
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / 'server/test-support/ownerJourneyRuntime.mjs'
APPLICATION = ROOT / 'server/test-support/ownerJourneyApplication.js'
CONTRACTS = ROOT / 'server/test-support/owner-journey-contracts'
NODE_VERSION = 'v22.23.5'
GENERATION = 'owner-operational-completion-20261118'
OFFSETS = {'connect': 0, 'subscriptions': 1, 'portal': 2, 'catalog': 3, 'sawemly': 4,
           'wa_savana': 5, 'wa_frontend': 6, 'message_provider': 7, 'payment_provider': 8, 'controller': 9}
MAX_LINE = 1024 * 1024
sys.dont_write_bytecode = True
PEER_METADATA = {'oidc_redirect_path': '/api/portal/integrations/shared-read-setup/callback',
    'oidc_redirect_service': 'wa_frontend', 'cookie_name': 'wa_session',
    'connect_callback_service': 'wa_savana', 'connect_callback_path': '/api/integrations/connect/events',
    'command_adapter_service': 'wa_savana', 'command_adapter_path': '/api/savana/command-adapter/v1',
    'signature_target_prefix': '', 'owner_action_service': 'wa_frontend', 'owner_action_base_path': '/portal/integrations'}


def schema_matches(schema, value, root=None):
    """Strict standard-library validation for the published fixture schema subset."""
    if schema is True:
        return True
    if schema is False:
        return False
    root = schema if root is None else root
    if '$ref' in schema:
        reference = schema['$ref']
        if not isinstance(reference, str) or not reference.startswith('#/'):
            return False
        target = root
        try:
            for part in reference[2:].split('/'):
                target = target[part.replace('~1', '/').replace('~0', '~')]
        except (KeyError, TypeError):
            return False
        if not schema_matches(target, value, root):
            return False
    if 'const' in schema and (type(value) is not type(schema['const']) or value != schema['const']):
        return False
    if 'enum' in schema and not any(type(value) is type(option) and value == option for option in schema['enum']):
        return False
    types = {'object': lambda x: isinstance(x, dict), 'array': lambda x: isinstance(x, list),
             'string': lambda x: isinstance(x, str), 'integer': lambda x: type(x) is int,
             'boolean': lambda x: type(x) is bool, 'null': lambda x: x is None}
    if 'type' in schema and (schema['type'] not in types or not types[schema['type']](value)):
        return False
    if 'oneOf' in schema and sum(schema_matches(option, value, root) for option in schema['oneOf']) != 1:
        return False
    if 'anyOf' in schema and not any(schema_matches(option, value, root) for option in schema['anyOf']):
        return False
    if 'not' in schema and schema_matches(schema['not'], value, root):
        return False
    if any(not schema_matches(rule, value, root) for rule in schema.get('allOf', [])):
        return False
    if 'if' in schema:
        branch = 'then' if schema_matches(schema['if'], value, root) else 'else'
        if not schema_matches(schema.get(branch, {}), value, root):
            return False
    if isinstance(value, str):
        pattern = schema.get('pattern')
        matched = True if pattern is None else (re.fullmatch(pattern, value)
            if pattern.startswith('^') and pattern.endswith('$') else re.search(pattern, value))
        if len(value) < schema.get('minLength', 0) or len(value) > schema.get('maxLength', len(value)) or not matched:
            return False
        if schema.get('format') == 'date-time':
            try:
                if not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})', value):
                    return False
                parsed = datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
                if parsed.tzinfo is None:
                    return False
            except ValueError:
                return False
    if type(value) is int and (value < schema.get('minimum', value) or value > schema.get('maximum', value)):
        return False
    if isinstance(value, list):
        if len(value) < schema.get('minItems', 0) or len(value) > schema.get('maxItems', len(value)):
            return False
        if schema.get('uniqueItems') and len({json.dumps(item, sort_keys=True) for item in value}) != len(value):
            return False
        if 'items' in schema and not all(schema_matches(schema['items'], item, root) for item in value):
            return False
    if isinstance(value, dict):
        if len(value) < schema.get('minProperties', 0) or set(schema.get('required', [])) - set(value):
            return False
        for key, item in value.items():
            if 'propertyNames' in schema and not schema_matches(schema['propertyNames'], key, root):
                return False
            if key in schema.get('properties', {}):
                if not schema_matches(schema['properties'][key], item, root):
                    return False
            elif not schema_matches(schema.get('additionalProperties', True), item, root):
                return False
    return True


def validate_schema(name, value):
    filename = 'owner-factory-diagnostic-v2.schema.json' if name == 'diagnostic' else f'owner-factory-{name}.schema.json'
    schema = json.loads((CONTRACTS / filename).read_text())
    if not schema_matches(schema, value):
        raise ProtocolError('published_schema_invalid')
    return value


class ProtocolError(Exception):
    def __init__(self, code):
        self.code = code


def canonical(value):
    return (json.dumps(value, sort_keys=True, ensure_ascii=False, indent=2, allow_nan=False) + '\n').encode()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def strict_object(value, required=(), optional=()):
    if not isinstance(value, dict) or set(value) - set(required) - set(optional) or set(required) - set(value):
        raise ProtocolError('invalid_request')
    return value


def parse_request(line):
    if len(line.encode()) > MAX_LINE:
        raise ProtocolError('request_too_large')
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ProtocolError('invalid_request')
            result[key] = value
        return result
    try:
        value = json.loads(line, object_pairs_hook=unique, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    except (ValueError, RecursionError):
        raise ProtocolError('invalid_request') from None
    strict_object(value, ('id', 'command', 'params'))
    if not isinstance(value['id'], str) or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,128}', value['id']):
        raise ProtocolError('invalid_request')
    if value['command'] not in {'start', 'diagnostics', 'checkpoint', 'fault', 'restart', 'stop'} or not isinstance(value['params'], dict):
        raise ProtocolError('invalid_request')
    return value


def source_identity(repository=ROOT):
    """Same controlled runtime identity algorithm, including current new files."""
    spec = importlib.util.spec_from_file_location('wa_runtime_selection', repository / 'tools/package_wa_production_candidate.py')
    selection = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(selection)
    names = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd=repository,
                                    env={**os.environ, 'GIT_OPTIONAL_LOCKS': '0'}, stderr=subprocess.DEVNULL).decode().split('\0')
    rows = []
    for name in sorted(set(filter(None, names))):
        if not selection.runtime_input(name):
            continue
        path = repository / name
        if path.resolve() != path or not path.is_file():
            raise ProtocolError('source_input_unavailable')
        rows.append({'path': name, 'mode': '0755' if path.stat().st_mode & 0o111 else '0644', 'sha256': digest(path.read_bytes())})
    return digest(canonical({'files': rows})), rows


def factory_identity():
    rows = []
    for file in (Path(__file__), RUNTIME, APPLICATION, ROOT / 'server/test-support/ownerJourneyRouteTemplates.js',
                 ROOT / 'server/test-support/ownerJourneyCapabilityProofs.js', ROOT / 'server/test-support/ownerJourneyConsumerEvidence.js',
                 ROOT / 'server/test-support/ownerJourneyProviderFault.js', ROOT / 'server/test-support/ownerJourneyResultDelivery.js',
                 ROOT / 'server/test-support/ownerJourneyResultBinding.js', ROOT / 'server/test-support/ownerJourneyResultBindingCapture.js',
                 ROOT / 'tools/package_wa_production_candidate.py',
                 *sorted(CONTRACTS.glob('*.schema.json'))):
        if file.is_symlink() or (file.exists() and file.resolve() != file):
            raise ProtocolError('source_input_unavailable')
        if file.is_file():
            rows.append({'path': str(file.relative_to(ROOT)), 'sha256': digest(file.read_bytes())})
    return digest(canonical(rows)), rows


def executable(path, kind):
    selected = Path(path)
    if not selected.is_absolute() or not selected.is_file() or not os.access(selected, os.X_OK):
        raise ProtocolError('interpreter_unavailable')
    if kind == 'node':
        result = subprocess.run([str(selected), '--version'], env={'PATH': str(selected.parent)}, capture_output=True, text=True, timeout=10)
        if result.returncode or result.stdout.strip() != NODE_VERSION:
            raise ProtocolError('node_version_required')
    return str(selected)


def start_params(value):
    validate_schema('start', {'id': 'validate', 'command': 'start', 'params': value})
    strict_object(value, ('run_id', 'state_root', 'port_base', 'urls', 'credentials', 'peers', 'source_revision', 'source_sha256', 'identity'))
    if not isinstance(value['run_id'], str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', value['run_id']):
        raise ProtocolError('invalid_request')
    base = value['port_base']
    if type(base) is not int or not 1024 <= base <= 65525:
        raise ProtocolError('invalid_request')
    strict_object(value['urls'], OFFSETS, ('catalog_domain_proxy',))
    if any(value['urls'][key] != f'http://127.0.0.1:{base + offset}' for key, offset in OFFSETS.items()):
        raise ProtocolError('loopback_urls_required')
    if value['urls'].get('catalog_domain_proxy') != f'https://127.0.0.1:{base + 10}':
        raise ProtocolError('loopback_urls_required')
    strict_object(value['credentials'], ('platform_token', 'callback_token', 'subscriptions_platform_token', 'subscription_signing'))
    if any(not isinstance(item, str) or not 32 <= len(item) <= 4096 for item in value['credentials'].values()):
        raise ProtocolError('invalid_request')
    identity = value['identity']
    expected_identity = {'redirect_uri': value['urls']['wa_frontend'] + PEER_METADATA['oidc_redirect_path'],
        'issuer': value['urls']['portal'], 'discovery_url': value['urls']['portal'] + '/.well-known/openid-configuration',
        'subscriptions_url': value['urls']['subscriptions'], 'portal_url': value['urls']['portal'],
        'ingress_service': 'portal', 'ingress_url': value['urls']['portal'], 'api_base_url': value['urls']['portal'],
        'authorization_endpoint': value['urls']['portal'] + '/oauth/authorize', 'token_endpoint': value['urls']['portal'] + '/v1/oidc/token',
        'userinfo_endpoint': value['urls']['portal'] + '/v1/oidc/userinfo', 'jwks_uri': value['urls']['portal'] + '/.well-known/jwks.json'}
    if any(identity[key] != expected for key, expected in expected_identity.items()):
        raise ProtocolError('identity_registration_mismatch')
    own_peer = value['peers'].get('wa_savana')
    if not own_peer or any(own_peer.get(key) != expected for key, expected in PEER_METADATA.items()):
        raise ProtocolError('native_peer_metadata_mismatch')
    path = Path(value['state_root'])
    # macOS publishes /tmp and /var as operating-system aliases. Resolve those
    # alone, while refusing a caller-created symlink anywhere below them.
    aliases = {Path('/tmp'), Path('/var')}
    if not path.is_absolute() or path.exists() or path.is_symlink() or not path.parent.is_dir() \
            or any(parent.is_symlink() and parent not in aliases for parent in path.parents):
        raise ProtocolError('new_owned_state_required')
    # Allocate only below an explicit fresh child; never remove caller's parent.
    if path.resolve() == ROOT or ROOT in path.resolve().parents:
        raise ProtocolError('state_outside_checkout_required')
    return value


def refuse_listeners(base):
    for offset in (5, 6):
        with socket.socket() as probe:
            # TIME_WAIT from this run's previous process is not a listener.
            # SO_REUSEADDR does not permit binding over an active TCP listener.
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                probe.bind(('127.0.0.1', base + offset))
            except OSError:
                raise ProtocolError('owned_port_occupied') from None


class Factory:
    def __init__(self, node, source_revision, source_sha256, fixture_sha256):
        self.node = executable(node, 'node')
        self.revision, self.source_sha = source_revision, source_sha256
        self.fixture_sha = fixture_sha256
        self.child = None
        self.config = None
        self.private_runtime = None
        self.state = None
        self.state_identity = None
        self.generation = 0

    def exchange(self, command, params, timeout=45):
        if not self.child or self.child.poll() is not None:
            raise ProtocolError('runtime_not_running')
        request = {'id': secrets.token_hex(12), 'command': command, 'params': params}
        self.child.stdin.write(json.dumps(request, allow_nan=False) + '\n')
        self.child.stdin.flush()
        if not select.select([self.child.stdout], [], [], timeout)[0]:
            raise ProtocolError('runtime_timeout')
        line = self.child.stdout.readline(MAX_LINE + 1)
        if not line or len(line) > MAX_LINE:
            raise ProtocolError('runtime_protocol_invalid')
        try:
            response = json.loads(line)
            strict_object(response, ('id', 'ok', 'data'))
            if response['id'] != request['id'] or type(response['ok']) is not bool or not isinstance(response['data'], dict):
                raise ValueError()
        except (ValueError, ProtocolError):
            raise ProtocolError('runtime_protocol_invalid') from None
        if not response['ok']:
            code = response['data'].get('error_code')
            raise ProtocolError(code if isinstance(code, str) and re.fullmatch('[a-z_]{1,80}', code) else 'runtime_failed')
        return response['data']

    def launch(self):
        if source_identity()[0] != self.source_sha or factory_identity()[0] != self.fixture_sha:
            raise ProtocolError('source_changed')
        actual = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, stderr=subprocess.DEVNULL).decode().strip()
        if actual != self.revision:
            raise ProtocolError('source_revision_mismatch')
        refuse_listeners(self.config['port_base'])
        self.child = subprocess.Popen([self.node, str(RUNTIME)], cwd=ROOT,
            env={'PATH': str(Path(self.node).parent), 'LANG': 'C.UTF-8', 'TZ': 'UTC'},
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1)
        self.generation += 1
        result = self.exchange('start', {**self.config, 'process_generation': self.generation,
            **({'private_native': self.private_runtime} if self.private_runtime else {})})
        self.private_runtime = result.pop('_private_runtime', None)
        if not isinstance(self.private_runtime, dict):
            raise ProtocolError('runtime_protocol_invalid')
        validate_schema('diagnostic', result)
        return result

    def start(self, params):
        if self.state:
            raise ProtocolError('already_started')
        start_params(params)
        if not APPLICATION.is_file():
            raise ProtocolError('application_factory_unavailable')
        current_sha, _ = source_identity()
        if current_sha != self.source_sha or params['source_sha256'] != self.source_sha or params['source_revision'] != self.revision:
            raise ProtocolError('source_changed')
        refuse_listeners(params['port_base'])
        path = Path(params['state_root']).resolve()
        path.mkdir(mode=0o700)
        self.state = path
        self.state_identity = (path.stat().st_dev, path.stat().st_ino)
        self.config = {**params, 'state_root': str(path)}
        try:
            result = self.launch()
            return result
        except BaseException:
            self.stop({})
            raise

    def stop_process(self):
        child, self.child = self.child, None
        if not child:
            return
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=5)
        for pipe in (child.stdin, child.stdout):
            if pipe:
                pipe.close()

    def stop(self, params):
        strict_object(params)
        self.stop_process()
        removed = self.state is None
        if self.state and (self.state.exists() or self.state.is_symlink()):
            actual = self.state.lstat()
            if self.state.is_symlink() or (actual.st_dev, actual.st_ino) != self.state_identity:
                raise ProtocolError('owned_state_identity_changed')
            shutil.rmtree(self.state)
            removed = not self.state.exists()
        elif self.state:
            removed = True
        self.state = self.config = self.state_identity = self.private_runtime = None
        self.generation = 0
        return {'owned_process_stopped': True, 'owned_state_removed': removed}

    def dispatch(self, command, params):
        if command == 'start':
            return self.start(params)
        if command == 'stop':
            return self.stop(params)
        if command == 'restart':
            strict_object(params)
            if not self.config:
                raise ProtocolError('runtime_not_running')
            self.stop_process()
            try:
                result = self.launch()
                result.pop('browser_context', None)
                return result
            except BaseException:
                self.stop_process()
                raise
        if command == 'diagnostics':
            strict_object(params)
        elif command == 'checkpoint':
            strict_object(params, (), ('scenario',))
            if params and (not isinstance(params['scenario'], str) or not re.fullmatch(r'[a-z_]{1,100}', params['scenario'])):
                raise ProtocolError('invalid_request')
        elif command == 'fault':
            strict_object(params, ('fault',))
            if params['fault'] != 'commit_then_drop_ack_once':
                raise ProtocolError('unsupported_fault')
            # The public runner names a fault, never a provider/URL or payload.
            # Only the owned application's existing HTTP fault boundary is used.
            result = self.exchange('fault', {'target': 'message_provider', 'mode': 'commit_then_drop_ack'})
            try:
                strict_object(result, ('fault', 'armed', 'boundary'))
                if result['fault'] != params['fault'] or result['armed'] is not True \
                        or not isinstance(result['boundary'], str) \
                        or result['boundary'] not in {'owned_provider_http', 'native_adapter_http'}:
                    raise ProtocolError('runtime_protocol_invalid')
            except ProtocolError:
                raise ProtocolError('runtime_protocol_invalid') from None
            return result
        else:
            raise ProtocolError('invalid_request')
        result = self.exchange(command, params)
        if command in {'diagnostics', 'checkpoint'}:
            validate_schema('diagnostic', result)
            if any(key in result for key in ('browser_context', 'private', '_private_runtime')):
                raise ProtocolError('runtime_protocol_invalid')
        return result


def publish_manifest(args):
    if not re.fullmatch('[0-9a-f]{40}', args.source_revision or ''):
        raise ProtocolError('source_revision_required')
    actual = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, stderr=subprocess.DEVNULL).decode().strip()
    if actual != args.source_revision:
        raise ProtocolError('source_revision_mismatch')
    python, node = executable(args.python, 'python'), executable(args.node, 'node')
    target = Path(args.output)
    if not target.is_absolute() or target.exists() or ROOT in target.parents:
        raise ProtocolError('new_absolute_output_required')
    source_sha, inputs = source_identity()
    fixture_sha, identities = factory_identity()
    source_path = str(Path(__file__).resolve())
    source_file_sha = digest(Path(__file__).read_bytes())
    # An immutable, source-owned public initializer keeps external args exactly
    # [--stdio]. It imports one fixed hash-pinned controller, never caller code.
    bootstrap = ("#!/usr/bin/env python3\nimport argparse,hashlib,importlib.util,sys\nfrom pathlib import Path\n"
        "sys.dont_write_bytecode=True\n"
        "if sys.argv[1:] != ['--stdio']: raise SystemExit('Use the private stdio protocol')\n"
        f"source=Path({source_path!r})\n"
        f"if hashlib.sha256(source.read_bytes()).hexdigest() != {source_file_sha!r}: raise SystemExit('Factory source changed')\n"
        "spec=importlib.util.spec_from_file_location('wa_owned_factory',source)\n"
        "module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)\n"
        f"module.serve(argparse.Namespace(node={node!r},source_revision={args.source_revision!r},source_sha256={source_sha!r},fixture_sha256={fixture_sha!r}))\n").encode()
    bootstrap_path = target.parent / f'wa-owner-entry-{digest(bootstrap)}.py'
    # These are real human navigation entrypoints, not readiness, permissions or
    # acceptance. The shared workspace opens only currently authorized forms.
    workspace = '/portal/integrations?workspace=shared'
    journey_routes = {
        'ordinary_owner_login': (['/login'], []),
        'native_pkce_accounts': ([workspace, '/portal/whatsapp-connect', '/portal/fb-pages'], []),
        'named_activity_permissions': ([workspace + '&action=capability-grants.manage'], []),
        'capability_availability': ([workspace], ['products.read', 'products.write', 'messaging.send', 'messaging.review',
            'campaigns.execute', 'campaigns.review', 'content.publish', 'content.review', 'media.manage',
            'customers.manage', 'measurement.read', 'measurement.export', 'owner.operations']),
        'named_source_and_read_setup': ([workspace], ['products.read']),
        'shared_search_detail_provenance': ([workspace], ['products.read']),
        'authoritative_product_create_change': ([workspace + '&action=product.create', workspace + '&action=product.change'], ['products.write']),
        'unknown_outcome_reconciliation': ([workspace], ['owner.operations']),
        'deficit_and_reconciliation': ([workspace], ['inventory.read']),
        'inventory_sales_transfers_counts': ([workspace], ['inventory.read', 'inventory.facts', 'inventory.transfer', 'inventory.count']),
        'orders_request_fulfil_cancel': ([workspace], ['orders.request', 'orders.fulfil']),
        'permission_and_read_withdrawal': ([workspace], ['products.read']),
        'persisted_reload_resume': ([workspace], ['owner.operations']),
        'units_variants_owner_context': ([workspace], ['products.read']),
        'price_lists_owner_context': ([workspace], ['products.read']),
        'media_owner_context': ([workspace + '&action=media.manage'], ['media.manage']),
        'customers_purpose_consent': ([workspace + '&action=customers.manage'], ['customers.manage']),
        'messaging_review_send_result': ([workspace + '&action=messaging.send', workspace + '&action=messaging.review',
            '/portal/whatsapp-connect', '/portal/fb-pages', '/portal/integrations/sms'], ['messaging.send', 'messaging.review']),
        'campaign_review_execute_result': ([workspace + '&action=campaigns.execute', workspace + '&action=campaigns.review'],
            ['campaigns.execute', 'campaigns.review']),
        'content_review_publish_result': ([workspace + '&action=content.publish', workspace + '&action=content.review',
            '/portal/fb-pages', '/portal/fb-content'], ['content.publish', 'content.review']),
        'measurement_scoped_read_export': ([workspace + '&action=measurement.read', workspace + '&action=measurement.export'],
            ['measurement.read', 'measurement.export']),
        'owner_operations_result_fetch': ([workspace + '&action=owner.operations'], ['owner.operations']),
    }
    manifest = {'format': 'savana-owner-journey-factory/1', 'generation': GENERATION, 'platform': 'wa_savana',
        'source_revision': args.source_revision, 'source_sha256': source_sha,
        'source_identity': {'runtime_inputs': len(inputs), 'includes_current_working_changes': True, 'factory_files': identities},
        'entrypoint': {'interpreter': python, 'script': str(bootstrap_path), 'sha256': digest(bootstrap), 'args': ['--stdio']},
        'factory_owns_state': True, 'loads_real_env_or_shared_database': False,
        'services': {'wa_savana': {'port_offset': 5}, 'wa_frontend': {'port_offset': 6}},
        'owner_journeys': {scenario: {'owner_entrypoints': [{'service': 'wa_frontend', 'path': path} for path in paths],
            'capability_codes': codes} for scenario, (paths, codes) in journey_routes.items()},
        'owner_journey_declarations': {
            'meaning': 'Current source-owned navigation only. No entry grants rights or proves a completed journey; actual current account, subscription, scope, fields, resources, purpose, consent and reviewed result remain required.',
            'unit_and_price_scope': 'WA displays actual granted source product unit/price context. Unit/variant or price-list mutations remain at the actual authoritative source, not a WA native implementation.',
            'media_scope': 'The media form manages native WhatsApp assets. Catalog-owned product media uses the current operator-validated source owner_action_url, actual source-owned form and Core peer preview, with WA command/results consumption. This declaration does not certify a Catalog-owned media journey or substitute native assets for Catalog asset/rights authority.',
            'customer_scope': 'The customer form manages native scoped CRM contacts. Catalog-owned customer actions use the current operator-validated source owner_action_url, actual source-owned purpose/consent form and Core peer preview, with WA command/results consumption. Native CRM does not substitute for Catalog authority; joint acceptance is unproved here.',
            'inventory_and_order_scope': 'These three journeys start in the real shared workspace and its current named activity/source capability cards. Authoritative Catalog forms open only through the current operator-validated source owner_action_url; no static Catalog URL is declared. WA is the requester/consumer and reads current Core command status and actual source JSON/CSV results. Catalog owns stock facts, warehouses, transfers, counts, order fulfilment and cancellation; WA declares no native stock/order handler or inventory ledger.',
            'linked_source_capability_tags': 'Inventory/order capability_codes describe the actual linked source operation navigation and scoped WA consumption, not WA native handler registration or every-provider support. Required native capability_proofs are supplied by the actual authoritative source in the global proof union; a card or this declaration proves no native effect.',
            'deficit_reconciliation_evidence': 'WA may observe an actual Catalog deficit and navigate to its current authorized source reconciliation form. requested_catalog_reconciliations requires a separately correlated actual owner request at that source; generic result reads or opening a source link do not prove initiation. Generic Core result JSON/CSV also does not establish the source-native Catalog deficit body or a checked absence of WA inventory ledgers. Unmeasured deficit, initiation and inventory-invariant facts remain pending for actual observer proof or explicit Parent criterion correction; no counter is invented.',
            'other_platform_operations': 'No WA native domain, stock, order, capacity or payment form is declared. Stock/order requester-consumer navigation is declared separately above; authoritative platform forms and effects still require their own real source entrypoints and evidence.',
            'required_evidence': 'Same-run browser observations plus actual per-operation capability_proofs and correlated native results; declarations, descriptors and queue acceptance are insufficient.',
        },
        **PEER_METADATA,
        'browser_binding_return': {'service': 'wa_frontend', 'path': '/portal/integrations',
                                   'query_keys': ['savana_binding', 'state'], 'separate_from_connect_server_callback': True},
        'application_factory': {'module': str(APPLICATION), 'export': 'createOwnerJourneyApplication', 'present': APPLICATION.is_file()},
        'acceptance_performed': False}
    validate_schema('manifest', manifest)
    if bootstrap_path.exists():
        if bootstrap_path.is_symlink() or bootstrap_path.read_bytes() != bootstrap:
            raise ProtocolError('initializer_changed')
    else:
        with bootstrap_path.open('xb') as stream:
            stream.write(bootstrap)
    with target.open('xb') as stream:
        stream.write(canonical(manifest))
    return manifest


def serve(args):
    if not re.fullmatch('[0-9a-f]{40}', args.source_revision or '') or not re.fullmatch('[0-9a-f]{64}', args.source_sha256 or '') \
            or not re.fullmatch('[0-9a-f]{64}', args.fixture_sha256 or ''):
        raise ProtocolError('source_identity_required')
    factory = Factory(args.node, args.source_revision, args.source_sha256, args.fixture_sha256)
    try:
        while True:
            line = sys.stdin.readline(MAX_LINE + 2)
            if not line:
                break
            request_id = None
            try:
                request = parse_request(line)
                request_id = request['id']
                data = factory.dispatch(request['command'], request['params'])
                response = {'id': request_id, 'ok': True, 'data': data}
            except ProtocolError as error:
                response = {'id': request_id, 'ok': False, 'data': {'error_code': error.code}}
            except Exception:
                response = {'id': request_id, 'ok': False, 'data': {'error_code': 'factory_failed'}}
            print(json.dumps(response, allow_nan=False), flush=True)
            if response['ok'] and request['command'] == 'stop':
                break
            if len(line) > MAX_LINE:
                break
    finally:
        factory.stop({})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', nargs='?', choices=['manifest'])
    parser.add_argument('--stdio', action='store_true')
    parser.add_argument('--source-revision')
    parser.add_argument('--source-sha256')
    parser.add_argument('--fixture-sha256')
    parser.add_argument('--python')
    parser.add_argument('--node', required=True)
    parser.add_argument('--output')
    args = parser.parse_args()
    try:
        if args.stdio and not args.action:
            serve(args)
        elif args.action == 'manifest' and not args.stdio and args.python and args.output:
            publish_manifest(args)
        else:
            raise ProtocolError('invalid_cli')
    except ProtocolError as error:
        print(json.dumps({'ok': False, 'data': {'error_code': error.code}}), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
