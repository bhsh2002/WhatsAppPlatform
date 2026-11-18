#!/usr/bin/env python3
"""Create a deterministic production build-source candidate, never deploy it.

Unchanged build inputs come from Git objects, changed inputs from an explicit
reviewed overlay. Runtime state, workspace dependencies/build output and test
harnesses never enter the image contexts. Public assets and dependency locks do.
"""
import argparse
import base64
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import posixpath
import re
import stat
import subprocess
import tarfile


ALWAYS_DENIED_PARTS = {".git", "node_modules", "__pycache__", ".nyc_output"}
DATA_PREFIXES = ("server/test", "server/test-fixtures", "server/test-support", "server/coverage", "server/logs",
                 "server/backups", "server/uploads", "server/media", "server/db/backups", "server/dist", "server/build",
                 "client/test", "client/browser-tests", "client/coverage", "client/logs", "client/uploads",
                 "client/public/uploads", "client/dist", "client/build")
DENIED_SUFFIXES = (".db", ".db-wal", ".db-shm", ".db-journal", ".sqlite", ".sqlite3", ".pem", ".key", ".p12", ".pfx", ".log", ".pyc")
SERVER_DIRS = {"config", "db", "middleware", "presenters", "routes", "runtime", "scripts", "security", "services"}
SERVER_ROOT = {"Dockerfile", ".dockerignore", "package.json", "package-lock.json", "server.js", "start.js"}
CLIENT_ROOT = {"Dockerfile", ".dockerignore", "package.json", "package-lock.json", "index.html", "nginx.conf", "vite.config.js", "eslint.config.js"}
BUILD_GUARD_ARCHIVE = "client/vendor/savana-picomatch-build-guard-4.1.2-p10.tgz"
BUILD_GUARD_SHA256 = "31d7076b4659842619be2114b3c318e483d67510cdadd82a667133ae1ffe3602"
BUILD_GUARD_SRI = "sha512-YLAjOZDfo7IIpRHhG7jeL0DFFyClZjOYh3al2bx4DCaOlImZyLxq+UAc5CZqXfKkLaY4WXBgACBRUEp8dRd4UQ=="
# Exact reviewed build adapter, not a general vendor-directory exception.
BUILD_GUARD_FILES = {"LICENSE", "README.md", "codec.cjs", "heap-flags.cjs", "index.cjs", "index.mjs", "package.json",
                     "posix.cjs", "posix.mjs", "provenance.json", "worker.cjs", "upstream/LICENSE", "upstream/index.js",
                     "upstream/package.json", "upstream/lib/constants.js", "upstream/lib/parse.js",
                     "upstream/lib/picomatch.js", "upstream/lib/scan.js", "upstream/lib/utils.js"}
CLIENT_BUILD_INPUTS = {BUILD_GUARD_ARCHIVE, "client/scripts/verify-picomatch-build-guard.cjs",
                       "client/scripts/picomatch/verify.cjs", "client/scripts/picomatch/bounded-proof.cjs",
                       "client/vendor/picomatch-build-guard-manifest.json", "client/vendor/picomatch-build-guard-provenance.json",
                       "client/vendor/picomatch-build-guard-verifier.json", "client/vendor/picomatch-build-guard-portable-r3-files.json",
                       "client/vendor/picomatch-build-guard-portable-r3.README.md",
                       "client/vendor/picomatch-build-guard-consumers.json"} | {
    "client/vendor/picomatch-build-guard/" + name for name in BUILD_GUARD_FILES}
RELEASE_INPUTS = {
    "tools/package_wa_production_candidate.py": "release/tools/package_wa_production_candidate.py",
    "tools/validate_wa_linux_candidate.py": "release/tools/validate_wa_linux_candidate.py",
    "tools/wa_linux_candidate_runtime.mjs": "release/tools/wa_linux_candidate_runtime.mjs",
    "docs/WA_PRODUCTION_CANDIDATE.md": "release/WA_PRODUCTION_CANDIDATE.md",
    "docs/WA_PICOMATCH_BUILD_GUARD.md": "release/WA_PICOMATCH_BUILD_GUARD.md",
    "docs/PRODUCTION_CADDY_RUNBOOK.md": "release/PRODUCTION_CADDY_RUNBOOK.md",
    "ops/release/server.Dockerfile": "release/server.Dockerfile",
    "ops/release/client.Dockerfile": "release/client.Dockerfile",
    "docker-compose.production.yml": "release/docker-compose.production.yml",
    "tools/deploy_production.sh": "release/tools/deploy_production.sh",
    "tools/wa_production_phase_checks.sh": "release/tools/wa_production_phase_checks.sh",
    "tools/preflight_migrations.sh": "release/tools/preflight_migrations.sh",
    "tools/backup_production.sh": "release/tools/backup_production.sh",
    "ops/caddy/wa.savana.ly.caddy": "release/ops/caddy/wa.savana.ly.caddy",
    "ops/caddy/wa-sensitive-runtime-log.global-options.caddy": "release/ops/caddy/wa-sensitive-runtime-log.global-options.caddy",
}
CONFIG_EXAMPLES = ("server/.env.example", "ops/production-runtime.env.example", "ops/production-compose.env.example")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()


def git(repository, *args, input_data=None):
    return subprocess.run(["git", "--no-pager", "-c", "core.quotepath=false", *args], cwd=repository,
                          input=input_data, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout


def safe_path(name):
    if not isinstance(name, str) or not name or "\\" in name:
        raise ValueError("Use exact relative POSIX paths")
    path = PurePosixPath(name)
    if not path.parts or path.is_absolute() or str(path) != name or any(p in {".", ".."} for p in path.parts) \
            or any(ord(c) < 32 for c in name):
        raise ValueError("Unsafe source path")
    return path


def runtime_input(name):
    path = safe_path(name)
    if any(p.lower() in ALWAYS_DENIED_PARTS for p in path.parts) or name.lower().endswith(DENIED_SUFFIXES):
        return False
    if any(name == prefix or name.startswith(prefix + '/') for prefix in DATA_PREFIXES):
        return False
    if '__tests__' in path.parts or '__fixtures__' in path.parts:
        return False
    if any(p.lower().startswith(".env") or p.lower().endswith(".env") for p in path.parts):
        return False
    if re.search(r"\.(test|spec)\.[^.]+$", path.name):
        return False
    if path.parts[0] == "server":
        if len(path.parts) == 2:
            return path.name in SERVER_ROOT
        return len(path.parts) > 2 and path.parts[1] in SERVER_DIRS and path.suffix in {".js", ".mjs", ".cjs", ".json", ".sql"}
    if path.parts[0] == "client":
        if name in CLIENT_BUILD_INPUTS:
            return True
        if len(path.parts) == 2:
            return path.name in CLIENT_ROOT
        return len(path.parts) > 2 and path.parts[1] in {"src", "public"} and path.suffix.lower() in {
            ".js", ".jsx", ".mjs", ".json", ".css", ".html", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif",
            ".ico", ".webmanifest", ".woff", ".woff2", ".ttf", ".otf"}
    return False


def audit_relative_imports(payload):
    files = {name[len('source/'):]: data for name, (data, _) in payload.items() if name.startswith('source/')}
    extensions = ('', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css', '.svg')
    patterns = (r'''\b(?:import|export)\s+(?:[^;\n]*?\s+from\s+)?["'](\.{1,2}/[^"']+)["']''',
                r'''\b(?:import|require)\s*\(\s*["'](\.{1,2}/[^"']+)["']''',
                r'''\bnew\s+URL\s*\(\s*["'](\.{1,2}/[^"']+)["']''')
    edges = 0
    for name, data in files.items():
        if PurePosixPath(name).suffix not in {'.js', '.jsx', '.mjs', '.cjs'}:
            continue
        content = data.decode('utf8')
        for pattern in patterns:
            for relative in re.findall(pattern, content):
                relative = relative.split('?', 1)[0].split('#', 1)[0]
                if any(character in relative for character in '*${'):
                    continue
                target = posixpath.normpath(posixpath.join(posixpath.dirname(name), relative))
                candidates = [target + extension for extension in extensions]
                candidates += [target.rstrip('/') + '/index' + extension for extension in extensions[1:5]]
                if not any(candidate in files for candidate in candidates) \
                        and not (relative.endswith('/') and any(candidate.startswith(target.rstrip('/') + '/') for candidate in files)):
                    raise ValueError(f'Controlled context omits relative runtime import: {name} -> {relative}')
                edges += 1
    return edges


def tree(repository):
    result = {}
    for row in git(repository, "ls-tree", "-rz", "HEAD").split(b"\0"):
        if not row:
            continue
        metadata, raw_path = row.split(b"\t", 1)
        mode, kind, oid = metadata.decode().split()
        result[raw_path.decode()] = {"mode": mode, "kind": kind, "oid": oid}
    return result


def baseline_blobs(repository, tracked, names):
    names = sorted(names)
    for name in names:
        if tracked[name]["kind"] != "blob" or tracked[name]["mode"] not in {"100644", "100755"}:
            raise ValueError("Symlinks/submodules are not build inputs")
    raw = git(repository, "cat-file", "--batch", input_data="".join(tracked[n]["oid"] + "\n" for n in names).encode())
    offset, result = 0, {}
    for name in names:
        end = raw.index(b"\n", offset)
        oid, kind, size = raw[offset:end].decode().split()
        if oid != tracked[name]["oid"] or kind != "blob":
            raise ValueError("Unexpected Git object")
        offset = end + 1
        result[name] = raw[offset:offset + int(size)]
        offset += int(size) + 1
    if offset != len(raw):
        raise ValueError("Unexpected Git object stream")
    return result


def workspace_file(repository, name):
    path = repository
    for part in safe_path(name).parts:
        path /= part
        if path.is_symlink():
            raise ValueError("Symlink overlays are refused")
    if not path.exists():
        return None
    mode = path.stat().st_mode
    if not stat.S_ISREG(mode) or repository not in path.resolve().parents:
        raise ValueError("Overlay must be a regular file inside the repository")
    return path.read_bytes(), (0o755 if mode & 0o111 else 0o644)


def locks(payload):
    result = {}
    for component in ("server", "client"):
        package_data = payload[f"source/{component}/package.json"][0]
        lock_data = payload[f"source/{component}/package-lock.json"][0]
        package, lock = json.loads(package_data), json.loads(lock_data)
        if lock.get("lockfileVersion") != 3 or not isinstance(lock.get("packages"), dict):
            raise ValueError("Pinned npm lockfile v3 is required")
        for section in ("dependencies", "devDependencies", "optionalDependencies"):
            if package.get(section, {}) != lock["packages"].get("", {}).get(section, {}):
                raise ValueError("Package and lock dependency sections differ")
        packages = []
        for path, value in sorted(lock["packages"].items()):
            if not path:
                continue
            resolved = value.get("resolved", "")
            if component == "client" and path == "node_modules/picomatch" and resolved.startswith("file:"):
                archive = payload.get("source/" + BUILD_GUARD_ARCHIVE)
                actual_sri = "sha512-" + base64.b64encode(hashlib.sha512(archive[0]).digest()).decode() if archive else None
                if value.get("name") != "@savana-internal/picomatch-build-guard" or value.get("version") != "4.1.2" \
                        or resolved != "file:vendor/savana-picomatch-build-guard-4.1.2-p10.tgz" \
                        or value.get("integrity") != BUILD_GUARD_SRI or not archive \
                        or sha(archive[0]) != BUILD_GUARD_SHA256 or actual_sri != BUILD_GUARD_SRI \
                        or package.get("devDependencies", {}).get("picomatch") != resolved \
                        or package.get("overrides", {}).get("picomatch") != "$picomatch":
                    raise ValueError("Reviewed build guard archive/alias integrity differs")
                packages.append({"path": path, "name": value["name"], "version": value["version"], "integrity": value["integrity"],
                                 "resolved": resolved, "dev": value.get("dev", False), "optional": value.get("optional", False),
                                 "embedded_component": {"name": "picomatch", "version": "4.0.5", "advisory": "GHSA-fc5q-39xc-vjpf"},
                                 "official_upstream_patch": False})
                continue
            if not isinstance(value.get("version"), str) or not resolved.startswith("https://registry.npmjs.org/") \
                    or not re.fullmatch(r"sha(?:1|256|384|512)-[A-Za-z0-9+/=]+", value.get("integrity", "")):
                raise ValueError("Dependencies must resolve to pinned public npm packages with integrity")
            packages.append({"path": path, "version": value["version"], "integrity": value["integrity"],
                             "resolved": resolved, "dev": value.get("dev", False), "optional": value.get("optional", False)})
        result[component] = {"package_json_sha256": sha(package_data), "package_lock_sha256": sha(lock_data),
                             "package_count": len(packages), "packages": packages,
                             "install": "npm ci --omit=dev" if component == "server" else "NODE_OPTIONS='' npm ci --include=dev --include=optional; node scripts/verify-picomatch-build-guard.cjs; npm ls --all --include=dev --include=optional; npm run build",
                             "workspace_node_modules_included": False}
    return result


def contract_snapshots(references):
    if not isinstance(references, list) or len(references) != 5:
        raise ValueError("Exactly the five reviewed official contracts are required")
    payload, result = {}, []
    for ref in references:
        if set(ref) != {"id", "version", "path", "expected_sha256"} or not re.fullmatch(r"[A-Za-z0-9_.-]+", ref["id"]):
            raise ValueError("Invalid official contract reference")
        path = Path(ref["path"])
        if not path.is_absolute() or path != path.resolve() or path.is_symlink() or not path.name.endswith(".openapi.json"):
            raise ValueError("Use canonical official OpenAPI paths")
        data = path.read_bytes(); document = json.loads(data)
        if not document.get("openapi") or str(document.get("info", {}).get("version")) != str(ref["version"]) \
                or sha(data) != ref["expected_sha256"] or not re.fullmatch(r"[0-9a-f]{64}", ref["expected_sha256"]):
            raise ValueError("Official contract version/fingerprint changed")
        member = f"references/contracts/{ref['id']}-{sha(data)}.json"
        if member in payload:
            raise ValueError("Duplicate official contract")
        payload[member] = (data, 0o644)
        result.append({**ref, "snapshot_member": member, "official_document_lifecycle": document.get("x-contract-lifecycle"),
                       "role": "byte-identical noncanonical review evidence, never runtime schema/configuration"})
    return result, payload


def capture(repository, overlay, references):
    tracked = tree(repository)
    dirty = set(filter(None, git(repository, "diff", "--name-only", "--no-renames", "-z", "HEAD").decode().split("\0")))
    dirty.update(filter(None, git(repository, "ls-files", "--others", "--exclude-standard", "-z").decode().split("\0")))
    if not isinstance(overlay, list) or len(overlay) != len(set(overlay)):
        raise ValueError("Overlay must be an exact unique path list")
    for name in overlay:
        safe_path(name)
        if name not in dirty:
            raise ValueError("Overlay paths must be changed task files")
    needed = {name for name in tracked if runtime_input(name)} | set(RELEASE_INPUTS) | set(CONFIG_EXAMPLES)
    needed.update(name for name in overlay if runtime_input(name))
    missing = {name for name in dirty if runtime_input(name) or name in RELEASE_INPUTS or name in CONFIG_EXAMPLES} - set(overlay)
    if missing:
        raise ValueError("A changed build input is absent from the reviewed overlay")
    clean_names = needed.intersection(tracked) - set(overlay)
    clean = baseline_blobs(repository, tracked, clean_names)
    payload, entries, config_names, config_templates, deletions = {}, [], set(), [], []
    for name in sorted(needed):
        if name in overlay:
            item = workspace_file(repository, name)
            if item is None:
                deletions.append(name); continue
            data, mode = item; origin = "reviewed_worktree_overlay"
        elif name in clean:
            data = clean[name]; mode = 0o755 if tracked[name]["mode"] == "100755" else 0o644
            origin = "clean_baseline_git_blob"
        else:
            raise ValueError("Required release tooling/build input is absent")
        if name in CONFIG_EXAMPLES:
            config_templates.append({"path": name, "sha256": sha(data), "origin": origin, "values_payload_excluded": True})
            for line in data.decode().splitlines():
                match = re.match(r"^([A-Z][A-Z0-9_]*)=", line)
                if match:
                    config_names.add(match.group(1))
            continue
        member = RELEASE_INPUTS.get(name, f"source/{name}")
        payload[member] = (data, mode)
        entries.append({"path": name, "member": member, "mode": f"{mode:04o}", "sha256": sha(data), "bytes": len(data), "origin": origin})
    dependencies = locks(payload)
    import_edges = audit_relative_imports(payload)
    for component, names in (("server", ("server.js", "start.js", "Dockerfile")),
                             ("client", ("index.html", "nginx.conf", "vite.config.js", "Dockerfile"))):
        if any(f"source/{component}/{name}" not in payload for name in names):
            raise ValueError("A required production entrypoint/build input was deleted")
    images = {}
    for component in ("server", "client"):
        dockerfile = payload[f"source/{component}/Dockerfile"][0].decode()
        refs = re.findall(r"^FROM\s+([^\s]+)", dockerfile, re.M)
        if not refs or any(not re.fullmatch(r"[a-z0-9:./_-]+@sha256:[0-9a-f]{64}", ref) for ref in refs):
            raise ValueError("All base image FROM inputs must be digest pinned")
        images[component] = refs
    candidate_server = payload["release/server.Dockerfile"][0].decode()
    candidate_server_bases = re.findall(r"^FROM\s+([^\s]+)", candidate_server, re.M)
    if candidate_server_bases != images["server"] or "npm_config_build_from_source=true" not in candidate_server \
            or "npm_config_nodedir=/usr/local" not in candidate_server:
        raise ValueError("Candidate server must retain approved base and compile native dependencies from locked source")
    candidate_client = payload["release/client.Dockerfile"][0].decode()
    if re.findall(r"^FROM\s+([^\s]+)", candidate_client, re.M) != images["client"] \
            or "ARG VITE_WA_CLIENT_RELEASE" not in candidate_client:
        raise ValueError("Candidate client must retain approved bases and accept the public content marker")
    contracts, contract_payload = contract_snapshots(references); payload.update(contract_payload)
    secret_names = sorted(n for n in config_names if re.search(r"SECRET|PASSWORD|PRIVATE_KEY|CRYPTO_KEY|API_KEY|(?:^|_)TOKEN$", n))
    config_data = canonical({"secret_names": secret_names,
        "nonsecret_setting_names": sorted(config_names - set(secret_names)), "values_included": False,
        "real_configuration_read": False})
    payload["release/configuration-names.json"] = (config_data, 0o644)
    migrations = {e["path"]: e["sha256"] for e in entries if re.match(r"server/db/migrations/0(?:55|56|57|58|59|60)_", e["path"])}
    if len(migrations) != 6:
        raise ValueError("Reviewed migrations 055 through 060 must all be included")
    # Public browser compatibility follows runtime inputs only. Committing the
    # same bytes, changing review metadata or adding a release label cannot
    # change the marker. Recipes/contracts/provenance are separately archived.
    identity = {"files": [{k: e[k] for k in ("path", "mode", "sha256")} for e in entries if e["member"].startswith("source/")]}
    manifest = {"document_kind": "wa_production_build_source_candidate", "source_sha256": sha(canonical(identity)),
        "baseline_head": git(repository, "rev-parse", "HEAD").decode().strip(), "baseline_is_not_modified_release": True,
        "release_git_commit": None, "inputs": entries, "deleted_inputs": deletions,
        "configuration_templates_names_only": config_templates, "configuration_names_sha256": sha(config_data),
        "public_marker_identity": "controlled runtime source paths/modes/bytes only; excludes Git/release/review metadata",
        "excluded_overlay_paths": sorted(set(overlay) - {e["path"] for e in entries} - set(deletions)),
        "excluded_dirty_paths": sorted(dirty - set(overlay)), "dependencies": dependencies, "base_images": images,
        "new_migrations_sha256": migrations, "official_contracts": contracts,
        "target_platform": "linux/amd64", "native_dependency_provenance": "Compile better-sqlite3 from npm integrity source against approved base-image headers",
        "relative_runtime_import_edges_verified": import_edges,
        "context_exclusion_rules": {"always_denied_directory_components": sorted(ALWAYS_DENIED_PARTS),
                                    "runtime_data_test_output_prefixes": list(DATA_PREFIXES),
                                    "legitimate_nested_runtime_names_included": 'Logs/build/test-like names are not globally removed'},
        "configuration": "secret/setting names only; values and runtime env files excluded",
        "excluded": sorted(ALWAYS_DENIED_PARTS) + list(DATA_PREFIXES) + ["runtime env/key/database files", "workspace dependencies", "workspace dist", "other projects", "Git history"],
        "source_archive_reproducible": True, "built_image_byte_reproducibility_claimed": False,
        "public_browser_release_marker": "VITE_WA_CLIENT_RELEASE and WA_BROWSER_RELEASE equal source_sha256; compatibility only, never authority",
        "production_release_identity_pending_root": True, "deployed": False, "activated": False}
    return manifest, payload


def archive_bytes(payload):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w", format=tarfile.PAX_FORMAT) as tar:
        for name, (data, mode) in sorted(payload.items()):
            info = tarfile.TarInfo(name); info.size = len(data); info.mode = mode; info.mtime = info.uid = info.gid = 0
            info.uname = info.gname = ""; tar.addfile(info, io.BytesIO(data))
    result = io.BytesIO()
    with gzip.GzipFile(filename="", fileobj=result, mode="wb", mtime=0) as compressed:
        compressed.write(stream.getvalue())
    return result.getvalue()


def immutable(path, data):
    if path.is_symlink():
        raise ValueError("Output symlink refused")
    if path.exists():
        if path.read_bytes() != data:
            raise ValueError("Never overwrite another immutable candidate")
        return
    with path.open("xb") as stream:
        stream.write(data)
    path.chmod(0o444)


def package(repository, overlay, references, output):
    repository, output = Path(repository).resolve(), Path(output).resolve()
    if repository == output or repository in output.parents:
        raise ValueError("Candidate output must be outside the repository")
    if Path(git(repository, "rev-parse", "--show-toplevel").decode().strip()).resolve() != repository:
        raise ValueError("Select the exact repository root")
    manifest, payload = capture(repository, overlay, references)
    manifest_data = canonical(manifest); payload["candidate-manifest.json"] = (manifest_data, 0o644)
    final, _ = capture(repository, overlay, references)
    if manifest != final:
        raise ValueError("Source/contracts changed; wait for a stable candidate")
    data = archive_bytes(payload); digest = sha(data)
    descriptor = {"archive": f"wa-production-source-{digest}.tar.gz", "sha256": digest,
        "source_sha256": manifest["source_sha256"], "manifest_sha256": sha(manifest_data),
        "baseline_head": manifest["baseline_head"], "baseline_is_not_modified_release": True,
        "release_git_commit": None, "target_platform": "linux/amd64", "input_count": len(manifest["inputs"]),
        "contract_count": len(references), "deployed": False, "activated": False}
    output.mkdir(parents=True, exist_ok=True)
    immutable(output / descriptor["archive"], data)
    immutable(output / f"wa-production-source-{digest}.json", canonical(descriptor))
    return descriptor


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", required=True); parser.add_argument("--overlay", required=True)
    parser.add_argument("--contracts", required=True); parser.add_argument("--output-directory", required=True)
    args = parser.parse_args()
    try:
        result = package(args.repository, json.loads(Path(args.overlay).read_text()), json.loads(Path(args.contracts).read_text()), args.output_directory)
        print(json.dumps(result, sort_keys=True))
    except (ValueError, OSError, KeyError, subprocess.SubprocessError, json.JSONDecodeError):
        parser.exit(1, "Production candidate preparation failed; verify reviewed inputs, locks, contracts and source stability.\n")


if __name__ == "__main__":
    main()
