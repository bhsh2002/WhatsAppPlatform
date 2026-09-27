import test from 'node:test';
import assert from 'node:assert/strict';
import {
    installChunkLoadRecovery,
    moduleEntryFromHtml,
    recoverStaleChunk,
} from './chunkLoadRecovery.js';

const origin = 'https://wa.savana.ly';
const route = `${origin}/portal/inbox?channel=sms#conversation`;
const oldEntry = '/assets/index-old.js';
const newEntry = '/assets/index-new.js';
const html = (entry) => `<html><script defer src="https://analytics.savana.ly/script.js"></script>
    <script crossorigin src="${entry}" type="module"></script></html>`;

const createBrowser = ({ online = true, storage = true } = {}) => {
    const values = new Map();
    const handlers = new Map();
    let reloads = 0;
    const win = {
        navigator: { onLine: online },
        location: {
            origin,
            href: route,
            reload: () => { reloads += 1; },
        },
        sessionStorage: storage ? {
            getItem: key => values.get(key) ?? null,
            setItem: (key, value) => values.set(key, value),
        } : {
            getItem: () => { throw new Error('Storage denied'); },
        },
        addEventListener: (name, listener) => handlers.set(name, listener),
        removeEventListener: name => handlers.delete(name),
    };
    const doc = {
        querySelector: () => ({ getAttribute: () => oldEntry }),
    };
    return { win, doc, handlers, values, getReloads: () => reloads };
};

const responseFor = (entry) => async () => ({ ok: true, text: async () => html(entry) });

test('recognizes the same-origin Vite module entry independently of attribute order', () => {
    assert.equal(moduleEntryFromHtml(html(newEntry), route), `${origin}${newEntry}`);
    assert.equal(moduleEntryFromHtml(html('https://other.example/assets/index.js'), route), null);
    assert.equal(moduleEntryFromHtml('<script type="module" src="/api/messages"></script>', route), null);
});

test('reloads an old tab once for a new build without replacing its route', async () => {
    const browser = createBrowser();
    const requests = [];
    const request = async (url, options) => {
        requests.push({ url, options });
        return { ok: true, text: async () => html(newEntry) };
    };

    assert.equal(await recoverStaleChunk({ ...browser, request }), true);
    assert.equal(browser.getReloads(), 1);
    assert.equal(browser.win.location.href, route);
    assert.deepEqual(requests, [{
        url: `${origin}/index.html`,
        options: { cache: 'no-store', credentials: 'same-origin' },
    }]);

    assert.equal(await recoverStaleChunk({ ...browser, request }), false);
    assert.equal(browser.getReloads(), 1);
});

test('does not reload for the same build, offline state, or failed version check', async () => {
    const sameBuild = createBrowser();
    assert.equal(await recoverStaleChunk({ ...sameBuild, request: responseFor(oldEntry) }), false);
    assert.equal(sameBuild.getReloads(), 0);

    const offline = createBrowser({ online: false });
    let fetched = false;
    assert.equal(await recoverStaleChunk({
        ...offline,
        request: () => { fetched = true; throw new Error('offline'); },
    }), false);
    assert.equal(fetched, false);

    const networkFailure = createBrowser();
    assert.equal(await recoverStaleChunk({
        ...networkFailure,
        request: async () => { throw new Error('Connection reset'); },
    }), false);
    assert.equal(networkFailure.getReloads(), 0);
});

test('refuses an automatic reload when the session loop guard is unavailable', async () => {
    const browser = createBrowser({ storage: false });
    assert.equal(await recoverStaleChunk({ ...browser, request: responseFor(newEntry) }), false);
    assert.equal(browser.getReloads(), 0);
});

test('coalesces concurrent preload failures and leaves errors for the visible boundary', async () => {
    const browser = createBrowser();
    let resolveRequest;
    let fetches = 0;
    const request = () => {
        fetches += 1;
        return new Promise(resolve => { resolveRequest = resolve; });
    };
    const uninstall = installChunkLoadRecovery({ ...browser, request });
    const onError = browser.handlers.get('vite:preloadError');
    let prevented = false;
    onError({ preventDefault: () => { prevented = true; } });
    onError({ preventDefault: () => { prevented = true; } });
    assert.equal(fetches, 1);
    assert.equal(prevented, false);

    resolveRequest({ ok: true, text: async () => html(newEntry) });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(browser.getReloads(), 1);
    uninstall();
    assert.equal(browser.handlers.has('vite:preloadError'), false);
});
