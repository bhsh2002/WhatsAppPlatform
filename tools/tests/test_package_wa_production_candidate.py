import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / 'package_wa_production_candidate.py'
SPEC = importlib.util.spec_from_file_location('wa_production_packager', SCRIPT)
packager = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(packager)


class ProductionCandidateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='wa-production-packager-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.repo = self.root / 'repository'; self.repo.mkdir()
        self.output = self.root / 'candidate'
        self.git('init', '-q')
        for name in packager.RELEASE_INPUTS:
            self.write(name, 'synthetic release tooling\n')
        for name in packager.CONFIG_EXAMPLES:
            self.write(name, 'JWT_SECRET=synthetic-template-value-must-never-copy\nOPENAI_API_KEY=synthetic-template-value-must-never-copy\nGEMINI_API_KEY=synthetic-template-value-must-never-copy\nSAVANA_SHARED_READ_OIDC_TOKEN_ENDPOINT=https://synthetic.invalid/token\nPUBLIC_APP_URL=https://synthetic.invalid\n')
        server_base = 'node:22.23.5-bookworm@sha256:' + 'a' * 64
        client_bases = ['node:22.23.5-alpine3.24@sha256:' + 'b' * 64, 'nginx:alpine@sha256:' + 'c' * 64]
        self.write('server/Dockerfile', f'FROM {server_base}\nRUN npm ci --omit=dev\n')
        self.write('client/Dockerfile', '\n'.join(f'FROM {base}' for base in client_bases) + '\n')
        self.write('ops/release/server.Dockerfile', f'FROM {server_base}\nRUN npm_config_build_from_source=true npm_config_nodedir=/usr/local npm ci --omit=dev\n')
        self.write('ops/release/client.Dockerfile', '\n'.join(f'FROM {base}' for base in client_bases) + '\nARG VITE_WA_CLIENT_RELEASE\n')
        for component in ('server', 'client'):
            package = {'name': component, 'version': '1.0.0', 'dependencies': {}}
            self.write(f'{component}/package.json', json.dumps(package))
            self.write(f'{component}/package-lock.json', json.dumps({'lockfileVersion': 3, 'packages': {'': package}}))
        for name in ('server/server.js', 'server/start.js', 'client/index.html', 'client/nginx.conf', 'client/vite.config.js', 'client/src/app.jsx'):
            self.write(name, 'synthetic clean baseline input\n')
        self.write('client/src/app.jsx', "import './pages/Logs/Logs.jsx';\n")
        self.write('client/src/pages/Logs/Logs.jsx', 'export default function Logs() {}\n')
        self.write('client/public/brand.png', b'\x89PNG\r\n\x1a\nsynthetic-public-asset')
        for number in range(55, 61):
            self.write(f'server/db/migrations/{number:03d}_synthetic.sql', f'-- synthetic migration {number}\n')
        for name in ('server/.env', 'server/state.db', 'server/test-support/harness.js', 'server/test/unit.js',
                     'server/node_modules/dependency.js', 'client/dist/bundle.js', 'client/src/app.test.js'):
            self.write(name, 'DO NOT COPY RUNTIME/GENERATED/TEST CONTENT\n')
        self.git('add', '--all')
        self.git('-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '-q', '-m', 'synthetic baseline')
        self.write('server/server.js', 'synthetic reviewed modified entrypoint\n')
        self.write('server/runtime/guard.js', 'export const syntheticGuard = true;\n')
        self.write('unrelated.txt', 'unrelated content remains untouched\n')
        self.overlay = ['server/server.js', 'server/runtime/guard.js']
        self.refs = []
        for index in range(5):
            path = self.root / f'official-{index}.openapi.json'
            path.write_text(json.dumps({'openapi': '3.1.0', 'info': {'title': 'Synthetic', 'version': '1.0'},
                                        'paths': {}, 'x-contract-lifecycle': 'synthetic_not_deployed'}))
            self.refs.append({'id': f'official-{index}', 'version': '1.0', 'path': str(path), 'expected_sha256': packager.sha(path.read_bytes())})

    def write(self, name, content):
        path = self.repo / name; path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content if isinstance(content, bytes) else content.encode())

    def git(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.repo, stderr=subprocess.PIPE)

    def test_complete_controlled_context_is_deterministic_and_never_copies_workspace_state(self):
        before = self.git('status', '--porcelain=v1', '--untracked-files=all')
        first = packager.package(self.repo, self.overlay, self.refs, self.output)
        second = packager.package(self.repo, list(reversed(self.overlay)), self.refs, self.output)
        self.assertEqual(first, second)
        self.assertEqual(self.git('status', '--porcelain=v1', '--untracked-files=all'), before)
        with tarfile.open(self.output / first['archive'], 'r:gz') as tar:
            names = tar.getnames(); manifest = json.load(tar.extractfile('candidate-manifest.json'))
            self.assertIn('source/client/public/brand.png', names)
            self.assertIn('source/client/src/pages/Logs/Logs.jsx', names)
            self.assertIn('source/server/package-lock.json', names)
            self.assertIn('source/server/runtime/guard.js', names)
            self.assertEqual(tar.extractfile('source/server/server.js').read(), (self.repo / 'server/server.js').read_bytes())
            self.assertTrue(all('node_modules' not in name and 'test-support' not in name and '/dist/' not in name for name in names))
            self.assertTrue(all(not name.endswith(('.env', '.db', '.test.js')) for name in names))
            self.assertEqual(manifest['excluded_dirty_paths'], ['unrelated.txt'])
            config = tar.extractfile('release/configuration-names.json').read()
            self.assertIn(b'JWT_SECRET', config); self.assertNotIn(b'synthetic-template-value', config)
            config_names = json.loads(config)
            self.assertIn('OPENAI_API_KEY', config_names['secret_names']); self.assertIn('GEMINI_API_KEY', config_names['secret_names'])
            self.assertIn('SAVANA_SHARED_READ_OIDC_TOKEN_ENDPOINT', config_names['nonsecret_setting_names'])
            self.assertTrue(manifest['baseline_is_not_modified_release'])
            self.assertEqual(manifest['target_platform'], 'linux/amd64')
            self.assertEqual(len(manifest['new_migrations_sha256']), 6)
            self.assertIsNone(manifest['release_git_commit'])
            for ref in manifest['official_contracts']:
                self.assertEqual(tar.extractfile(ref['snapshot_member']).read(), Path(ref['path']).read_bytes())

    def test_missing_relative_runtime_module_is_not_hidden_by_context_filter(self):
        self.write('client/src/app.jsx', "import './pages/Logs/Missing.jsx';\n")
        with self.assertRaisesRegex(ValueError, 'relative runtime import'):
            packager.package(self.repo, self.overlay + ['client/src/app.jsx'], self.refs, self.output)

    def test_missing_reviewed_runtime_overlay_and_deleted_entrypoint_fail_closed(self):
        with self.assertRaises(ValueError):
            packager.package(self.repo, ['server/server.js'], self.refs, self.output)
        (self.repo / 'server/server.js').unlink()
        with self.assertRaises(ValueError):
            packager.package(self.repo, self.overlay, self.refs, self.output)

    def test_unsafe_paths_and_symlink_runtime_overlay_cannot_enter_candidate(self):
        for name in ('.', '../escape', '/absolute', 'server\\runtime\\bad.js', 'server/../escape.js'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                packager.safe_path(name)
        (self.repo / 'server/runtime/guard.js').unlink()
        outside = self.root / 'outside.js'; outside.write_text('not an input')
        (self.repo / 'server/runtime/guard.js').symlink_to(outside)
        with self.assertRaises(ValueError):
            packager.package(self.repo, self.overlay, self.refs, self.output)

    def test_dependency_lock_mismatch_is_not_hidden_by_existing_dependencies(self):
        package = json.loads((self.repo / 'server/package.json').read_text()); package['dependencies'] = {'unlocked': '^1.0.0'}
        self.write('server/package.json', json.dumps(package))
        with self.assertRaises(ValueError):
            packager.package(self.repo, self.overlay + ['server/package.json'], self.refs, self.output)

    def test_reviewed_build_guard_inputs_are_exact_and_do_not_admit_arbitrary_vendor_content(self):
        for name in packager.CLIENT_BUILD_INPUTS:
            with self.subTest(name=name):
                self.assertTrue(packager.runtime_input(name))
        for name in ('client/vendor/private.env', 'client/vendor/unreviewed.js',
                     'client/vendor/picomatch-build-guard/unreviewed.cjs',
                     'client/vendor/picomatch-build-guard/upstream/.env',
                     'client/scripts/verify-picomatch-build-guard.test.cjs'):
            with self.subTest(name=name):
                self.assertFalse(packager.runtime_input(name))

    def test_only_exact_reviewed_local_alias_with_archive_integrity_is_allowed(self):
        archive = (SCRIPT.parents[1] / packager.BUILD_GUARD_ARCHIVE).read_bytes()
        dependency = 'file:vendor/savana-picomatch-build-guard-4.1.2-p10.tgz'
        package = {'name': 'client', 'devDependencies': {'picomatch': dependency}, 'overrides': {'picomatch': '$picomatch'}}
        row = {'name': '@savana-internal/picomatch-build-guard', 'version': '4.1.2', 'resolved': dependency,
               'integrity': packager.BUILD_GUARD_SRI, 'dev': True}
        lock = {'lockfileVersion': 3, 'packages': {'': package, 'node_modules/picomatch': row}}
        payload = {f'source/{component}/{name}': ((self.repo / component / name).read_bytes(), 0o644)
                   for component in ('server', 'client') for name in ('package.json', 'package-lock.json')}
        payload['source/client/package.json'] = (json.dumps(package).encode(), 0o644)
        payload['source/client/package-lock.json'] = (json.dumps(lock).encode(), 0o644)
        payload['source/' + packager.BUILD_GUARD_ARCHIVE] = (archive, 0o644)
        adopted = packager.locks(payload)['client']['packages'][0]
        self.assertFalse(adopted['official_upstream_patch'])
        self.assertEqual(adopted['embedded_component']['advisory'], 'GHSA-fc5q-39xc-vjpf')
        for invalid in (archive + b'changed', b''):
            with self.subTest(archive_bytes=len(invalid)), self.assertRaisesRegex(ValueError, 'archive/alias integrity'):
                packager.locks({**payload, 'source/' + packager.BUILD_GUARD_ARCHIVE: (invalid, 0o644)})
        for invalid in ({**row, 'resolved': 'file:/private/tmp/guard.tgz'}, {**row, 'integrity': 'sha512-AAAA'}):
            changed = {**lock, 'packages': {**lock['packages'], 'node_modules/picomatch': invalid}}
            with self.subTest(row=invalid), self.assertRaises(ValueError):
                packager.locks({**payload, 'source/client/package-lock.json': (json.dumps(changed).encode(), 0o644)})
        other = {**lock, 'packages': {**lock['packages'], 'node_modules/other': {**row, 'resolved': 'file:other.tgz'}}}
        with self.assertRaisesRegex(ValueError, 'pinned public npm'):
            packager.locks({**payload, 'source/client/package-lock.json': (json.dumps(other).encode(), 0o644)})

    def test_changed_official_contract_and_output_inside_repository_are_refused(self):
        reference = {**self.refs[0], 'expected_sha256': '0' * 64}
        with self.assertRaises(ValueError):
            packager.package(self.repo, self.overlay, [reference] + self.refs[1:], self.output)
        with self.assertRaises(ValueError):
            packager.package(self.repo, self.overlay, self.refs, self.repo / 'candidate')

    def test_existing_immutable_candidate_is_never_overwritten(self):
        result = packager.package(self.repo, self.overlay, self.refs, self.output)
        archive = self.output / result['archive']; archive.chmod(0o644); archive.write_bytes(b'changed externally')
        with self.assertRaises(ValueError):
            packager.package(self.repo, self.overlay, self.refs, self.output)
        self.assertEqual(archive.read_bytes(), b'changed externally')

    def test_public_marker_ignores_commit_overlay_and_release_metadata_for_identical_runtime(self):
        before, _ = packager.capture(self.repo, self.overlay, self.refs)
        self.git('add', '--', *self.overlay)
        self.git('-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '-q', '-m', 'same runtime now committed')
        committed, _ = packager.capture(self.repo, [], self.refs)
        self.assertNotEqual(before['baseline_head'], committed['baseline_head'])
        self.assertEqual(before['source_sha256'], committed['source_sha256'])
        self.write('docs/WA_PRODUCTION_CANDIDATE.md', 'changed review-only instructions\n')
        documented, _ = packager.capture(self.repo, ['docs/WA_PRODUCTION_CANDIDATE.md'], self.refs)
        self.assertEqual(before['source_sha256'], documented['source_sha256'])


if __name__ == '__main__':
    unittest.main()
