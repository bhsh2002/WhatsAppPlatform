"""Private client for Catalog's published owned temporary JSONL entry only."""

from contextlib import contextmanager
import json
import os
from pathlib import Path
from queue import Queue, Empty
import subprocess
from threading import Thread
from urllib.parse import urlparse


HANDOFF = Path("/Users/savana/Dev/.organization/2026-11-17/integration-plan/project-handoffs/Catalog/operational-handoff")


class OfficialCatalogPeer:
    def __init__(self, start):
        metadata = json.loads((HANDOFF / "orchestrator-entry.json").read_text())
        self._messages = Queue()
        self._stderr_lines = 0
        self._ignored_stdout_lines = 0
        environment = {key: value for key, value in os.environ.items()
                       if key in {"PATH", "HOME", "TMPDIR", "LANG", "LC_ALL"}}
        environment.update(PYTHON_DOTENV_DISABLED="1", PYTHONDONTWRITEBYTECODE="1")
        command = metadata["command"]
        self._process = subprocess.Popen(command, cwd=str(Path(command[-1]).parent), env=environment,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self._reader = Thread(target=self._read, daemon=True)
        self._errors = Thread(target=self._read_errors, daemon=True)
        self._reader.start()
        self._errors.start()
        try:
            self._ready = self.command("start", protocol=metadata["protocol"], **start)
            if self._ready.get("event") != "ready":
                raise RuntimeError("Official Catalog entry did not confirm owned readiness")
            self.base_url = self._ready["base_url"]
            parsed = urlparse(self.base_url)
            if parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or not parsed.port:
                raise RuntimeError("Official Catalog entry did not return an owned origin")
        except BaseException:
            self.close()
            raise

    def _read(self):
        for line in self._process.stdout:
            try:
                value = json.loads(line)
            except ValueError:
                self._ignored_stdout_lines += 1
                continue
            if isinstance(value, dict):
                self._messages.put(value)

    def _read_errors(self):
        for _line in self._process.stderr:
            self._stderr_lines += 1

    def command(self, command, **values):
        if self._process.poll() is not None:
            raise RuntimeError("Official Catalog child ended before its response")
        self._process.stdin.write(json.dumps({"command": command, **values}) + "\n")
        self._process.stdin.flush()
        try:
            message = self._messages.get(timeout=45)
        except Empty as failure:
            raise RuntimeError("Official Catalog private command timed out") from failure
        if message.get("event") == "error" or message.get("error"):
            raise RuntimeError("Official Catalog entry rejected a private command")
        return message

    def close(self):
        if self._process.poll() is None:
            try:
                stopped = self.command("stop")
                if stopped.get("event") != "stopped" or stopped.get("cleanup_complete") is not True:
                    raise RuntimeError("Official Catalog stop was not confirmed")
                self._process.stdin.close()
                self._process.wait(timeout=15)
            except BaseException:
                self._process.terminate()
                try:
                    self._process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self._process.kill()
                    self._process.wait(timeout=5)
                raise
        self._reader.join(timeout=3)
        self._errors.join(timeout=3)
        for stream in (self._process.stdin, self._process.stdout, self._process.stderr):
            if not stream.closed:
                stream.close()
        if self._process.returncode != 0:
            raise RuntimeError("Official Catalog child did not exit cleanly")


@contextmanager
def official_catalog_peer(start):
    peer = OfficialCatalogPeer(start)
    try:
        yield peer
    finally:
        peer.close()
