#!/usr/bin/env python3
"""Build and validate only a verified WA candidate on an approved local engine.

No push/deploy/SSH, production environment, business mounts or existing Docker
container/volume enumeration. Only task-owned image tags and one fresh tmpfs
container are created; the container is removed even after a failed probe.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile
import tempfile
import time


def sha(data):
    return hashlib.sha256(data).hexdigest()


def sha_file(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def verified_extract(archive, expected, destination):
    if sha(archive.read_bytes()) != expected:
        raise ValueError("Candidate archive checksum mismatch")
    with tarfile.open(archive, "r:gz") as source:
        members = source.getmembers()
        names = [member.name for member in members]
        if len(names) != len(set(names)):
            raise ValueError("Duplicate candidate members")
        manifest = json.load(source.extractfile("candidate-manifest.json"))
        expected_names = {"candidate-manifest.json", "release/configuration-names.json"}
        expected_names.update(entry["member"] for entry in manifest["inputs"])
        expected_names.update(entry["snapshot_member"] for entry in manifest["official_contracts"])
        if set(names) != expected_names or manifest["target_platform"] != "linux/amd64":
            raise ValueError("Unexpected candidate membership/platform")
        for member in members:
            path = PurePosixPath(member.name)
            if not member.isfile() or path.is_absolute() or ".." in path.parts or str(path) != member.name:
                raise ValueError("Unsafe candidate member")
            target = destination.joinpath(*path.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            data = source.extractfile(member).read()
            target.write_bytes(data); target.chmod(member.mode & 0o777)
        for entry in manifest["inputs"]:
            file = destination / entry["member"]
            if sha(file.read_bytes()) != entry["sha256"] or f'{file.stat().st_mode & 0o777:04o}' != entry['mode']:
                raise ValueError("Candidate source hash mismatch")
        identity = {'files': [{key: entry[key] for key in ('path', 'mode', 'sha256')}
                              for entry in manifest['inputs'] if entry['member'].startswith('source/')]}
        identity_data = (json.dumps(identity, ensure_ascii=False, sort_keys=True, indent=2) + '\n').encode()
        if sha(identity_data) != manifest['source_sha256']:
            raise ValueError('Public marker does not match controlled runtime input bytes/modes')
        for entry in manifest["official_contracts"]:
            if sha((destination / entry["snapshot_member"]).read_bytes()) != entry["expected_sha256"]:
                raise ValueError("Candidate contract mismatch")
        if sha((destination / 'release/configuration-names.json').read_bytes()) != manifest['configuration_names_sha256']:
            raise ValueError("Candidate configuration names mismatch")
    return manifest


def run(command, *, logfile=None, input_data=None, timeout=900):
    if logfile:
        with logfile.open("wb") as stream:
            result = subprocess.run(command, input=input_data, stdout=stream, stderr=subprocess.STDOUT, timeout=timeout)
        if result.returncode:
            raise RuntimeError(f"Task-owned build failed; inspect {logfile.name}")
        return b""
    return subprocess.check_output(command, input=input_data, stderr=subprocess.PIPE, timeout=timeout)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True); parser.add_argument("--sha256", required=True)
    parser.add_argument("--docker-endpoint", required=True); parser.add_argument("--output-directory", required=True)
    parser.add_argument("--export-images", action="store_true")
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9a-f]{64}", args.sha256) or not args.docker_endpoint.startswith("unix:///"):
        parser.error("Use a full candidate hash and the approved local Unix Docker endpoint")
    archive = Path(args.archive).resolve(); output = Path(args.output_directory).resolve()
    output.mkdir(parents=True, exist_ok=True)
    docker = shutil.which("docker")
    if not docker:
        parser.error("Approved existing Docker CLI is unavailable; do not install a service")
    container = None; client_container = None; docker_cmd = None
    report = {"archive_sha256": args.sha256, "target_platform": "linux/amd64", "actual_business_data_or_config_used": False,
              "deployed": False, "pushed": False, "passed": False, "image_exports": []}
    try:
        with tempfile.TemporaryDirectory(prefix="wa-production-linux-validation-") as directory:
            owned = Path(directory); owned.chmod(0o700)
            manifest = verified_extract(archive, args.sha256, owned)
            source_hash = manifest["source_sha256"]
            report["source_sha256"] = source_hash
            config = owned / "docker-public-config"; config.mkdir(mode=0o700)
            plugins = Path(docker).resolve().parent.parent / "cli-plugins"
            (config / "config.json").write_text(json.dumps({"cliPluginsExtraDirs": [str(plugins)]} if plugins.is_dir() else {}))
            docker_cmd = [docker, "--config", str(config), "--host", args.docker_endpoint]
            version = json.loads(run(docker_cmd + ["version", "--format", "{{json .}}"], timeout=20))
            report["engine"] = {"client": version["Client"]["Version"], "server": version["Server"]["Version"],
                                "host_architecture": version["Server"]["Arch"], "approved_local_endpoint": True}
            tags = {name: f"wa-production-candidate-{name}:{source_hash[:20]}" for name in ("server", "client")}
            image_ids = {}
            for component in ("server", "client"):
                dockerfile = owned / f"release/{component}.Dockerfile"
                command = docker_cmd + ["build", "--platform", "linux/amd64", "--pull", "--progress", "plain", "--file", str(dockerfile),
                    "--label", f"savana.candidate.source-sha256={source_hash}", "--label", "savana.candidate.uncommitted=true",
                    "--label", f"org.opencontainers.image.revision=uncommitted-source-sha256:{source_hash}",
                    "--tag", tags[component], str(owned / "source" / component)]
                if component == "client":
                    command[-1:-1] = ["--build-arg", f"VITE_WA_CLIENT_RELEASE={source_hash}"]
                run(command, logfile=output / f"{component}-linux-amd64-build.log", timeout=1200)
                inspection = json.loads(run(docker_cmd + ["image", "inspect", tags[component]], timeout=20))[0]
                if inspection["Architecture"] != "amd64" or inspection["Os"] != "linux":
                    raise ValueError("A candidate image was silently built for the host architecture")
                image_ids[component] = {"tag": tags[component], "image_id": inspection["Id"], "size": inspection["Size"],
                    "architecture": inspection["Architecture"], "os": inspection["Os"], "source_label": inspection["Config"]["Labels"]["savana.candidate.source-sha256"]}
            report["images"] = image_ids
            container = f"wa-production-candidate-{source_hash[:16]}-{os.getpid()}"
            run(docker_cmd + ["run", "--detach", "--name", container, "--platform", "linux/amd64", "--network", "none",
                "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--pids-limit", "128",
                "--env", f"WA_CANDIDATE_RELEASE_ID={source_hash}",
                "--tmpfs", "/tmp:rw,nosuid,nodev,uid=1000,gid=1000,mode=1777,size=128m",
                "--tmpfs", "/app/data:rw,nosuid,nodev,uid=1000,gid=1000,mode=0700,size=128m",
                "--tmpfs", "/app/uploads:rw,nosuid,nodev,uid=1000,gid=1000,mode=0700,size=32m",
                tags["server"], "node", "-e", "setInterval(()=>{},60000)"], timeout=30)
            probe = owned / "release/tools/wa_linux_candidate_runtime.mjs"
            run(docker_cmd + ["exec", "--interactive", container, "node", "-e",
                "const fs=require('node:fs'); const chunks=[]; process.stdin.on('data',chunk=>chunks.push(chunk)); process.stdin.on('end',()=>fs.writeFileSync('/tmp/wa-linux-probe.mjs',Buffer.concat(chunks),{mode:0o600}));"],
                input_data=probe.read_bytes(), timeout=20)
            def execute(mode, timeout=60):
                raw = run(docker_cmd + ["exec", container, "node", "/tmp/wa-linux-probe.mjs", mode], timeout=timeout)
                return json.loads(raw.decode().strip().splitlines()[-1])
            report["linux_node_sqlite_migrations"] = execute("migrations", 120)
            if report["linux_node_sqlite_migrations"]["architecture"] != "x64":
                raise ValueError("No measured Linux x86_64 Node runtime")
            installed = run(docker_cmd + ["exec", container, "npm", "ls", "--omit=dev", "--all", "--json"], timeout=60)
            json.loads(installed)
            (output / 'server-installed-dependencies.json').write_bytes(installed)
            report['server_installed_dependencies_sha256'] = sha(installed)
            run(docker_cmd + ["exec", "--detach", container, "node", "/tmp/wa-linux-probe.mjs", "control"], timeout=20)
            report["maintenance_initial"] = execute("probe-initial")
            def request_phase(phase):
                script = "require('node:fs').writeFileSync('/tmp/wa-candidate-command.json',JSON.stringify({phase:process.argv[1],nonce:Date.now()}),{mode:0o600})"
                run(docker_cmd + ["exec", container, "node", "-e", script, phase], timeout=20)
            request_phase("idle"); report["idle_restart_same_tmpfs_database"] = execute("probe-idle")
            request_phase("nonidle"); report["nonidle_resume_refused"] = execute("probe-blocked")
            client_script = """set -eu
nginx -t >/tmp/nginx-check 2>&1
nginx -g 'daemon on;'
wget -q -O /tmp/manifest http://127.0.0.1:8080/manifest.webmanifest
wget -q -O /tmp/worker http://127.0.0.1:8080/sw.js
test -s /tmp/manifest
test -s /tmp/worker
! grep -qi '<!doctype html' /tmp/manifest
! grep -qi '<!doctype html' /tmp/worker
grep -R -l -- "$1" /usr/share/nginx/html/assets >/tmp/public-release-match
test -s /tmp/public-release-match
test ! -e /app/node_modules
printf '{"architecture":"%s","nginx_config":true,"pwa_http_assets":true,"public_release_marker_baked":true,"manifest_sha256":"%s","worker_sha256":"%s"}\\n' "$(uname -m)" "$(sha256sum /tmp/manifest | cut -d ' ' -f1)" "$(sha256sum /tmp/worker | cut -d ' ' -f1)"
"""
            client_container = f"{container}-client"
            client = json.loads(run(docker_cmd + ["run", "--rm", "--name", client_container, "--platform", "linux/amd64", "--network", "none",
                "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--add-host", "server:127.0.0.1",
                "--tmpfs", "/tmp:uid=101,gid=101,mode=1777,size=16m", "--tmpfs", "/var/cache/nginx:uid=101,gid=101,mode=0755,size=16m",
                "--tmpfs", "/var/run:uid=101,gid=101,mode=0755,size=8m", tags["client"], "sh", "-c", client_script, "wa-client-probe", source_hash], timeout=60).decode().strip().splitlines()[-1])
            if client["architecture"] != "x86_64":
                raise ValueError("No measured Linux x86_64 frontend runtime")
            report["client_runtime"] = client
            if args.export_images:
                required = sum(value["size"] for value in image_ids.values()) + 1024 ** 3
                if shutil.disk_usage(output).free < required:
                    raise ValueError("Insufficient free space for one task-owned image export; no existing cache is pruned")
                for component, tag in tags.items():
                    image_archive = output / f"{component}-{source_hash}.docker.tar"
                    if image_archive.exists():
                        raise ValueError("Image export already exists; never overwrite provenance")
                    run(docker_cmd + ["image", "save", "--output", str(image_archive), tag], timeout=600)
                    image_archive.chmod(0o444)
                    report["image_exports"].append({"path": str(image_archive), "sha256": sha_file(image_archive), "format": "Docker image archive"})
            report["passed"] = True
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError) as failure:
        report["failure"] = type(failure).__name__
        report["failure_summary"] = str(failure)[:1000]
    finally:
        if container and docker_cmd:
            if not report['passed']:
                try:
                    diagnostic = run(docker_cmd + ['exec', container, 'node', '-e',
                        "process.stdout.write(require('node:fs').readFileSync('/tmp/wa-candidate-state.json','utf8'))"], timeout=10)
                    json.loads(diagnostic)
                    (output / 'runtime-redacted-failure.json').write_bytes(diagnostic)
                except (OSError, ValueError, subprocess.SubprocessError):
                    pass
            try:
                for name in [container, client_container]:
                    if not name:
                        continue
                    removed = subprocess.run(docker_cmd + ["rm", "--force", name], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
                    if removed.returncode and b'No such container' not in removed.stderr:
                        raise RuntimeError('Unable to remove a task-owned validation container')
                report["task_container_removed"] = True
            except (OSError, RuntimeError, subprocess.SubprocessError):
                report["task_container_removed"] = False
                report['passed'] = False
                report['failure_summary'] = 'Task-owned validation container cleanup failed'
        report["completed_at_unix"] = int(time.time())
        (output / "linux-validation.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"passed": report["passed"], "report": str(output / 'linux-validation.json'), "source_sha256": report.get('source_sha256')}))
    if not report["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
