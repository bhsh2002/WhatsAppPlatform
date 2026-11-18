import importlib.util
import json
import os
from pathlib import Path
import subprocess
import unittest
from unittest import mock

from tools.tests import test_package_wa_production_candidate as fixture_tests

SPEC = importlib.util.spec_from_file_location('controlled_release', Path(__file__).resolve().parents[1] / 'wa_controlled_release.py')
release = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(release)


class ControlledReleaseTests(unittest.TestCase):
    def fixture(self):
        f = fixture_tests.ProductionCandidateTests(); f.setUp(); self.addCleanup(f.doCleanups)
        f.write('.gitignore', 'server/ignored.env\nserver/ignored.db\nserver/node_modules/ignored.js\nclient/dist/ignored.js\n')
        f.git('add', '--all'); f.git('-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '-q', '-m', 'synthetic committed runtime')
        tree = release.candidate.tree(f.repo)
        names = sorted(name for name in tree if release.candidate.runtime_input(name))
        blobs = release.candidate.baseline_blobs(f.repo, tree, names)
        entries = [{'path': name, 'mode': '0755' if tree[name]['mode'] == '100755' else '0644', 'sha256': release.candidate.sha(blobs[name])} for name in names]
        marker = release.public_identity(entries)
        f.write(release.PIN, marker + '\n'); f.git('add', '--', release.PIN)
        f.git('-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '-q', '-m', 'reviewed marker metadata')
        revision = f.git('rev-parse', 'HEAD').decode().strip()
        return f, marker, revision

    def exported(self):
        f, marker, revision = self.fixture()
        directory = f.root / 'controlled'
        manifest = release.export(f.repo, revision, directory)
        return f, marker, revision, directory, manifest

    def build(self, f, marker, revision, directory, *, publish=False, wrong_label=None):
        commands = []
        def run(command, check):
            commands.append(command)
            part = 'client' if command[-1].endswith('/client') else 'server'
            metadata = Path(command[command.index('--metadata-file') + 1])
            metadata.write_text(json.dumps({'containerimage.digest': 'sha256:' + ('a' if part == 'server' else 'b') * 64}))
            return subprocess.CompletedProcess(command, 0)
        def labels(command):
            commands.append(command)
            values = {'org.opencontainers.image.revision': revision, 'savana.candidate.source-sha256': marker}
            if wrong_label:
                target, key = wrong_label
                if any('savana-wa-' + target in part for part in command): values[key] = 'c' * (40 if key.endswith('revision') else 64)
            return json.dumps(values).encode()
        trusted_manifest = release.candidate.sha((directory / 'context-manifest.json').read_bytes())
        with mock.patch.object(release.subprocess, 'run', side_effect=run), mock.patch.object(release.subprocess, 'check_output', side_effect=labels):
            evidence = release.build(directory, revision, f.root / 'evidence', marker, trusted_manifest, publish)
        return commands, evidence

    def test_committed_export_matches_reviewed_runtime_identity_and_never_changes_index(self):
        f, marker, revision = self.fixture(); before = f.git('status', '--porcelain=v1'); index_before = (f.repo / '.git/index').read_bytes()
        f.write('server/ignored.env', 'synthetic-secret-must-not-copy')
        f.write('server/ignored.db', 'synthetic-db-must-not-copy')
        f.write('server/node_modules/ignored.js', 'synthetic-module-must-not-copy')
        f.write('client/dist/ignored.js', 'synthetic-dist-must-not-copy')
        directory = f.root / 'controlled'; manifest = release.export(f.repo, revision, directory)
        self.assertEqual(manifest['source_sha256'], marker); self.assertEqual(manifest['git_revision'], revision)
        self.assertEqual((f.repo / '.git/index').read_bytes(), index_before)
        self.assertEqual(f.git('status', '--porcelain=v1'), before)
        self.assertTrue((directory / 'contexts/client/src/pages/Logs/Logs.jsx').is_file())
        self.assertTrue((directory / 'contexts/client/public/brand.png').is_file())
        self.assertFalse(any(path.name.endswith(('.env', '.db', '.test.js')) or 'node_modules' in path.parts or 'dist' in path.parts for path in directory.rglob('*')))
        self.assertFalse(manifest['official_contracts_required_at_build_time'])

    def test_dirty_staged_mode_deleted_and_untracked_checkouts_are_refused(self):
        for change in ('dirty', 'staged', 'mode', 'delete', 'untracked'):
            with self.subTest(change=change):
                f, marker, revision = self.fixture(); path = f.repo / 'server/server.js'
                if change in ('dirty', 'staged'): path.write_text('changed runtime')
                if change == 'staged': f.git('add', '--', 'server/server.js')
                if change == 'mode': path.chmod(0o755)
                if change == 'delete': path.unlink()
                if change == 'untracked': f.write('server/runtime/extra.js', 'export const extra = true;')
                with self.assertRaisesRegex(ValueError, 'clean committed'): release.export(f.repo, revision, f.root / 'refused')

    def test_verified_revision_mismatch_is_refused(self):
        f, _, _ = self.fixture()
        with self.assertRaisesRegex(ValueError, 'revision differs'): release.export(f.repo, '0' * 40, f.root / 'refused')

    def test_docs_and_ci_only_commit_changes_revision_without_changing_marker(self):
        f, marker, revision = self.fixture()
        first = release.export(f.repo, revision, f.root / 'first')
        f.write('.github/workflows/ci.yml', 'synthetic CI metadata\n'); f.write('docs/WA_PRODUCTION_CANDIDATE.md', 'changed review metadata\n')
        f.git('add', '--all'); f.git('-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '-q', '-m', 'metadata only')
        new_revision = f.git('rev-parse', 'HEAD').decode().strip()
        second = release.export(f.repo, new_revision, f.root / 'second')
        self.assertNotEqual(revision, new_revision); self.assertEqual(first['source_sha256'], second['source_sha256'])
        self.assertEqual(second['source_sha256'], marker)

    def test_unreviewed_committed_runtime_drift_is_refused_by_pin(self):
        f, _, _ = self.fixture(); f.write('server/server.js', 'changed runtime\n'); f.git('add', '--all')
        f.git('-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '-q', '-m', 'runtime drift without review')
        revision = f.git('rev-parse', 'HEAD').decode().strip()
        with self.assertRaisesRegex(ValueError, 'reviewed public marker'): release.export(f.repo, revision, f.root / 'refused')

    def test_missing_or_tampered_context_and_recipe_fail_before_build_hook(self):
        for kind in ('context', 'recipe', 'missing'):
            with self.subTest(kind=kind):
                f, marker, revision, directory, _ = self.exported()
                target = directory / ('recipes/client.Dockerfile' if kind == 'recipe' else 'contexts/client/src/app.jsx')
                if kind == 'missing': target.unlink()
                else: target.write_text('tampered bytes')
                with mock.patch.object(release.subprocess, 'run') as run, self.assertRaises(ValueError):
                    release.build(directory, revision, f.root / 'evidence', marker, 'a' * 64)
                run.assert_not_called()

    def test_release_build_hooks_use_only_exported_recipes_contexts_and_public_marker(self):
        f, marker, revision, directory, manifest = self.exported()
        commands, evidence = self.build(f, marker, revision, directory, publish=True)
        builds = [cmd for cmd in commands if cmd[:3] == ['docker', 'buildx', 'build']]
        self.assertEqual(len(builds), 2)
        for cmd, part in zip(builds, ('server', 'client')):
            self.assertEqual(cmd[-1], str(directory / f'contexts/{part}'))
            self.assertEqual(cmd[cmd.index('--file') + 1], str(directory / f'recipes/{part}.Dockerfile'))
            for flag in ('--push', '--sbom=true', '--provenance=mode=max'): self.assertIn(flag, cmd)
            self.assertIn('org.opencontainers.image.revision=' + revision, cmd)
            self.assertIn('savana.candidate.source-sha256=' + marker, cmd)
            self.assertEqual([cmd[index + 1] for index, flag in enumerate(cmd) if flag == '--resource'],
                             ['memory=2g', 'memory-swap=2g', 'cpu-period=100000', 'cpu-quota=200000'])
            self.assertEqual(cmd[cmd.index('--metadata-file') + 1], str(f.root / f'evidence/{part}-buildx.json'))
            self.assertNotIn('--no-cache', cmd)
        self.assertIn('VITE_WA_CLIENT_RELEASE=' + marker, builds[1])
        self.assertEqual(evidence['runtime_setting_assignment'], 'WA_BROWSER_RELEASE=' + marker)
        self.assertEqual(evidence['git_revision'], revision); self.assertEqual(evidence['recipes'], manifest['recipes'])
        self.assertTrue(all('@sha256:' in row['immutable_reference'] for row in evidence['images']))

    def test_local_ci_build_loads_images_and_checks_both_labels(self):
        f, marker, revision, directory, _ = self.exported()
        commands, evidence = self.build(f, marker, revision, directory)
        self.assertEqual(sum(cmd[:3] == ['docker', 'image', 'inspect'] for cmd in commands), 2)
        self.assertTrue(all('--load' in cmd and '--push' not in cmd for cmd in commands if cmd[:3] == ['docker', 'buildx', 'build']))
        self.assertFalse(evidence['published'])
        for cmd in commands:
            if cmd[:3] == ['docker', 'buildx', 'build']:
                self.assertEqual([cmd[index + 1] for index, flag in enumerate(cmd) if flag == '--resource'], list(release.RUN_RESOURCES))

    def builder_fixture(self):
        builder = 'wa-savana-ci-123-1'
        container = 'buildx_buildkit_' + builder + '0'
        state = {'Id': 'a' * 64, 'Name': '/' + container, 'Config': {'Image': 'moby/buildkit:v0.34.2'},
                 'State': {'Running': True}, 'HostConfig': {'Memory': 2147483648, 'MemorySwap': 2147483648,
                    'CpuPeriod': 100000, 'CpuQuota': 200000, 'PidsLimit': 0}}
        nodes = json.dumps([{'name': builder + '0'}])
        def output(command):
            if command[:2] == ['docker', 'inspect']: return json.dumps(state).encode()
            if command == ['docker', 'buildx', 'version']: return b'github.com/docker/buildx v0.38.2 actual-release-commit\n'
            if command == ['docker', 'exec', container, 'buildkitd', '--version']: return b'buildkitd github.com/moby/buildkit v0.34.2 actual-release-commit\n'
            self.fail(f'Unexpected command: {command}')
        return builder, container, state, nodes, output

    def test_owned_pinned_builder_gets_real_docker_pid_limit_then_exact_same_container_is_verified(self):
        builder, container, state, nodes, output = self.builder_fixture()
        def update(command, check):
            self.assertEqual(command, ['docker', 'update', '--pids-limit=256', container]); self.assertIs(check, True)
            state['HostConfig']['PidsLimit'] = 256
        with mock.patch.object(release.subprocess, 'check_output', side_effect=output), mock.patch.object(release.subprocess, 'run', side_effect=update) as mutation:
            evidence = release.verify_builder(builder, nodes)
        mutation.assert_called_once()
        self.assertEqual(evidence['buildx'], 'v0.38.2'); self.assertEqual(evidence['buildkit'], 'v0.34.2')
        self.assertEqual(evidence['outer_pids_limit'], 256)
        self.assertEqual(evidence['run_resources'], list(release.RUN_RESOURCES))

    def test_unowned_node_container_or_unbounded_daemon_is_rejected_before_any_update(self):
        for change in ('builder', 'node', 'many_nodes', 'image', 'container', 'memory', 'swap', 'cpu', 'stopped'):
            with self.subTest(change=change):
                builder, _, state, nodes, output = self.builder_fixture()
                if change == 'builder': builder = 'other-unowned-builder'
                if change == 'node': nodes = json.dumps([{'name': 'foreign-node'}])
                if change == 'many_nodes': nodes = json.dumps([{'name': builder + '0'}, {'name': builder + '1'}])
                if change == 'image': state['Config']['Image'] = 'moby/buildkit:latest'
                if change == 'container': state['Name'] = '/different-container'
                if change == 'memory': state['HostConfig']['Memory'] = 0
                if change == 'swap': state['HostConfig']['MemorySwap'] = -1
                if change == 'cpu': state['HostConfig']['CpuQuota'] = 0
                if change == 'stopped': state['State']['Running'] = False
                with mock.patch.object(release.subprocess, 'check_output', side_effect=output), mock.patch.object(release.subprocess, 'run') as mutation:
                    with self.assertRaises(ValueError): release.verify_builder(builder, nodes)
                mutation.assert_not_called()

    def test_wrong_tool_versions_or_unapplied_limits_fail_closed(self):
        for change in ('buildx', 'buildkit', 'update_failed', 'pids_not_applied', 'replaced_container'):
            with self.subTest(change=change):
                builder, _, state, nodes, output = self.builder_fixture()
                def versions(command):
                    result = output(command)
                    if change == 'buildx' and command == ['docker', 'buildx', 'version']: return result.replace(b'v0.38.2', b'v0.37.0')
                    if change == 'buildkit' and command[1] == 'exec': return result.replace(b'v0.34.2', b'v0.33.0')
                    return result
                def update(command, check):
                    if change == 'update_failed': raise subprocess.CalledProcessError(1, command)
                    if change == 'replaced_container': state['Id'] = 'b' * 64; state['HostConfig']['PidsLimit'] = 256
                with mock.patch.object(release.subprocess, 'check_output', side_effect=versions), mock.patch.object(release.subprocess, 'run', side_effect=update) as mutation:
                    with self.assertRaises((ValueError, subprocess.CalledProcessError)): release.verify_builder(builder, nodes)
                if change in ('buildx', 'buildkit'): mutation.assert_not_called()

    def test_both_image_revision_and_source_marker_mismatches_block_release_evidence(self):
        for part in ('server', 'client'):
            for key in ('org.opencontainers.image.revision', 'savana.candidate.source-sha256'):
                with self.subTest(component=part, key=key):
                    f, marker, revision, directory, _ = self.exported()
                    with self.assertRaisesRegex(ValueError, 'revision/public marker'): self.build(f, marker, revision, directory, publish=True, wrong_label=(part, key))
                    self.assertFalse((f.root / 'evidence/release-evidence.json').exists())

    def test_concurrent_recipe_and_manifest_rewrite_between_builds_is_refused(self):
        f, marker, revision, directory, _ = self.exported()
        trusted = release.candidate.sha((directory / 'context-manifest.json').read_bytes()); commands = []
        def mutate_after_server(command, check):
            commands.append(command)
            Path(command[command.index('--metadata-file') + 1]).write_text(json.dumps({'containerimage.digest': 'sha256:' + 'a' * 64}))
            recipe = directory / 'recipes/client.Dockerfile'; recipe.write_text('self-consistent changed recipe')
            path = directory / 'context-manifest.json'; data = json.loads(path.read_text())
            next(row for row in data['recipes'] if row['component'] == 'client')['sha256'] = release.candidate.sha(recipe.read_bytes())
            path.write_bytes(release.candidate.canonical(data))
            return subprocess.CompletedProcess(command, 0)
        labels = json.dumps({'org.opencontainers.image.revision': revision, 'savana.candidate.source-sha256': marker}).encode()
        with mock.patch.object(release.subprocess, 'run', side_effect=mutate_after_server), mock.patch.object(release.subprocess, 'check_output', return_value=labels):
            with self.assertRaisesRegex(ValueError, 'trusted export result'):
                release.build(directory, revision, f.root / 'evidence', marker, trusted, True)
        self.assertEqual(len(commands), 1)
        self.assertFalse((f.root / 'evidence/release-evidence.json').exists())

    def test_workflows_preserve_security_gates_and_use_controlled_export_before_auth(self):
        root = Path(__file__).resolve().parents[2]
        ci = (root / '.github/workflows/ci.yml').read_text()
        workflow = (root / '.github/workflows/release-images.yml').read_text()
        for gate in ('npm run test:coverage', 'npm audit --audit-level=low', 'npm test', 'npm run lint', 'npm run build',
                     'Verify PWA build artifacts', 'gitleaks git --redact --verbose --no-banner', 'sha256sum --check --strict'):
            self.assertIn(gate, ci)
        for gate in ('preflight_package "$server_package"', 'preflight_package "$client_package"',
                     'verify_private_expected_repository "$server_package"', 'verify_private_expected_repository "$client_package"',
                     'docker manifest inspect "$image"', 'Private GHCR image is anonymously readable', '.visibility == "private"',
                     'github.event.workflow_run.head_sha', "github.event.workflow_run.conclusion == 'success'"):
            self.assertIn(gate, workflow)
        self.assertLess(workflow.index('tools/wa_controlled_release.py export'), workflow.index('docker login ghcr.io'))
        for text in (ci, workflow):
            self.assertIn('tools/wa_controlled_release.py build', text)
            self.assertIn('--expected-manifest-sha256', text)
            self.assertNotIn('docker build --tag', text)
            self.assertNotIn('          docker buildx build', text)
            self.assertIn('docker/setup-buildx-action@e468171a9de216ec08956ac3ada2f0791b6bd435', text)
            self.assertIn('version: v0.38.2', text); self.assertIn('image=moby/buildkit:v0.34.2', text)
            self.assertIn('buildkitd-flags: --oci-worker-gc=true', text)
            self.assertIn('BUILDX_BUILDER: ${{ steps.image-builder.outputs.name }}', text)
            self.assertIn('tools/wa_controlled_release.py verify-builder', text)
            self.assertLess(text.index('tools/wa_controlled_release.py verify-builder'), text.index('tools/wa_controlled_release.py build'))
            self.assertNotIn('pids-limit=', text.split('driver-opts:')[-1].split('\n\n')[0])
            self.assertNotIn('no-process-sandbox', text); self.assertNotIn('rootless', text)
        self.assertIn('options: --memory=1g --memory-swap=1g --pids-limit=256 --cpus=2', ci)
        self.assertIn('node scripts/verify-picomatch-build-guard.cjs\n', ci)
        for path in ('client/Dockerfile', 'ops/release/client.Dockerfile'):
            recipe = (root / path).read_text()
            self.assertIn('node scripts/verify-picomatch-build-guard.cjs \\\n', recipe)
            self.assertNotIn('--mode inspect', recipe)
            self.assertIn('npm run build', recipe)
        self.assertIn('WA_BROWSER_RELEASE=%s', workflow)

    def test_build_trusted_export_marker_and_manifest_cannot_be_substituted(self):
        f, marker, revision, directory, _ = self.exported()
        digest = release.candidate.sha((directory / 'context-manifest.json').read_bytes())
        with mock.patch.object(release.subprocess, 'run') as run:
            with self.assertRaisesRegex(ValueError, 'public marker'): release.build(directory, revision, f.root / 'evidence', 'b' * 64, digest)
            with self.assertRaisesRegex(ValueError, 'context manifest'): release.build(directory, revision, f.root / 'evidence', marker, 'b' * 64)
        run.assert_not_called()


if __name__ == '__main__': unittest.main()
