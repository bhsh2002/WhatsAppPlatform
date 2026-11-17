import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import { browserReleaseStatus, createBrowserReleaseGuard } from '../middleware/browserRelease.js';

const release = 'a'.repeat(64);
const oldRelease = 'b'.repeat(64);

const fixture = async t => {
    const app = express();
    let mutations = 0;
    let seenMode;
    app.use(createBrowserReleaseGuard({ release }));
    app.use((req, res, next) => {
        seenMode = req.get('sec-fetch-mode');
        if (req.get('authorization') !== 'Bearer fixture-authorized') return res.sendStatus(401);
        return next();
    });
    app.post('/mutate', (_req, res) => { mutations += 1; res.json({ mutations }); });
    app.get('/read', (_req, res) => res.json({ mutations }));
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => server.close(resolve)));
    return { url: `http://127.0.0.1:${server.address().port}`, count: () => mutations, mode: () => seenMode };
};

test('browser mutations require the exact candidate release before any controller mutation', async t => {
    const f = await fixture(t);
    for (const headers of [
        { Origin: 'https://wa.example.test' },
        { Origin: 'null' },
        { Origin: '' },
        { 'Sec-Fetch-Site': 'same-origin' },
        { 'Sec-Fetch-Dest': 'empty' },
        { 'Sec-Fetch-User': '?1' },
        { Origin: 'https://wa.example.test', 'X-WA-Client-Release': oldRelease },
    ]) {
        const response = await fetch(`${f.url}/mutate`, {
            method: 'POST', headers: { Authorization: 'Bearer fixture-authorized', ...headers }, body: 'fixture',
        });
        assert.equal(response.status, 409);
        assert.equal((await response.json()).code, 'refresh_required');
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal(f.count(), 0);
    }
    const current = await fetch(`${f.url}/mutate`, { method: 'POST', headers: {
        Origin: 'https://wa.example.test', Authorization: 'Bearer fixture-authorized', 'X-WA-Client-Release': release,
    } });
    assert.equal(current.status, 200);
    assert.equal(f.count(), 1);
    const unauthorized = await fetch(`${f.url}/mutate`, { method: 'POST', headers: {
        Origin: 'https://wa.example.test', 'X-WA-Client-Release': release,
    } });
    assert.equal(unauthorized.status, 401);
    assert.equal(f.count(), 1);
});

test('Origin-less service, webhook and Node mode-only calls retain their authentication behavior', async t => {
    const f = await fixture(t);
    const nodeFetch = await fetch(`${f.url}/mutate`, { method: 'POST', headers: { Authorization: 'Bearer fixture-authorized' } });
    assert.equal(nodeFetch.status, 200);
    assert.equal(f.mode(), 'cors');
    assert.equal(f.count(), 1);
    const nativeStatus = await new Promise((resolve, reject) => {
        const request = http.request(`${f.url}/mutate`, { method: 'POST', headers: { Authorization: 'Bearer fixture-authorized' } }, response => {
            response.resume();
            response.once('end', () => resolve(response.statusCode));
        });
        request.once('error', reject);
        request.end();
    });
    assert.equal(nativeStatus, 200);
    const unauthorized = await fetch(`${f.url}/mutate`, { method: 'POST' });
    assert.equal(unauthorized.status, 401);
    assert.equal(f.count(), 2);
    const read = await fetch(`${f.url}/read`, { headers: { Origin: 'https://wa.example.test', Authorization: 'Bearer fixture-authorized' } });
    assert.equal(read.status, 200);
});

test('release negotiation defaults off and exposes only its public configuration', () => {
    assert.deepEqual(browserReleaseStatus({ release: '' }), { enabled: false, release: null });
    assert.deepEqual(browserReleaseStatus({ release }), { enabled: true, release });
    let continued = false;
    createBrowserReleaseGuard({ release: '' })({ method: 'POST', headers: { origin: 'null' } }, {}, () => { continued = true; });
    assert.equal(continued, true);
    assert.throws(() => createBrowserReleaseGuard({ release: 'old-head' }), /WA_BROWSER_RELEASE/);
    assert.throws(() => browserReleaseStatus({ release: release.toUpperCase() }), /WA_BROWSER_RELEASE/);
});
