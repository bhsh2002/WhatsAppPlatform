'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { frozenInputs, run } = require('./verify-picomatch-build-guard.cjs');
const { collectInventory, runtimePackages } = require('./picomatch/verify.cjs');
const root = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'vendor/picomatch-build-guard-verifier.json')));
function fixture(t) {
    const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wa-guard-public-fixture-')));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'vendor/picomatch-build-guard-manifest.json')));
    const files = ['scripts/picomatch/verify.cjs', 'scripts/picomatch/bounded-proof.cjs',
        'vendor/picomatch-build-guard-manifest.json', 'vendor/picomatch-build-guard-portable-r3-files.json',
        ...manifest.files.map(row => 'vendor/picomatch-build-guard/' + row.path)];
    // Only the small public reviewed source inputs, no application/dependency tree.
    for (const file of files) {
        const target = path.join(directory, file); fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(path.join(root, file), target);
    }
    return directory;
}

test('source entry pins exact R3 verifier/proof and all immutable review files without running a Worker', () => {
    assert.doesNotThrow(() => frozenInputs(root));
});

test('source/code/manifest drift, missing or extra vendor files and symlink inputs fail before executable gate code', async t => {
    for (const kind of ['code', 'manifest', 'review', 'missing', 'extra', 'symlink']) await t.test(kind, t => {
        const directory = fixture(t);
        if (kind === 'code') fs.appendFileSync(path.join(directory, 'scripts/picomatch/verify.cjs'), '\n// unreviewed\n');
        if (kind === 'manifest') fs.appendFileSync(path.join(directory, 'vendor/picomatch-build-guard-manifest.json'), ' ');
        if (kind === 'review') fs.appendFileSync(path.join(directory, 'vendor/picomatch-build-guard/codec.cjs'), '\n');
        if (kind === 'missing') fs.unlinkSync(path.join(directory, 'vendor/picomatch-build-guard/worker.cjs'));
        if (kind === 'extra') fs.writeFileSync(path.join(directory, 'vendor/picomatch-build-guard/extra.cjs'), 'unreviewed');
        if (kind === 'symlink') {
            const file = path.join(directory, 'vendor/picomatch-build-guard/codec.cjs'); fs.unlinkSync(file);
            fs.symlinkSync(path.join(root, 'vendor/picomatch-build-guard/codec.cjs'), file);
        }
        assert.throws(() => frozenInputs(directory));
    });
});

test('mandatory entry refuses caller config, inventory capture and report-mode argument substitutions', () => {
    for (const args of [['--config', '/untrusted'], ['--capture-inventory', 'approved.json'],
        ['--mode', 'inspect', '--report', 'anything'], ['--mode', 'normal']]) {
        assert.throws(() => run(args, '/does-not-exist'), /guard_fixed_entry_arguments_required/);
    }
});

test('reviewed actual consumer/config inventory matches the installed graph and keeps resolution within this client context', () => {
    const actual = collectInventory(config, root, root, runtimePackages(root));
    assert.deepEqual(actual, JSON.parse(fs.readFileSync(path.join(root, config.inventory.snapshot))));
    assert.deepEqual(actual.directConsumers, ['fdir', 'tinyglobby', 'vite']);
    assert.equal(Object.keys(actual.files).some(file => file.startsWith('src/')), false);
    assert.equal(actual.files['scripts/picomatch/bounded-proof.cjs'].sha256, config.proof.sha256);
    assert.throws(() => collectInventory({ ...config, inventory: { ...config.inventory,
        consumerPackages: { ...config.inventory.consumerPackages, vite: '0.0.0-unreviewed' } } }, root, root, runtimePackages(root)), /consumer_version_changed:vite/);
});

test('new private matcher import and attempts to remap a package consumer are review failures', t => {
    const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wa-guard-static-policy-')));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'consumer.cjs'); fs.writeFileSync(file, 'require("picomatch/upstream/index.js");');
    const minimal = { owned: { alias: 'picomatch' }, inventory: { files: ['consumer.cjs'], consumerPackages: {}, scanRoots: [] } };
    assert.throws(() => collectInventory(minimal, directory, directory, []), /consumer_deep_import/);
    fs.writeFileSync(file, 'require("picomatch");');
    assert.throws(() => collectInventory({ ...minimal, inventory: { ...minimal.inventory,
        resolutionAnchors: { 'consumer.cjs': 'consumer.cjs' } } }, directory, directory, []), /package_consumer_must_resolve_from_own_file/);
});
