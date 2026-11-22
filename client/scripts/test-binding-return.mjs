// Mounted product-controller regression with a synthetic loopback HTTP boundary.
// No application server, Core, provider, credentials, or joint factory is used.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const root = fileURLToPath(new URL('../', import.meta.url));
const chromePath = process.env.WA_TEST_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const cases = new Map();
const fixturePath = '/browser-tests/binding-return-fixture.html';
const prefix = '/api/portal/integrations/workspace';
let origin;
const reply = (res, status, value) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
};
const overview = state => ({
  spec_version: '1.0', held: false,
  context: { verified: true, native_reference: state.native, viewKey: state.view, valid_until: state.deadline,
    organizationLabel: 'المؤسسة التجريبية', actorLabel: 'المالك التجريبي',
    connect: { enabled: !state.bound, code: state.bound ? 'connected' : 'native_binding_required', label: 'ربط الحساب التجريبي' } },
  connection: { choices: { activities: [{ value: 'synthetic-activity', label: 'النشاط التجريبي', enabled: true }],
    purposes: [], providers: [], fields: [], people: [] },
    selection: { activity: 'synthetic-activity', purpose: '', provider: '', fields: [], people: [] },
    requests: [], held: false, busy: false, requirements: { fields: false, people: false } },
  capabilities: { capabilities: [] }, sharedData: { records: [] }, commands: [],
  productEditor: { fields: [], units: [], priceChoices: [], mediaChoices: [] },
  intents: state.submitted ? [{ key: state.intent, state: 'completed' }] : [],
  actions: state.name === 'activity' ? [{ key: 'activity.create', label: 'إضافة نشاط تجريبي', enabled: true }] : [],
});
const server = await createServer({
  root, configFile: false, envDir: false, define: { 'import.meta.env.VITE_API_URL': '""' },
  plugins: [react(), {
    name: 'isolated-binding-boundary',
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        const state = cases.get(req.headers['x-wa-binding-test-case'] || url.searchParams.get('case'));
        if (url.pathname === '/synthetic-approval' && state) {
          state.arrivals += 1;
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end('<!doctype html><html lang="ar"><meta charset="utf-8"><title>Isolated approval</title>' +
            '<h1>وصلت محاولة الربط الأصلية</h1><form method="POST" action="/synthetic-approve?case=' + state.name +
            '"><button>اعتماد الربط التجريبي والعودة</button></form></html>');
          return;
        }
        if (url.pathname === '/synthetic-approve' && state && req.method === 'POST') {
          state.bound = true; state.view += '-bound';
          res.writeHead(303, { Location: fixturePath }); res.end(); return;
        }
        if (!url.pathname.startsWith('/api')) { next(); return; }
        if (!state) { reply(res, 403, { error: 'No isolated test case' }); return; }
        state.requests.push({ method: req.method, path: url.pathname, query: url.search });
        // The real API client adds exactly one slash. Do not accept wider aliases.
        const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
        let body = '';
        for await (const chunk of req) body += chunk;
        if (path === prefix && req.method === 'GET') { reply(res, 200, overview(state)); return; }
        if ([prefix + '/commands', prefix + '/requests'].includes(path) && req.method === 'GET') {
          state.listReads += 1;
          reply(res, state.bound ? 200 : 403, state.bound
            ? { viewKey: state.view, valid_until: state.deadline, commands: [], requests: [] }
            : { error: 'Native binding required' });
          return;
        }
        if (state.name === 'activity' && path === prefix + '/binding/review' && req.method === 'POST') {
          state.followingBindingReviews = (state.followingBindingReviews || 0) + 1;
          reply(res, 200, { review: { key: 'following-binding-review', intentKey: 'following-binding-intent', viewKey: state.view,
            valid_until: state.deadline, canSubmit: true, summary: [{ label: 'المحاولة', value: 'ربط الحساب بعد تأكيد النشاط' }] } });
          return;
        }
        if (path === prefix + (state.name === 'activity' ? '/activity/review' : '/binding/review') && req.method === 'POST') {
          assert.equal(req.headers['x-savana-owner-intent'], 'connections-data-v1');
          state.reviews += 1;
          reply(res, 200, { review: { key: state.review, intentKey: state.intent, viewKey: state.view,
            valid_until: state.deadline, canSubmit: true, summary: [{ label: 'المحاولة', value: 'ربط الحساب التجريبي بالمؤسسة' }],
            submitLabel: 'تقديم الطلب المراجع' } });
          return;
        }
        if (path === prefix + '/submit' && req.method === 'POST') {
          assert.equal(req.headers['x-savana-owner-intent'], 'connections-data-v1');
          assert.deepEqual(JSON.parse(body), { review: state.review });
          state.submits += 1; state.submitted = true;
          reply(res, state.name === 'immediate' ? 200 : 503, state.name === 'immediate'
            ? { state: 'completed', authorization_url: state.approval }
            : { error: 'Synthetic acknowledgement lost after acceptance' });
          return;
        }
        if (path === prefix + '/intents/' + state.intent && req.method === 'GET' && state.submitted) {
          state.intentReads += 1;
          reply(res, 200, { intent: { key: state.intent, state: state.name === 'activity' && state.intentReads === 1 ? 'unknown' : 'completed' } }); return;
        }
        if (path === prefix + '/intents/' + state.intent + '/binding-authorization' && req.method === 'GET' && state.submitted) {
          state.continuations += 1;
          if (state.name === 'activity') {
            reply(res, 422, { error: { code: 'workspace_binding_authorization_not_applicable', message: 'Original operation is not a binding' }, clear_previous: true });
            return;
          }
          reply(res, 200, { viewKey: state.view, valid_until: state.name === 'expired' ? new Date(0).toISOString() : state.deadline,
            native_reference: state.name === 'foreign' ? 'another-native-account' : state.native,
            intent: { key: state.intent, state: 'completed' }, binding_status: 'pending', authorization_url: state.approval });
          return;
        }
        reply(res, 403, { error: 'Outside isolated binding regression boundary' });
      });
    },
  }],
  server: { host: '127.0.0.1', port: 0, strictPort: true, hmr: false, fs: { strict: true, allow: [root] },
    headers: { 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; frame-src 'none'; form-action 'self'; base-uri 'none'" } },
});
const profile = await mkdtemp(join(tmpdir(), 'wa-binding-ui-'));
let chrome;
const pending = new Map();
let sequence = 0, buffer = '', chromeErrors = '';
const cdp = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 15_000);
  pending.set(id, { resolve, reject, timer });
  chrome.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
});
const evaluate = async (session, expression) => {
  const response = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session);
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
};
const waitFor = async (session, expression, label) => {
  const end = Date.now() + 25_000;
  while (Date.now() < end) {
    if (await evaluate(session, expression)) return;
    await delay(100);
  }
  throw new Error(label + ': ' + await evaluate(session, 'document.body.innerText.slice(0,4000)'));
};
const click = async (session, label) => {
  const predicate = 'Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim() === ' + JSON.stringify(label) + ' && !b.disabled && b.getClientRects().length)';
  await waitFor(session, 'Boolean(' + predicate + ')', 'Missing usable button ' + label);
  await evaluate(session, '(' + predicate + ').click()');
};

try {
  await server.listen();
  origin = 'http://127.0.0.1:' + server.httpServer.address().port;
  chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--disable-sync',
    '--user-data-dir=' + profile, '--remote-debugging-pipe', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  chrome.stderr.on('data', chunk => { chromeErrors = (chromeErrors + chunk).slice(-4000); });
  chrome.on('error', error => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); } pending.clear(); });
  chrome.stdio[4].on('data', chunk => {
    buffer += chunk.toString();
    let end;
    while ((end = buffer.indexOf('\0')) >= 0) {
      const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
      const item = pending.get(message.id);
      if (item) { pending.delete(message.id); clearTimeout(item.timer); message.error ? item.reject(new Error(JSON.stringify(message.error))) : item.resolve(message.result); }
    }
  });
  await cdp('Browser.getVersion');
  for (const name of ['immediate', 'lost-ack', 'foreign', 'expired', 'activity']) {
    const state = { name, native: 'synthetic-native-' + name, view: 'synthetic-view-' + name,
      deadline: new Date(Date.now() + 180_000).toISOString(), intent: 'wr1.synthetic-binding-' + name,
      review: 'synthetic-binding-review-' + name, approval: origin + '/synthetic-approval?case=' + name,
      submitted: false, bound: false, reviews: 0, submits: 0, intentReads: 0, continuations: 0, arrivals: 0, listReads: 0, requests: [] };
    cases.set(name, state);
    const { browserContextId } = await cdp('Target.createBrowserContext');
    const { targetId } = await cdp('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
    await cdp('Page.enable', {}, sessionId); await cdp('Runtime.enable', {}, sessionId); await cdp('Network.enable', {}, sessionId);
    await cdp('Network.setExtraHTTPHeaders', { headers: { 'X-WA-Binding-Test-Case': name } }, sessionId);
    await cdp('Page.bringToFront', {}, sessionId);
    await cdp('Page.navigate', { url: origin + fixturePath }, sessionId);
    if (name === 'activity') {
      await click(sessionId, 'إضافة نشاط تجريبي');
      // Input through the browser event path, with React retaining normal form state.
      await waitFor(sessionId, 'Boolean(document.querySelector(\'input[maxlength="200"]\'))', 'Activity name input');
      await evaluate(sessionId, 'document.querySelector(\'input[maxlength="200"]\').focus()');
      await cdp('Input.insertText', { text: 'نشاط من الرحلة التجريبية' }, sessionId);
      await click(sessionId, 'مراجعة النشاط الجديد');
    } else await click(sessionId, 'ربط الحساب التجريبي');
    await click(sessionId, 'تقديم الطلب المراجع');
    if (name !== 'immediate') {
      await click(sessionId, 'التحقق من النتيجة');
    }
    if (name === 'immediate' || name === 'lost-ack') {
      await waitFor(sessionId, 'location.pathname === "/synthetic-approval" && document.body.innerText.includes("وصلت محاولة الربط الأصلية")', 'Approval navigation');
      assert.equal(state.arrivals, 1);
      assert.equal(state.listReads, 0, 'prebinding list reads must remain blocked and unrequested');
      // Return from an explicit approval into the same product controller.
      await click(sessionId, 'اعتماد الربط التجريبي والعودة');
      await click(sessionId, 'التحقق من النتيجة');
      await waitFor(sessionId, '!document.body.innerText.includes("توجد عملية قيد التحقق") && document.body.innerText.includes("الحساب متحقق")', 'Same-attempt hold release after approval');
      assert.equal(state.listReads, 2, 'bound return reads only the authorized command/request lists');
      assert.equal(await evaluate(sessionId, 'Object.keys(sessionStorage).some(k => k.startsWith("wa-connections-data:holds:v1:"))'), false);
    } else if (name === 'activity') {
      await waitFor(sessionId, '!document.body.innerText.includes("توجد عملية قيد التحقق") && document.body.innerText.includes("الحساب متحقق")', 'Nonbinding original outcome resolves before binding');
      assert.equal(await evaluate(sessionId, 'location.pathname'), fixturePath);
      assert.equal(await evaluate(sessionId, 'Object.keys(sessionStorage).some(k => k.startsWith("wa-connections-data:holds:v1:"))'), false);
      assert.equal(state.intentReads, 2); assert.equal(state.arrivals, 0); assert.equal(state.listReads, 0);
      // A new binding review is now reachable; it is not submitted by the test.
      await click(sessionId, 'ربط الحساب التجريبي');
      await waitFor(sessionId, 'document.body.innerText.includes("راجع الطلب قبل تقديمه")', 'Binding remains available after activity resolution');
      assert.equal(state.followingBindingReviews, 1);
    } else {
      await waitFor(sessionId, 'document.body.innerText.includes("تعذر تأكيد الحالة الحالية")', 'Invalid continuation stays held');
      assert.equal(await evaluate(sessionId, 'location.pathname'), fixturePath);
      assert.equal(await evaluate(sessionId, 'document.body.innerText.includes("توجد عملية قيد التحقق")'), true);
      assert.equal(state.arrivals, 0); assert.equal(state.listReads, 0);
    }
    assert.equal(state.reviews, 1); assert.equal(state.submits, 1, 'never resubmit original binding');
    assert.equal(state.continuations, name === 'immediate' ? 0 : 1);
    assert(state.requests.every(request => request.path.endsWith('/')), 'real API client trailing slash requests observed');
    console.log('PASS mounted binding journey: ' + name + ' (review=1 submit=1 freshContinuation=' + state.continuations + ')');
    await cdp('Target.disposeBrowserContext', { browserContextId });
  }
} catch (error) {
  console.error(chromeErrors);
  throw error;
} finally {
  if (chrome) {
    const closed = chrome.exitCode === null ? once(chrome, 'close') : Promise.resolve();
    await cdp('Browser.close').catch(() => {});
    await Promise.race([closed, delay(5000)]);
    if (chrome.exitCode === null) { chrome.kill('SIGTERM'); await closed; }
  }
  for (const item of pending.values()) clearTimeout(item.timer);
  await server.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
