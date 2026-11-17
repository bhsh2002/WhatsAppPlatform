#!/usr/bin/env python3
"""Create an immutable, selective source review reference; never deploy it.

Inputs are an exact file allowlist and official contract references. Runtime
configuration, databases, dependencies, generated outputs and symlinks are
refused. The archive is an overlay reference on baseline HEAD, not a claim
that that commit contains the worktree changes and not a whole-project backup.
"""

import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import tarfile


DENIED_PARTS = {".git", "node_modules", "dist", "build", "uploads", "media", "logs", "backups", "__pycache__"}
DENIED_SUFFIXES = (".db", ".db-wal", ".db-shm", ".db-journal", ".sqlite", ".sqlite3", ".log", ".pyc", ".pem", ".key", ".p12", ".pfx")
SOURCE_SUFFIXES = {".js", ".jsx", ".mjs", ".cjs", ".json", ".sql", ".py", ".txt", ".md", ".sh", ".yml", ".yaml", ".toml", ".ini", ".html", ".css", ".example"}


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()


def git(repository, *args):
    return subprocess.run(["git", "--no-pager", "-c", "core.quotepath=false", *args], cwd=repository,
                          check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout


def relative_source(value):
    if not isinstance(value, str) or not value or "\\" in value:
        raise ValueError("Allowlist entries must be exact repository-relative POSIX file paths")
    path = PurePosixPath(value)
    if path.is_absolute() or str(path) != value or any(part in {".", ".."} for part in path.parts):
        raise ValueError("Unsafe allowlist path")
    if any(part.lower() in DENIED_PARTS for part in path.parts) or value.lower().endswith(DENIED_SUFFIXES):
        raise ValueError("Runtime/generated/private files cannot enter a source review reference")
    if path.suffix.lower() not in SOURCE_SUFFIXES:
        raise ValueError("Only explicit text source/configuration templates belong in this reference")
    for part in path.parts:
        lower = part.lower()
        if (lower == ".env" or lower.startswith(".env.") or lower.endswith(".env")) and lower != ".env.example":
            raise ValueError("Runtime environment files cannot enter a source review reference")
    return path


def assert_no_symlink(root, relative):
    current = root
    for part in relative.parts:
        current = current / part
        if current.is_symlink():
            raise ValueError("Symlinks are not source review payloads")
    if root not in current.resolve().parents:
        raise ValueError("A source path escaped the repository")
    return current


def verify_example(path, data):
    if path.name.lower() != ".env.example":
        return
    for line in data.decode("utf8").splitlines():
        if line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if re.search(r"TOKEN|SECRET|PASSWORD|CRYPTO_KEY", key, re.I) and value.strip().strip("\"'"):
            raise ValueError("Sensitive values must be empty in an included environment example")


def snapshot_sources(repository, selected):
    tracked = set(git(repository, "ls-tree", "-r", "--name-only", "-z", "HEAD").decode().split("\0"))
    dirty = set(filter(None, git(repository, "diff", "--name-only", "--no-renames", "-z", "HEAD").decode().split("\0")))
    dirty.update(filter(None, git(repository, "ls-files", "--others", "--exclude-standard", "-z").decode().split("\0")))
    entries, payload = [], {}
    for name in selected:
        if name not in dirty:
            raise ValueError("Only changed task files belong in this uncommitted overlay reference")
        relative = relative_source(name)
        path = assert_no_symlink(repository, relative)
        if not path.exists():
            if name not in tracked or name not in dirty:
                raise ValueError("An allowlisted source file does not exist")
            entries.append({"path": name, "state": "deleted", "tracked_at_baseline": True, "sha256": None, "bytes": 0})
            continue
        mode = path.stat().st_mode
        if not stat.S_ISREG(mode):
            raise ValueError("Allowlist entries must be regular files")
        data = path.read_bytes()
        if "\0" in data.decode("utf8"):
            raise ValueError("Binary payloads do not belong in the source review reference")
        verify_example(path, data)
        entry = {"path": name, "state": "file", "tracked_at_baseline": name in tracked,
                 "sha256": sha256(data), "bytes": len(data), "mode": "0755" if mode & 0o111 else "0644"}
        entries.append(entry)
        payload[f"source/{name}"] = (data, int(entry["mode"], 8))
    return entries, payload, sorted(dirty - set(selected))


def snapshot_contracts(references):
    if not isinstance(references, list):
        raise ValueError("Contract references must be a JSON array")
    result, payload = [], {}
    for reference in references:
        if not isinstance(reference, dict) or set(reference) - {"id", "version", "path", "expected_sha256"} \
                or not isinstance(reference.get("id"), str) or not isinstance(reference.get("version"), str) \
                or not reference["id"] or not reference["version"]:
            raise ValueError("Contract references need only id/version/path/expected_sha256")
        identifier = reference["id"]
        if not re.fullmatch(r"[a-zA-Z0-9._-]+", identifier):
            raise ValueError("Unsafe contract reference identifier")
        path = Path(reference.get("path", ""))
        if not path.is_absolute() or path != path.resolve() or path.is_symlink() or not path.is_file():
            raise ValueError("Use an explicit existing official contract path")
        if not path.name.endswith((".openapi.json", ".schema.json")):
            raise ValueError("Only official OpenAPI/schema evidence snapshots are supported")
        data = path.read_bytes()
        document = json.loads(data)
        if not isinstance(document, dict) or not ("openapi" in document or "$schema" in document):
            raise ValueError("A contract evidence reference is not an OpenAPI/schema document")
        info = document.get("info", {})
        if not isinstance(info, dict):
            raise ValueError("Official contract info must be an object")
        digest = sha256(data)
        if not re.fullmatch(r"[0-9a-f]{64}", str(reference.get("expected_sha256", ""))) \
                or digest != reference["expected_sha256"]:
            raise ValueError("Official contract fingerprint changed; re-review before packaging")
        if "openapi" in document and str(info.get("version")) != str(reference["version"]):
            raise ValueError("The declared contract version differs from its official document")
        archive_name = f"references/contracts/{identifier}-{digest}.json"
        if archive_name in payload:
            raise ValueError("Duplicate contract evidence reference")
        payload[archive_name] = (data, 0o644)
        result.append({"id": identifier, "version": reference["version"], "official_source_path": str(path),
                       "sha256": digest, "snapshot_member": archive_name,
                       "official_document_lifecycle": document.get("x-contract-lifecycle", info.get("x-lifecycle")),
                       "snapshot_role": "byte-identical noncanonical review evidence; not runtime configuration"})
    return result, payload


def deterministic_archive(payload):
    tar_buffer = io.BytesIO()
    with tarfile.open(fileobj=tar_buffer, mode="w", format=tarfile.PAX_FORMAT) as archive:
        for name in sorted(payload):
            data, mode = payload[name]
            member = tarfile.TarInfo(name)
            member.size, member.mode, member.mtime = len(data), mode, 0
            member.uid = member.gid = 0
            member.uname = member.gname = ""
            archive.addfile(member, io.BytesIO(data))
    compressed = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=compressed, mtime=0) as stream:
        stream.write(tar_buffer.getvalue())
    return compressed.getvalue()


def immutable_write(path, data):
    if path.is_symlink():
        raise ValueError("Refusing an output symlink")
    if path.exists():
        if path.read_bytes() != data:
            raise ValueError("An existing immutable reference differs; never overwrite it")
        return
    with path.open("xb") as stream:
        stream.write(data)
    os.chmod(path, 0o444)


def package(repository, selected, contract_references, output_directory):
    repository = Path(repository).resolve()
    output_directory = Path(output_directory).resolve()
    if repository == output_directory or repository in output_directory.parents:
        raise ValueError("Write the review reference outside the working repository")
    if not isinstance(selected, list) or not selected or not all(isinstance(name, str) for name in selected) \
            or len(set(selected)) != len(selected):
        raise ValueError("Use a nonempty allowlist without duplicate paths")
    selected = sorted(selected)
    top = Path(git(repository, "rev-parse", "--show-toplevel").decode().strip()).resolve()
    if top != repository:
        raise ValueError("The repository root must be selected explicitly")
    baseline = git(repository, "rev-parse", "HEAD").decode().strip()
    entries, payload, excluded = snapshot_sources(repository, selected)
    contracts, contract_payload = snapshot_contracts(contract_references)
    payload.update(contract_payload)
    diff = git(repository, "diff", "--binary", "--no-ext-diff", "--no-textconv", "--no-renames", "HEAD", "--", *selected)
    payload["selected-tracked-changes.patch"] = (diff, 0o644)
    manifest = {
        "document_kind": "wa_selective_uncommitted_source_review_reference",
        "baseline_head": baseline,
        "baseline_head_contains_worktree_changes": False,
        "reference_kind": "exact selected source overlay plus tracked diff; not a release or deployment installer",
        "included_sources": entries,
        "excluded_dirty_paths": excluded,
        "excluded_by_rule": sorted(DENIED_PARTS) + ["runtime env files", "database/key/log suffixes", "symlinks"],
        "official_contracts": contracts,
        "selected_tracked_diff_sha256": sha256(diff),
        "source_contents_change_after_packaging": "create a new reference; do not relabel this bundle or its baseline commit",
        "runtime_activation": False,
        "deployment_authorized": False,
    }
    manifest_bytes = canonical(manifest)
    payload["review-manifest.json"] = (manifest_bytes, 0o644)
    # Refuse a snapshot taken across concurrent source/contract edits.
    final_entries, _, final_excluded = snapshot_sources(repository, selected)
    final_contracts, _ = snapshot_contracts(contract_references)
    final_diff = git(repository, "diff", "--binary", "--no-ext-diff", "--no-textconv", "--no-renames", "HEAD", "--", *selected)
    if entries != final_entries or excluded != final_excluded or contracts != final_contracts or diff != final_diff \
            or baseline != git(repository, "rev-parse", "HEAD").decode().strip():
        raise ValueError("Source/reference state changed while packaging; wait for a stable review point")
    compressed = deterministic_archive(payload)
    archive_digest = sha256(compressed)
    descriptor = {
        "archive": f"wa-review-{archive_digest}.tar.gz", "sha256": archive_digest,
        "manifest_sha256": sha256(manifest_bytes), "baseline_head": baseline,
        "baseline_only_not_modified_release": True,
        "included_source_count": len(entries), "excluded_dirty_path_count": len(excluded),
        "contract_snapshot_count": len(contracts), "deployed": False, "activated": False,
    }
    output_directory.mkdir(parents=True, exist_ok=True)
    immutable_write(output_directory / descriptor["archive"], compressed)
    immutable_write(output_directory / f"wa-review-{archive_digest}.json", canonical(descriptor))
    return descriptor


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--allowlist", required=True, help="JSON array of exact task source file paths")
    parser.add_argument("--contracts", required=True, help="JSON array of consumed official contract references")
    parser.add_argument("--output-directory", required=True)
    args = parser.parse_args()
    try:
        result = package(args.repository, json.loads(Path(args.allowlist).read_text()),
                         json.loads(Path(args.contracts).read_text()), args.output_directory)
        print(json.dumps(result, sort_keys=True))
    except (ValueError, OSError, subprocess.SubprocessError, json.JSONDecodeError):
        parser.exit(1, "Review reference creation failed; verify the allowlist, official hashes and stable source state.\n")


if __name__ == "__main__":
    main()
