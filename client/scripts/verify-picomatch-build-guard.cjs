'use strict';
// Source-owned entry point. All executable proof inputs are exact reviewed R3
// bytes. No environment variable or CLI flag can select an alternative config.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const pins = {
    'scripts/picomatch/verify.cjs': 'd19518181a4cfc657fa6c3aba4c9e0d0602c6fda1ed1053947e608867d70b79d',
    'scripts/picomatch/bounded-proof.cjs': '73a070b909148c8a7d1c3ddb037c0d4e104d902a226f72b321167d767213570a',
    'vendor/picomatch-build-guard-manifest.json': '592e6f9cd1075286f48d4381ddf7b4d7a325e0048ef3f4d2b78e0f15818377a6',
    'vendor/picomatch-build-guard-portable-r3-files.json': '6516a5836d3c14db53daf3727052ecaa1005b3cd8bff04637ccdccdaa0e6938a',
};
const fail = code => { throw new Error(code); };
const regular = file => {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(file) !== path.resolve(file)) fail('guard_regular_file_required');
    return fs.readFileSync(file);
};
function frozenInputs(root) {
    for (const [file, digest] of Object.entries(pins)) {
        if (sha(regular(path.join(root, file))) !== digest) fail('guard_reviewed_source_changed');
    }
    const manifest = JSON.parse(regular(path.join(root, 'vendor/picomatch-build-guard-manifest.json')));
    const directory = path.join(root, 'vendor/picomatch-build-guard'); const files = [];
    const walk = parent => {
        for (const item of fs.readdirSync(parent, { withFileTypes: true })) {
            const file = path.join(parent, item.name);
            if (item.isSymbolicLink()) fail('guard_review_source_symlink');
            if (item.isDirectory()) walk(file);
            else if (item.isFile()) files.push(path.relative(directory, file).split(path.sep).join('/'));
            else fail('guard_regular_file_required');
        }
    };
    walk(directory);
    if (JSON.stringify(files.sort()) !== JSON.stringify(manifest.files.map(row => row.path).sort())) fail('guard_review_file_set_changed');
    for (const row of manifest.files) {
        const bytes = regular(path.join(directory, row.path));
        if (bytes.length !== row.bytes || sha(bytes) !== row.sha256) fail('guard_review_file_changed');
    }
}
function run(argv = process.argv.slice(2), root = path.resolve(__dirname, '..')) {
    if (argv.length && JSON.stringify(argv) !== JSON.stringify(['--mode', 'inspect'])) fail('guard_fixed_entry_arguments_required');
    frozenInputs(root);
    return require(path.join(root, 'scripts/picomatch/verify.cjs')).run([
        '--config', path.join(root, 'vendor/picomatch-build-guard-verifier.json'), ...argv,
    ]);
}
module.exports = { run, frozenInputs };
if (require.main === module) {
    try { const result = run(); console.log(JSON.stringify(result, null, 2)); process.exitCode = result.passed === false ? 1 : 0; }
    catch (error) { console.error(JSON.stringify({ passed: false, code: error.message })); process.exitCode = 1; }
}
