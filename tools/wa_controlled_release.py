#!/usr/bin/env python3
"""Export/build exact committed WA contexts; never read sibling contracts or secrets."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess

_spec = importlib.util.spec_from_file_location('wa_candidate', Path(__file__).with_name('package_wa_production_candidate.py'))
candidate = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(candidate)
PIN = 'ops/release/runtime-source.sha256'
RECIPES = {part: f'ops/release/{part}.Dockerfile' for part in ('server', 'client')}
IMAGE_ROOT = 'ghcr.io/bhsh2002'
BUILDX_VERSION = 'v0.38.2'
BUILDKIT_VERSION = 'v0.34.2'
BUILDKIT_IMAGE = 'moby/buildkit:' + BUILDKIT_VERSION
RUN_RESOURCES = ('memory=1g', 'memory-swap=1g', 'cpu-period=100000', 'cpu-quota=200000')


def verify_builder(builder, nodes_json):
    """Bound only the exact owned, pinned builder before any image RUN executes."""
    if not re.fullmatch(r'wa-savana-(?:ci|release)-[0-9]+-[0-9]+', builder):
        raise ValueError('Unexpected controlled builder name')
    nodes = json.loads(nodes_json)
    if not isinstance(nodes, list) or len(nodes) != 1 or not isinstance(nodes[0], dict) or nodes[0].get('name') != builder + '0':
        raise ValueError('Expected the single owned Buildx node')
    container = 'buildx_buildkit_' + nodes[0]['name']
    def inspect():
        value = json.loads(subprocess.check_output(['docker', 'inspect', container, '--format', '{{json .}}']))
        resources = value.get('HostConfig', {})
        if (value.get('Name') != '/' + container or value.get('Config', {}).get('Image') != BUILDKIT_IMAGE
                or value.get('State', {}).get('Running') is not True or not re.fullmatch(r'[0-9a-f]{64}', value.get('Id', ''))
                or any(resources.get(key) != expected for key, expected in (
                    ('Memory', 2_147_483_648), ('MemorySwap', 2_147_483_648), ('CpuPeriod', 100000), ('CpuQuota', 200000)))):
            raise ValueError('Controlled BuildKit identity or outer resource limits differ')
        return value
    before = inspect()
    version = subprocess.check_output(['docker', 'buildx', 'version']).decode().split()
    daemon = subprocess.check_output(['docker', 'exec', container, 'buildkitd', '--version']).decode().split()
    if len(version) < 2 or version[:2] != ['github.com/docker/buildx', BUILDX_VERSION] or len(daemon) != 4 or daemon[2] != BUILDKIT_VERSION:
        raise ValueError('Controlled Buildx/BuildKit version differs')
    # pids-limit is not a supported docker-container driver option. Apply it
    # through Docker only after checking the owned node/container identity.
    subprocess.run(['docker', 'update', '--pids-limit=256', container], check=True)
    after = inspect()
    if after['Id'] != before['Id'] or after['HostConfig'].get('PidsLimit') != 256:
        raise ValueError('Controlled BuildKit PID limit was not applied')
    return {'builder': builder, 'buildx': BUILDX_VERSION, 'buildkit': BUILDKIT_VERSION,
            'outer_memory_bytes': 2_147_483_648, 'outer_pids_limit': 256, 'run_resources': list(RUN_RESOURCES)}


def require_revision(value):
    if not re.fullmatch(r'[0-9a-f]{40}', value):
        raise ValueError('A full verified Git revision is required')


def readonly_git(repository, *args):
    return subprocess.check_output(['git', '--no-pager', '-c', 'core.quotepath=false', *args], cwd=repository,
                                   env={**os.environ, 'GIT_OPTIONAL_LOCKS': '0'}, stderr=subprocess.PIPE)


def clean_revision(repository, revision):
    require_revision(revision)
    if readonly_git(repository, 'rev-parse', 'HEAD').decode().strip() != revision:
        raise ValueError('Checkout revision differs from the verified CI revision')
    if readonly_git(repository, 'status', '--porcelain=v1', '--untracked-files=all'):
        raise ValueError('Export requires a clean committed checkout without an overlay')


def public_identity(files):
    return candidate.sha(candidate.canonical({'files': [{key: row[key] for key in ('path', 'mode', 'sha256')} for row in files]}))


def export(repository, revision, destination):
    repository, destination = Path(repository).resolve(), Path(destination).resolve()
    if repository == destination or repository in destination.parents or destination.exists():
        raise ValueError('Use a new output directory outside the checkout')
    if Path(readonly_git(repository, 'rev-parse', '--show-toplevel').decode().strip()).resolve() != repository:
        raise ValueError('Select the exact repository root')
    clean_revision(repository, revision)
    tracked = candidate.tree(repository)
    names = sorted(name for name in tracked if candidate.runtime_input(name))
    blobs = candidate.baseline_blobs(repository, tracked, names + list(RECIPES.values()) + [PIN])
    files, payload = [], {}
    for name in names:
        mode = 0o755 if tracked[name]['mode'] == '100755' else 0o644
        data = blobs[name]
        files.append({'path': name, 'member': f'contexts/{name}', 'mode': f'{mode:04o}', 'sha256': candidate.sha(data)})
        payload[f'source/{name}'] = (data, mode)
    marker = public_identity(files)
    pin = blobs[PIN].decode().strip()
    if not re.fullmatch(r'[0-9a-f]{64}', pin) or pin != marker:
        raise ValueError('Controlled runtime content differs from the reviewed public marker pin')
    candidate.locks(payload)
    edges = candidate.audit_relative_imports(payload)
    recipes = []
    for part, name in RECIPES.items():
        recipes.append({'component': part, 'path': name, 'member': f'recipes/{part}.Dockerfile',
                        'mode': '0755' if tracked[name]['mode'] == '100755' else '0644', 'sha256': candidate.sha(blobs[name])})
    manifest = {'schema': 1, 'git_revision': revision, 'source_sha256': marker, 'WA_BROWSER_RELEASE': marker,
                'target_platform': 'linux/amd64', 'files': files, 'recipes': recipes,
                'context_sha256': {part: public_identity([row for row in files if row['path'].startswith(part + '/')]) for part in RECIPES},
                'relative_runtime_import_edges_verified': edges, 'official_contracts_required_at_build_time': False}
    clean_revision(repository, revision)
    destination.mkdir(parents=True)
    for row in files + recipes:
        path = destination / row['member']; path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(blobs[row['path']]); path.chmod(int(row['mode'], 8))
    (destination / 'context-manifest.json').write_bytes(candidate.canonical(manifest))
    verify(destination, revision)
    return manifest


def verify(directory, revision):
    require_revision(revision)
    directory = Path(directory).resolve()
    manifest = json.loads((directory / 'context-manifest.json').read_text())
    if manifest.get('schema') != 1 or manifest.get('git_revision') != revision or manifest.get('target_platform') != 'linux/amd64':
        raise ValueError('Context manifest revision/platform mismatch')
    files, recipes = manifest['files'], manifest['recipes']
    if files != sorted(files, key=lambda row: row['path']) or len({row['path'] for row in files}) != len(files):
        raise ValueError('Runtime file identity must be sorted and unique')
    if len(recipes) != 2 or {row['path'] for row in recipes} != set(RECIPES.values()):
        raise ValueError('Both exact reviewed release recipes are required')
    expected = {'context-manifest.json'}
    for row in files + recipes:
        candidate.safe_path(row['path']); candidate.safe_path(row['member'])
        if row in files:
            if not candidate.runtime_input(row['path']) or row['member'] != f"contexts/{row['path']}":
                raise ValueError('Unexpected runtime context input')
        elif row['member'] != f"recipes/{row['component']}.Dockerfile" or RECIPES.get(row['component']) != row['path']:
            raise ValueError('Unexpected recipe linkage')
        expected.add(row['member']); path = directory / row['member']
        if any(parent.is_symlink() for parent in [path, *path.parents] if parent != directory.parent):
            raise ValueError('Context symlink refused')
        if not path.is_file() or candidate.sha(path.read_bytes()) != row['sha256'] or f'{path.stat().st_mode & 0o777:04o}' != row['mode']:
            raise ValueError('Controlled context bytes/modes changed after export')
    actual = {str(path.relative_to(directory)) for path in directory.rglob('*') if path.is_file() or path.is_symlink()}
    if actual != expected:
        raise ValueError('Unexpected or missing controlled context files')
    marker = public_identity(files)
    if not re.fullmatch(r'[0-9a-f]{64}', manifest['source_sha256']) or marker != manifest['source_sha256'] or manifest['WA_BROWSER_RELEASE'] != marker:
        raise ValueError('Public marker drift in controlled context')
    for part in RECIPES:
        if manifest['context_sha256'][part] != public_identity([row for row in files if row['path'].startswith(part + '/')]):
            raise ValueError('Component context hash drift')
    return manifest


def build(directory, revision, evidence_directory, expected_marker, expected_manifest_sha256, publish=False):
    directory, evidence_directory = Path(directory).resolve(), Path(evidence_directory).resolve()
    def trusted_manifest():
        current = verify(directory, revision)
        if not re.fullmatch(r'[0-9a-f]{64}', expected_marker) or expected_marker != current['source_sha256']:
            raise ValueError('Build public marker differs from the trusted export result')
        if not re.fullmatch(r'[0-9a-f]{64}', expected_manifest_sha256) or candidate.sha((directory / 'context-manifest.json').read_bytes()) != expected_manifest_sha256:
            raise ValueError('Build context manifest differs from the trusted export result')
        return current
    manifest = trusted_manifest()
    if directory == evidence_directory or directory in evidence_directory.parents or evidence_directory.exists():
        raise ValueError('Use a new evidence directory outside controlled contexts')
    evidence_directory.mkdir(parents=True)
    marker = manifest['source_sha256']; images = []
    for part in RECIPES:
        trusted_manifest()
        tag = f'{IMAGE_ROOT}/savana-wa-{part}:sha-{revision}'
        metadata = evidence_directory / f'{part}-buildx.json'
        command = ['docker', 'buildx', 'build', '--platform', 'linux/amd64',
                   '--file', str(directory / f'recipes/{part}.Dockerfile'),
                   '--label', f'org.opencontainers.image.revision={revision}',
                   '--label', f'savana.candidate.source-sha256={marker}', '--tag', tag,
                   '--metadata-file', str(metadata)]
        for resource in RUN_RESOURCES:
            command += ['--resource', resource]
        if publish:
            command += ['--provenance=mode=max', '--sbom=true', '--push']
        else:
            command += ['--load']
        if part == 'client':
            command += ['--build-arg', f'VITE_WA_CLIENT_RELEASE={marker}']
        command += [str(directory / f'contexts/{part}')]
        subprocess.run(command, check=True)
        data = json.loads(metadata.read_text()); digest = data.get('containerimage.digest', '')
        if not re.fullmatch(r'sha256:[0-9a-f]{64}', digest):
            raise ValueError('Buildx did not return a valid immutable image digest')
        reference = f'{IMAGE_ROOT}/savana-wa-{part}@{digest}'
        inspect = ['docker', 'buildx', 'imagetools', 'inspect', reference, '--format', '{{json .Image.Config.Labels}}'] if publish else \
                  ['docker', 'image', 'inspect', tag, '--format', '{{json .Config.Labels}}']
        labels = json.loads(subprocess.check_output(inspect))
        if labels.get('org.opencontainers.image.revision') != revision or labels.get('savana.candidate.source-sha256') != marker:
            raise ValueError('Built image revision/public marker does not match the verified context')
        images.append({'component': part, 'tag': tag, 'digest': digest, 'immutable_reference': reference,
                       'verified_revision': revision, 'verified_source_sha256': marker})
    trusted_manifest()
    evidence = {'git_revision': revision, 'source_sha256': marker, 'WA_BROWSER_RELEASE': marker,
                'runtime_setting_assignment': f'WA_BROWSER_RELEASE={marker}', 'target_platform': 'linux/amd64',
                'context_manifest_sha256': candidate.sha((directory / 'context-manifest.json').read_bytes()),
                'context_sha256': manifest['context_sha256'], 'recipes': manifest['recipes'], 'images': images,
                'published': publish, 'sbom': publish, 'provenance': 'mode=max' if publish else 'local CI load'}
    (evidence_directory / 'release-evidence.json').write_bytes(candidate.canonical(evidence))
    return evidence


def main():
    parser = argparse.ArgumentParser(description=__doc__); commands = parser.add_subparsers(dest='operation', required=True)
    exporter = commands.add_parser('export'); exporter.add_argument('--repository', required=True); exporter.add_argument('--revision', required=True); exporter.add_argument('--output-directory', required=True)
    setup = commands.add_parser('verify-builder'); setup.add_argument('--builder', required=True); setup.add_argument('--nodes', required=True)
    builder = commands.add_parser('build'); builder.add_argument('--context-directory', required=True); builder.add_argument('--revision', required=True); builder.add_argument('--evidence-directory', required=True); builder.add_argument('--push', action='store_true'); builder.add_argument('--expected-source-sha256', required=True); builder.add_argument('--expected-manifest-sha256', required=True)
    args = parser.parse_args()
    try:
        if args.operation == 'export':
            result = export(args.repository, args.revision, args.output_directory)
            print(json.dumps({'git_revision': result['git_revision'], 'source_sha256': result['source_sha256'], 'runtime_file_count': len(result['files']), 'context_manifest_sha256': candidate.sha((Path(args.output_directory) / 'context-manifest.json').read_bytes())}))
        elif args.operation == 'verify-builder':
            print(json.dumps(verify_builder(args.builder, args.nodes)))
        else:
            result = build(args.context_directory, args.revision, args.evidence_directory, args.expected_source_sha256, args.expected_manifest_sha256, args.push)
            print(json.dumps({'git_revision': result['git_revision'], 'source_sha256': result['source_sha256'], 'published': result['published']}))
    except (ValueError, OSError, KeyError, TypeError, subprocess.SubprocessError, json.JSONDecodeError):
        parser.exit(1, 'Controlled release refused: check clean revision, reviewed marker, context/recipe hashes and image labels.\n')


if __name__ == '__main__':
    main()
