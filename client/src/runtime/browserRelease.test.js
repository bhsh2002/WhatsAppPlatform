import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { createBrowserReleaseFetch, installBrowserRelease } from './browserRelease.js'

const release = 'a'.repeat(64)
const locationHref = 'https://wa.example.test/portal/inbox'
const harness = options => {
  const calls = []
  const response = new Response(JSON.stringify({ code: 'refresh_required' }), { status: 409 })
  const original = (...args) => { calls.push(args); return Promise.resolve(response) }
  return { calls, original, response, fetch: createBrowserReleaseFetch(original, { release, locationHref, ...options }) }
}

test('own API JSON mutations preserve headers, payload, credentials and return409 without replay', async () => {
  const f = harness()
  const headers = new Headers({ Authorization: 'Bearer fixture', 'Content-Type': 'application/json', 'X-Other': 'keep' })
  const init = { method: 'POST', headers, body: '{"fixture":true}', credentials: 'include', cache: 'no-store' }
  const response = await f.fetch('/api/messages/send', init)
  assert.equal(response, f.response)
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0][0], '/api/messages/send')
  const actual = f.calls[0][1]
  assert.equal(actual.headers.get('X-WA-Client-Release'), release)
  assert.equal(actual.headers.get('authorization'), 'Bearer fixture')
  assert.equal(actual.headers.get('content-type'), 'application/json')
  assert.equal(actual.headers.get('x-other'), 'keep')
  assert.equal(actual.body, init.body)
  assert.equal(actual.credentials, 'include')
  assert.equal(actual.cache, 'no-store')
  assert.equal(actual.redirect, 'error')
  assert.equal(headers.has('X-WA-Client-Release'), false)
  assert.equal(init.redirect, undefined)
})

test('Request inputs retain their original body and credentials, with native init header precedence', async () => {
  const f = harness()
  const request = new Request('https://wa.example.test/api/portal/messages/send', {
    method: 'POST', headers: { Authorization: 'Bearer original', 'X-Original': 'value' },
    credentials: 'include', body: 'request-body', redirect: 'manual',
  })
  await f.fetch(request)
  assert.equal(f.calls[0][0], request)
  assert.equal(request.bodyUsed, false)
  assert.equal(request.credentials, 'include')
  assert.equal(f.calls[0][1].credentials, undefined)
  assert.equal(f.calls[0][1].body, undefined)
  assert.equal(f.calls[0][1].headers.get('authorization'), 'Bearer original')
  assert.equal(f.calls[0][1].headers.get('x-original'), 'value')
  assert.equal(f.calls[0][1].redirect, 'manual')
  const native = await new Request(request, f.calls[0][1]).text()
  assert.equal(native, 'request-body')
  const override = new Request('https://wa.example.test/api/portal/messages/send', {
    method: 'POST', headers: { 'X-Original': 'must-be-replaced' }, body: 'old-body', credentials: 'same-origin',
  })
  await f.fetch(override, { headers: [['X-Override', 'new']], body: 'override-body', credentials: 'omit', redirect: 'error' })
  const actual = f.calls[1][1]
  assert.equal(actual.headers.get('X-Override'), 'new')
  assert.equal(actual.headers.has('X-Original'), false)
  assert.equal(actual.body, 'override-body')
  assert.equal(actual.credentials, 'omit')
  assert.equal(actual.redirect, 'error')
  assert.equal(override.bodyUsed, false)
})

test('multipart uploads retain the exact FormData body and native boundary generation', async () => {
  const f = harness()
  const body = new FormData()
  body.append('source', new Blob(['fixture'], { type: 'text/plain' }), 'fixture.txt')
  await f.fetch(new URL('/api/portal/media/upload-to-meta', locationHref), {
    method: 'POST', body, credentials: 'include', headers: { Authorization: 'Bearer fixture' },
  })
  const actual = f.calls[0][1]
  assert.equal(actual.body, body)
  assert.equal(actual.headers.has('content-type'), false)
  assert.equal(actual.headers.get('X-WA-Client-Release'), release)
  const native = new Request(f.calls[0][0], actual)
  assert.match(native.headers.get('content-type'), /^multipart\/form-data; boundary=/)
  assert.match(await native.text(), /fixture.txt/)
})

test('third-party, lookalike paths, static assets and other schemes receive no added header', async () => {
  const f = harness()
  for (const url of [
    'https://graph.facebook.com/api/messages', 'https://wa.example.test.evil.test/api/send',
    'https://analytics.example.test/api/events', '/api-other/send', '/assets/api/file',
    'https://user:pass@wa.example.test/api/send', 'data:text/plain,fixture',
  ]) {
    const init = { method: 'POST', body: 'fixture', credentials: 'omit', headers: { 'X-Other': 'keep' } }
    await f.fetch(url, init)
    assert.equal(f.calls.at(-1)[0], url)
    assert.equal(f.calls.at(-1)[1], init)
    assert.equal(new Headers(init.headers).has('X-WA-Client-Release'), false)
  }
})

test('explicit API origin and path receive the release only inside their exact scope', async () => {
  const f = harness({ apiBase: 'https://api.example.test/native/' })
  await f.fetch('https://api.example.test/native/api/messages', { method: 'PATCH', body: 'fixture' })
  assert.equal(f.calls[0][1].headers.get('X-WA-Client-Release'), release)
  for (const url of ['https://api.example.test/api/messages', 'https://wa.example.test/native/api/messages', 'https://api.example.test/native/api-other']) {
    await f.fetch(url, { method: 'POST' })
    assert.equal(f.calls.at(-1)[1].headers, undefined)
  }
})

test('default off leaves fetch untouched and installation freezes the page release', () => {
  const f = harness({ release: '' })
  assert.equal(f.fetch, f.original)
  const target = { fetch: f.original, location: { href: locationHref } }
  assert.deepEqual(installBrowserRelease({ target, release: '' }), { enabled: false, release: null })
  assert.equal(target.fetch, f.original)
  assert.deepEqual(installBrowserRelease({ target, release }), { enabled: true, release })
  const first = target.fetch
  assert.deepEqual(installBrowserRelease({ target, release: 'b'.repeat(64) }), { enabled: true, release })
  assert.equal(target.fetch, first)
  assert.throws(() => createBrowserReleaseFetch(f.original, { release: 'old-head', locationHref }), /VITE_WA_CLIENT_RELEASE/)
})

test('bootstrap evaluates the release installer before existing application imports', () => {
  const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
  const bootstrap = fs.readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8')
  const installer = fs.readFileSync(new URL('./browserReleaseBootstrap.js', import.meta.url), 'utf8')
  assert.match(html, /src="\/src\/bootstrap\.js"/)
  assert.ok(bootstrap.indexOf("import './runtime/browserReleaseBootstrap.js'") < bootstrap.indexOf("import './main.jsx'"))
  assert.match(installer, /VITE_WA_CLIENT_RELEASE/)
  assert.match(installer, /VITE_API_URL/)
})
