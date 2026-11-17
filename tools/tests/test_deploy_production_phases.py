from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest


HELPER = Path(__file__).resolve().parents[1] / 'wa_production_phase_checks.sh'
RUNNER = HELPER.parent / 'deploy_production.sh'
NODE22 = Path(os.environ.get('WA_TEST_NODE_BINARY', '/Users/savana/Dev/.tools/whatsapp/node-v22.23.5-darwin-arm64/bin/node'))


class DeploymentPhaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='wa-deploy-phase-test-'); self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name); self.bin = self.directory / 'bin'; self.bin.mkdir()
        self.expected = 'a' * 64
        self.maintenance = {'active': True, 'requested': True, 'enforced': True, 'resume_check': {'required': True, 'passed': None}}
        self.gate_status = 503; self.calls = []; self.metrics_status = 200; self.bad_pwa = False; owner = self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_): pass
            def do_GET(self): self.respond()
            def do_POST(self): self.respond()
            def respond(self):
                owner.calls.append((self.command, self.path))
                content_type = 'application/json'
                if self.path in ('/health', '/api/health'): status, data = 200, json.dumps({'maintenance': owner.maintenance}).encode()
                elif self.path == '/manifest.webmanifest':
                    status, data = 200, b'{"name":"Synthetic","short_name":"Synthetic","start_url":"/","display":"standalone","icons":[{"src":"/icon.png"}]}'
                    content_type = 'application/manifest+json'
                elif self.path == '/sw.js': status, data, content_type = 200, b'self.addEventListener("fetch",()=>{});', 'application/javascript'
                elif self.path == '/metrics':
                    status = owner.metrics_status if self.headers.get('Authorization') == 'Bearer synthetic-phase-metrics' else 401
                    data = b'whatsapp_process_uptime_seconds 1\n'
                else: status, data = owner.gate_status, b'{"accepted":false,"error":{"code":"WA_EGRESS_MAINTENANCE"}}'
                if owner.bad_pwa and self.path == '/sw.js': content_type = 'text/html'
                self.send_response(status); self.send_header('Content-Type', content_type)
                self.send_header('Cache-Control', 'no-cache'); self.end_headers(); self.wfile.write(data)
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True); self.thread.start()
        self.addCleanup(self.server.server_close); self.addCleanup(self.server.shutdown)
        wrapper = self.bin / 'docker'
        wrapper.write_text(f'''#!{sys.executable}
import json,os,subprocess,sys
args=sys.argv[1:]
with open(os.environ['MOCK_DOCKER_CALLS'],'a') as log:log.write(json.dumps(args)+'\\n')
if os.environ.get('MOCK_FULL_RUNNER')=='1':
 if args[:2]==['network','inspect']:sys.exit(0)
 if args[:2]==['image','inspect']:print(os.environ['MOCK_RELEASE_SHA']);sys.exit(0)
 if args[:2]==['inspect','wa-savana-server']:sys.exit(0 if os.environ.get('MOCK_EXISTING')=='1' else 1)
 if args and args[0]=='inspect':print('true');sys.exit(0)
 if args[:2]==['stop','wa-savana-server']:sys.exit(0)
 if args and args[0]=='run':
  if '--log-driver' in args:
   assert args[args.index('--log-driver')+1]=='none'
   print('a'*64,end='');sys.exit(0)
  if 'wa-candidate-release-check' in args:sys.exit(0 if args[-1]==os.environ['MOCK_BUILT_MARKER'] else 1)
  sys.exit(0)
 if args and args[0]=='compose':
  if 'config' in args and '--format' in args:
   print(json.dumps({{'services':{{'server':{{'image':'ghcr.io/bhsh2002/savana-wa-server@sha256:'+'a'*64}},'client':{{'image':'ghcr.io/bhsh2002/savana-wa-client@sha256:'+'b'*64}}}}}}))
  sys.exit(1 if 'up' in args and os.environ.get('MOCK_UP_FAIL')=='1' else 0)
if args[:3]==['exec','-i','wa-savana-server']:
 key=sys.stdin.read();sys.exit(0 if key=='a'*64 and os.environ.get('MOCK_KEY_MATCH','1')=='1' else 1)
if args[:2]==['exec','wa-savana-frontend']:
 sys.exit(0 if args[-1]==os.environ['MOCK_BUILT_MARKER'] else 1)
if args[:3]!=['exec','wa-savana-server','node']:sys.exit(90)
args=args[3:]
index=args.index('-e')+1
args[index]=args[index].replace('http://127.0.0.1:3031',os.environ['MOCK_HTTP_ORIGIN'])
sys.exit(subprocess.run([os.environ['MOCK_NODE'],*args],env=os.environ).returncode)
'''); wrapper.chmod(0o755)
        self.env = {'PATH': str(self.bin) + os.pathsep + os.defpath, 'MOCK_NODE': str(NODE22) if NODE22.exists() else shutil.which('node'),
            'MOCK_HTTP_ORIGIN': f'http://127.0.0.1:{self.server.server_port}', 'MOCK_BUILT_MARKER': self.expected,
            'WA_BROWSER_RELEASE': self.expected, 'METRICS_TOKEN': 'synthetic-phase-metrics'}
        self.docker_calls = self.directory / 'docker-calls.jsonl'; self.env['MOCK_DOCKER_CALLS'] = str(self.docker_calls)

    def execute_runner(self, phase, existing=False):
        release = self.directory / 'release'; tools = release / 'tools'; tools.mkdir(parents=True)
        shutil.copyfile(RUNNER, tools / RUNNER.name); shutil.copyfile(HELPER, tools / HELPER.name)
        (release / 'docker-compose.production.yml').write_text('synthetic compose; parsed by explicit Docker fixture only\n')
        backup = tools / 'backup_production.sh'; backup.write_text('#!/bin/sh\nprintf "WA_BACKUP_VERIFIED path=/synthetic/archive\\n"\n'); backup.chmod(0o755)
        preflight = tools / 'preflight_migrations.sh'; preflight.write_text('#!/bin/sh\nexit 0\n'); preflight.chmod(0o755)
        data = self.directory / 'owned-data'; uploads = self.directory / 'owned-uploads'
        (data / 'backups').mkdir(parents=True); uploads.mkdir()
        for path in (data, data / 'backups', uploads): path.chmod(0o2770)
        if existing: (data / 'platform.db').write_bytes(b'synthetic only')
        runtime = self.directory / 'synthetic-runtime.env'
        runtime.write_text(f'SAVANA_EGRESS_MAINTENANCE={"true" if phase=="maintenance" else "false"}\nSAVANA_EGRESS_REQUIRE_IDLE=true\nWA_BROWSER_RELEASE={self.expected}\n'); runtime.chmod(0o600)
        compose = self.directory / 'synthetic-compose.env'
        compose.write_text(f'WA_RUNTIME_ENV_FILE={runtime}\nWA_DATA_DIR={data}\nWA_UPLOADS_DIR={uploads}\nWA_RELEASE_SHA={"d"*40}\n'); compose.chmod(0o600)
        stat_mock = self.bin / 'stat'
        stat_mock.write_text(f'''#!{sys.executable}
import os,pathlib,sys
flag,path=sys.argv[2:]
print(('2770' if pathlib.Path(path).is_dir() else '600') if flag=='%a' else ('1000' if flag=='%u' else str(os.getgid())))
'''); stat_mock.chmod(0o755)
        git_mock = self.bin / 'git'
        git_mock.write_text(f'''#!{sys.executable}
import sys
if 'rev-parse' in sys.argv:print('d'*40)
elif 'status' not in sys.argv:sys.exit(92)
'''); git_mock.chmod(0o755)
        curl_mock = self.bin / 'curl'
        curl_mock.write_text(f'''#!{sys.executable}
import os,pathlib,sys,urllib.request
args=sys.argv[1:];url=args[-1].replace('http://127.0.0.1:3133',os.environ['MOCK_HTTP_ORIGIN'])
with urllib.request.urlopen(url,timeout=5) as response:
 data=response.read()
 if '--dump-header' in args:pathlib.Path(args[args.index('--dump-header')+1]).write_text('HTTP/1.1 200 OK\\n'+str(response.headers))
 if '--output' in args:pathlib.Path(args[args.index('--output')+1]).write_bytes(data)
 elif '--write-out' not in args:sys.stdout.buffer.write(data)
 if '--write-out' in args:print(response.status,end='')
'''); curl_mock.chmod(0o755)
        (self.bin / 'python3').symlink_to(sys.executable)
        if self.env.get('MOCK_CLEANUP_FAIL') == '1':
            rm_mock = self.bin / 'rm'; rm_mock.write_text('#!/bin/sh\nexit 1\n'); rm_mock.chmod(0o755)
        env = {**self.env, 'MOCK_FULL_RUNNER': '1', 'MOCK_RELEASE_SHA': 'd' * 40,
               'WA_COMPOSE_ENV_FILE': str(compose), 'WA_DEPLOY_PHASE': phase, 'WA_EXPECTED_BROWSER_RELEASE': self.expected,
               'MOCK_EXISTING': '1' if existing else '0'}
        return subprocess.run(['bash', str(tools / RUNNER.name)], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=30)

    def docker_log(self):
        return [json.loads(row) for row in self.docker_calls.read_text().splitlines()] if self.docker_calls.exists() else []

    def assert_contained(self, result):
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual([call for call in self.docker_log() if call[:1] == ['stop']], [['stop', 'wa-savana-server']])

    def execute(self, phase, expected=None, metrics=True):
        script = 'set -eu\nsource "$1"\nwa_verify_runtime_phase "$2" "$3"\n'
        if metrics: script += 'wa_verify_metrics_for_phase "$2"\n'
        return subprocess.run(['bash', '-c', script, 'phase-check', str(HELPER), phase, expected or self.expected],
                              env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=20)

    def resume(self):
        self.maintenance = {'active': False, 'requested': False, 'enforced': True, 'resume_check': {'required': True, 'passed': True}}

    def test_maintenance_checks_real_http_gate_and_intentionally_skips_metrics(self):
        result = self.execute_runner('maintenance')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(('POST', '/webhook'), self.calls); self.assertIn(('POST', '/v1/messages/send'), self.calls)
        self.assertNotIn(('GET', '/metrics'), self.calls)
        self.assertNotIn(self.env['METRICS_TOKEN'], result.stdout + result.stderr)

    def test_maintenance_does_not_accept_ready_health_without_enforcement(self):
        self.maintenance['enforced'] = False
        self.assertNotEqual(self.execute('maintenance').returncode, 0)
        self.assertNotIn(('GET', '/metrics'), self.calls)

    def test_maintenance_refuses_fake_success_acknowledgement(self):
        self.gate_status = 200
        self.assertNotEqual(self.execute('maintenance').returncode, 0)

    def test_resume_requires_idle_guard_public_markers_then_authenticated_metrics(self):
        self.resume(); result = self.execute_runner('resume')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(('GET', '/metrics'), self.calls)
        self.assertNotIn(self.env['METRICS_TOKEN'], result.stdout + result.stderr)

    def test_resume_blocks_missing_idle_preflight_without_metrics_probe(self):
        self.resume(); self.maintenance['resume_check']['passed'] = False
        self.assertNotEqual(self.execute('resume').returncode, 0)
        self.assertNotIn(('GET', '/metrics'), self.calls)

    def test_resume_blocks_runtime_or_compiled_frontend_marker_mismatch(self):
        self.resume(); self.env['WA_BROWSER_RELEASE'] = 'b' * 64
        self.assertNotEqual(self.execute('resume').returncode, 0)
        self.env['WA_BROWSER_RELEASE'] = self.expected; self.env['MOCK_BUILT_MARKER'] = 'c' * 64
        self.assertNotEqual(self.execute('resume').returncode, 0)
        self.assertNotIn(('GET', '/metrics'), self.calls)

    def test_phase_must_be_explicit_before_any_docker_change(self):
        result = self.execute_runner('')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.docker_log(), [])

    def test_offline_frontend_marker_failure_preserves_current_maintenance(self):
        self.resume(); self.env['MOCK_BUILT_MARKER'] = 'c' * 64
        result = self.execute_runner('resume')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any('up' in call or call[:1] == ['stop'] for call in self.docker_log()))

    def test_up_failure_stops_only_wa_server(self):
        self.env['MOCK_UP_FAIL'] = '1'; self.assert_contained(self.execute_runner('maintenance'))

    def test_explicit_runtime_marker_failure_is_contained(self):
        self.resume(); self.env['WA_BROWSER_RELEASE'] = 'c' * 64
        self.assert_contained(self.execute_runner('resume'))

    def test_explicit_metrics_failure_is_contained(self):
        self.resume(); self.metrics_status = 500
        self.assert_contained(self.execute_runner('resume'))

    def test_explicit_pwa_failure_is_contained(self):
        self.bad_pwa = True; self.assert_contained(self.execute_runner('maintenance'))

    def test_failed_temporary_file_cleanup_cannot_skip_containment(self):
        self.bad_pwa = True; self.env['MOCK_CLEANUP_FAIL'] = '1'
        self.assert_contained(self.execute_runner('maintenance'))

    def test_key_mismatch_aborts_before_up_and_docker_key_logging_is_disabled(self):
        self.env['MOCK_KEY_MATCH'] = '0'
        result = self.execute_runner('maintenance', existing=True)
        self.assertNotEqual(result.returncode, 0)
        calls = self.docker_log()
        producer = next(call for call in calls if '--log-driver' in call)
        self.assertEqual(producer[producer.index('--log-driver') + 1], 'none')
        self.assertFalse(any('up' in call or call[:1] == ['stop'] for call in calls))
        self.assertNotIn('a' * 64, result.stdout + result.stderr)

    def test_key_continuity_passes_existing_state_before_cutover(self):
        result = self.execute_runner('maintenance', existing=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = self.docker_log()
        self.assertLess(next(i for i, call in enumerate(calls) if '--log-driver' in call), next(i for i, call in enumerate(calls) if 'up' in call))


if __name__ == '__main__':
    unittest.main()
