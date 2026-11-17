"""WA-owned operational child entry for the center's simultaneous harness.

Only stdlib is needed. The fixture owns no central grant loader and performs no
registry seeding. Actual owner setup is exercised by its HTTP login/setup/read
routes; JSONL controls configure the owned process/network and inspect counts.
Never print the private ready envelope, cookies, token responses or config.
"""

from contextlib import contextmanager
import json
from pathlib import Path
import select
import subprocess
from threading import Thread
import time
from urllib.error import HTTPError
from urllib.request import Request, build_opener, HTTPRedirectHandler


NODE20 = Path("/Users/savana/Dev/.tools/whatsapp/node-v20.20.2-darwin-arm64/bin/node")
ENTRY = Path(__file__).with_name("operationalWaProcess.mjs")
PREFIX = "@@WA_OPERATIONAL@@"


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


class OperationalWaFixture:
    def __init__(self, process):
        self._process = process
        self._stderr_bytes = 0
        self._stderr_thread = Thread(target=self._drain_stderr, daemon=True)
        self._stderr_thread.start()
        self._cookies = {}
        self._ready = None
        self.needs_oidc_configuration = False
        self.cleanup = None
        self._opener = build_opener(NoRedirect())

    def _drain_stderr(self):
        for chunk in iter(lambda: self._process.stderr.read(4096), b""):
            self._stderr_bytes += len(chunk)

    def receive(self, timeout=45):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self._process.poll() is not None:
                # Already buffered protocol data may still follow an exit.
                ready, _, _ = select.select([self._process.stdout], [], [], 0)
                if not ready:
                    raise RuntimeError("Owned WA fixture exited before protocol completion")
            ready, _, _ = select.select([self._process.stdout], [], [], min(.1, max(0, deadline - time.monotonic())))
            if not ready:
                continue
            line = self._process.stdout.readline()
            if not line:
                if self._process.poll() is not None:
                    raise RuntimeError("Owned WA fixture ended without its response")
                continue
            if not line.startswith(PREFIX.encode()):
                # Real migration/application diagnostics are not fixture data.
                continue
            value = json.loads(line[len(PREFIX):])
            if value.get("event") == "error":
                raise RuntimeError("Owned WA fixture reported a sanitized failure")
            return value
        raise TimeoutError("Owned WA fixture response timed out")

    def command(self, command, **data):
        if self._process.poll() is not None:
            raise RuntimeError("Owned WA fixture is no longer running")
        self._process.stdin.write((json.dumps({"command": command, **data}) + "\n").encode())
        self._process.stdin.flush()
        return self.receive()

    def start(self, config):
        ready = self.command("start", config=config)
        if ready.get("event") == "configuration_required":
            self.base_url = ready["base_url"]
            self.callback_uri = ready["callback_uri"]
            self._owned_directory = Path(ready["owned_directory"])
            self.needs_oidc_configuration = True
            return self
        self._accept_ready(ready)
        return self

    def _accept_ready(self, ready):
        if ready.get("event") != "ready" or ready.get("grants_seeded") is not False or ready.get("delegated_sessions_seeded") is not False:
            raise AssertionError("WA fixture did not confirm unprivileged owner-journey startup")
        self._ready = ready
        self.contract_sha256 = dict(ready["contract_sha256"])
        self.base_url = ready["base_url"]
        self.callback_uri = ready["callback_uri"]
        self._owned_directory = Path(ready["owned_directory"])
        self.needs_oidc_configuration = False

    def configure_oidc(self, config):
        if not self.needs_oidc_configuration:
            raise RuntimeError("The private OIDC configuration continuation is not pending")
        self._accept_ready(self.command("configure_oidc", config=config))
        return self

    def request(self, method, path, *, as_user=None, body=None, headers=None):
        if not path.startswith("/") or path.startswith("//") or "://" in path:
            raise ValueError("WA HTTP fixture only addresses its owned origin")
        supplied_headers = dict(headers or {})
        if as_user is not None:
            if as_user not in self._cookies:
                raise RuntimeError("Login through actual WA HTTP before using that local session")
            supplied_headers["Cookie"] = self._cookies[as_user]
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            supplied_headers["Content-Type"] = "application/json"
        if method.upper() == "POST" and path.split("?", 1)[0].startswith("/api/portal/integrations/shared-read-setup"):
            supplied_headers.setdefault("X-Savana-Owner-Intent", "shared-read-setup-v1")
            supplied_headers.setdefault("Origin", self.base_url)
        request = Request(self.base_url + path, data=data, headers=supplied_headers, method=method)
        try:
            response = self._opener.open(request, timeout=15)
        except HTTPError as error:
            response = error
        with response:
            raw = response.read()
            # Redirect/HTML bodies are not a place to expose callback or token
            # material. The private harness may inspect Location explicitly.
            payload = json.loads(raw) if raw and "application/json" in response.headers.get("Content-Type", "") else None
            return response.status, payload, dict(response.headers)

    def login(self, kind="owner"):
        if kind not in {"owner", "employee", "foreign"}:
            raise ValueError("Use an owned synthetic local identity")
        if not self._ready:
            raise RuntimeError("Complete the trusted OIDC application configuration before local login")
        identity = self._ready["local_login"][kind]
        status, payload, headers = self.request("POST", "/api/auth/login", body={
            "username": identity["username"], "password": identity["password"],
        })
        if status != 200:
            raise AssertionError("Actual WA fixture login failed")
        cookie = next((value for name, value in headers.items() if name.lower() == "set-cookie"), "").split(";", 1)[0]
        if not cookie.startswith("wa_session="):
            raise AssertionError("Actual WA login did not issue its HttpOnly session cookie")
        self._cookies[kind] = cookie
        # Do not return the native JWT from login or expose the fixture secret.
        return {"status": status, "authenticated": True, "role": payload["user"]["role"]}

    def diagnostics(self):
        response = self.command("diagnostics")
        if response.get("event") != "diagnostics":
            raise AssertionError("WA fixture diagnostics were not confirmed")
        return response

    def network(self, *, disconnected=False, drop_next_ack=None):
        return self.command("network", state={"disconnected": disconnected, "dropNextAck": drop_next_ack})

    def pause_http(self):
        return self.command("pause_http")

    def resume_http(self):
        return self.command("resume_http")

    def stop(self):
        if self._process.poll() is None:
            response = self.command("stop")
            if response.get("event") != "stopped":
                raise AssertionError("WA fixture did not confirm cleanup")
            self.cleanup = response["cleanup"]
        if not self._process.stdin.closed:
            self._process.stdin.close()
        self._process.wait(timeout=15)
        self._stderr_thread.join(timeout=5)
        if self._process.returncode != 0:
            raise AssertionError("WA fixture child exited unsuccessfully")
        if hasattr(self, "_owned_directory") and (self._owned_directory.exists() or not self.cleanup or not all(self.cleanup.values())):
            raise AssertionError("WA fixture state survived cleanup")


@contextmanager
def isolated_wa_operational(config, *, node=NODE20):
    """Start one private WA process; no existing data/config/token can load."""
    node = Path(node)
    if not node.is_absolute() or not node.is_file():
        raise ValueError("Use the existing explicit project Node20 runtime")
    process = subprocess.Popen([str(node), str(ENTRY)], cwd=ENTRY.parent,
        env={"PATH": str(node.parent), "LANG": "en_US.UTF-8", "TZ": "UTC"},
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        start_new_session=True, bufsize=0)
    fixture = OperationalWaFixture(process)
    error = None
    try:
        yield fixture.start(config)
    finally:
        try:
            fixture.stop()
        except BaseException as failure:
            error = failure
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
        finally:
            for stream in (process.stdin, process.stdout, process.stderr):
                if stream:
                    stream.close()
        if error is not None:
            raise error
