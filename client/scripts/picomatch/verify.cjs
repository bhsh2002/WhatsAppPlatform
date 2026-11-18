#!/usr/bin/env node
'use strict';
// Dependency-free verifier. It never updates an approved inventory or a lockfile.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const os = require('node:os'), { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const fail = message => { throw new Error(message); };
const readJSON = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const inside = (root, p) => p === root || p.startsWith(root + path.sep);
function regular(p) { const s = fs.lstatSync(p); if (!s.isFile() || s.isSymbolicLink()) fail('regular_file_required:' + p); return s; }
function resolveWithin(root, rel) {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel)) fail('relative_path_required');
  const p = path.resolve(root, rel); if (!inside(root, p)) fail('path_outside_repository:' + rel);
  let check = p; while (!fs.existsSync(check)) check = path.dirname(check);
  if (!inside(root, fs.realpathSync(check))) fail('symlink_outside_repository:' + rel);
  return p;
}
function filesBelow(root, maxFiles = 5000, skipNestedModules = false) {
  const files = [];
  function walk(p) {
    for (const d of fs.readdirSync(p, { withFileTypes: true })) {
      if (skipNestedModules && d.name === 'node_modules') continue;
      const q = path.join(p, d.name); if (d.isSymbolicLink()) fail('symlink_not_supported:' + q);
      if (d.isDirectory()) walk(q); else if (d.isFile()) files.push(q);
      if (files.length > maxFiles) fail('inventory_file_budget');
    }
  }
  walk(root); return files.sort();
}
function runtimePackages(packageRoot) {
  const result = []; let count = 0;
  function walk(nm) {
    if (!fs.existsSync(nm)) return;
    if (fs.lstatSync(nm).isSymbolicLink()) fail('node_modules_symlink_not_supported');
    for (const d of fs.readdirSync(nm, { withFileTypes: true })) {
      if (d.name.startsWith('.')) continue;
      if (d.isSymbolicLink()) fail('package_symlink_not_supported:' + d.name);
      if (!d.isDirectory()) continue;
      const p = path.join(nm, d.name);
      const packages = d.name.startsWith('@') ? fs.readdirSync(p).map(n => path.join(p, n)) : [p];
      for (const q of packages) {
        if (fs.lstatSync(q).isSymbolicLink()) fail('scoped_package_symlink_not_supported:' + q);
        const pp = path.join(q, 'package.json'); if (!fs.existsSync(pp)) continue;
        regular(pp); if (++count > 2000) fail('runtime_package_budget');
        result.push({ root: q, manifest: readJSON(pp) }); walk(path.join(q, 'node_modules'));
      }
    }
  }
  walk(path.join(packageRoot, 'node_modules')); return result;
}
function collectInventory(config, root, packageRoot, packages) {
  const selected = new Set(), scan = /\bpicomatch\b|\bassetsInclude\b|\bbindingifyRegex\b/;
  const add = p => { regular(p); if (!inside(root, fs.realpathSync(p))) fail('inventory_external_file'); selected.add(p); };
  for (const f of config.inventory.files) add(resolveWithin(root, f));
  for (const name of fs.readdirSync(packageRoot)) if (/^(vite|vitest|postcss|tailwind)(?:\.|-).*\.[cm]?[jt]s$/.test(name)) add(path.join(packageRoot, name));
  const versions = {}, directConsumers = [];
  for (const pkg of packages) {
    const m = pkg.manifest;
    if (['dependencies', 'optionalDependencies', 'peerDependencies'].some(k => m[k]?.[config.owned.alias])) directConsumers.push(m.name);
  }
  const wanted = new Set([...Object.keys(config.inventory.consumerPackages), ...directConsumers]);
  for (const name of wanted) {
    const matches = packages.filter(p => p.manifest.name === name);
    if (!matches.length) fail('missing_consumer_package:' + name);
    versions[name] = matches.map(p => p.manifest.version).sort();
    const expected = config.inventory.consumerPackages[name];
    if (expected && matches.some(p => p.manifest.version !== expected)) fail('consumer_version_changed:' + name);
    for (const pkg of matches) {
      add(path.join(pkg.root, 'package.json'));
      for (const p of filesBelow(pkg.root, 5000, true)) {
        if (!/\.[cm]?[jt]sx?$/.test(p)) continue;
        if (regular(p).size > 4 * 1024 * 1024) fail('consumer_file_size_budget');
        if (scan.test(fs.readFileSync(p, 'utf8'))) add(p);
      }
    }
  }
  for (const dir of config.inventory.scanRoots || []) for (const p of filesBelow(resolveWithin(root, dir))) {
    if (/\.[cm]?[jt]sx?$/.test(p) && scan.test(fs.readFileSync(p, 'utf8'))) add(p);
  }
  // Repository-level proof/config scripts may deliberately createRequire from
  // the nested frontend package. Record that reviewed context explicitly;
  // never invent a root dependency or silently remap a real package consumer.
  const resolutionAnchors = {};
  for (const [file, anchor] of Object.entries(config.inventory.resolutionAnchors || {}).sort()) {
    const source = resolveWithin(root, file), target = resolveWithin(root, anchor);
    if (!selected.has(source) || !/\.[cm]?[jt]sx?$/.test(file)) fail('resolution_anchor_source_not_in_inventory:' + file);
    if (inside(packageRoot, source)) fail('package_consumer_must_resolve_from_own_file:' + file);
    add(target);
    resolutionAnchors[path.relative(root, source).split(path.sep).join('/')] = path.relative(root, target).split(path.sep).join('/');
  }
  const files = {};
  for (const p of [...selected].sort()) {
    const b = fs.readFileSync(p), rel = path.relative(root, p).split(path.sep).join('/');
    files[rel] = { bytes: b.length, sha256: sha(b) };
    if (/\.[cm]?[jt]sx?$/.test(p)) {
      const text = b.toString(); const re = /["']picomatch\/([^"']+)["']/g; let m;
      while ((m = re.exec(text))) if (m[1] !== 'posix') fail('consumer_deep_import:' + rel + ':' + m[1]);
    }
  }
  return { format: 'savana-picomatch-consumer-inventory/1', consumerVersions: versions, directConsumers: [...new Set(directConsumers)].sort(), ...(Object.keys(resolutionAnchors).length ? { resolutionAnchors } : {}), files };
}
function npmProof(packageRoot, deadline) {
  const executable = (process.env.PATH || '').split(path.delimiter).map(p => path.join(p, process.platform === 'win32' ? 'npm.cmd' : 'npm')).find(p => fs.existsSync(p));
  if (!executable || process.platform === 'win32') fail('native_npm_cli_required');
  const cli = fs.realpathSync(executable), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'picomatch-verifier-')); fs.chmodSync(temp, 0o700);
  try {
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^npm_config_/i.test(k)));
    for (const k of ['user', 'global']) { const p = path.join(temp, k + '.npmrc'); fs.writeFileSync(p, '', { mode: 0o600 }); env['npm_config_' + k + 'config'] = p; }
    Object.assign(env, { NODE_OPTIONS: '', npm_config_offline: 'true', npm_config_force: 'false', npm_config_legacy_peer_deps: 'false' });
    const args = ['ls', '--all', '--include=dev', '--include=optional', '--include=peer', '--strict-peer-deps', '--json'];
    const p = spawnSync(process.execPath, [cli, ...args], { cwd: packageRoot, env, encoding: 'utf8', timeout: deadline, maxBuffer: 4 * 1024 * 1024, killSignal: 'SIGKILL' });
    if (p.error || p.status !== 0) fail('strict_npm_ls_failed');
    const tree = JSON.parse(p.stdout), problems = [];
    function visit(t) { problems.push(...(t.problems || [])); for (const v of Object.values(t.dependencies || {})) visit(v); } visit(tree);
    if (problems.length) fail('strict_npm_ls_problems');
    return { node: process.version, npm: readJSON(path.resolve(path.dirname(cli), '../package.json')).version, args, exitCode: p.status, problems, stdoutSHA256: sha(p.stdout) };
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
function memoryEvidence(maximum) {
  if (!Number.isSafeInteger(maximum) || maximum < 64 * 1024 * 1024 || maximum > 4 * 1024 * 1024 * 1024) fail('CI_memory_limit_config_required_64MiB_to_4GiB');
  const values = [], paths = ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes'];
  if (process.platform === 'linux' && fs.existsSync('/proc/self/cgroup')) for (const line of fs.readFileSync('/proc/self/cgroup', 'utf8').trim().split('\n')) {
    const m = line.match(/^\d+:([^:]*):(\/.*)$/); if (!m || m[1] && !m[1].split(',').includes('memory')) continue;
    const base = m[1] ? '/sys/fs/cgroup/memory' : '/sys/fs/cgroup'; let p = path.resolve(base, '.' + m[2]);
    while (inside(base, p)) { paths.push(path.join(p, m[1] ? 'memory.limit_in_bytes' : 'memory.max')); if (p === base) break; p = path.dirname(p); }
  }
  for (const p of [...new Set(paths)]) if (fs.existsSync(p)) { const v = fs.readFileSync(p, 'utf8').trim(); if (/^\d+$/.test(v) && Number(v) < 2 ** 60) values.push(Number(v)); }
  const bytes = values.length ? Math.min(...values) : null;
  return { finiteCgroupLimitBytes: bytes, configuredMaximumBytes: maximum, verified: bytes !== null && bytes <= maximum, requiredInCI: true };
}
function run(argv = process.argv.slice(2)) {
  const args = {}; for (let i = 0; i < argv.length; i += 2) { if (!['--config', '--capture-inventory', '--report', '--mode'].includes(argv[i]) || !argv[i + 1]) fail('usage: --config FILE [--capture-inventory CANDIDATE|--report NEW_REPORT] [--mode inspect]'); args[argv[i]] = argv[i + 1]; }
  if (!args['--config'] || args['--capture-inventory'] && args['--report']) fail('invalid_arguments');
  if (args['--mode'] && args['--mode'] !== 'inspect') fail('unknown_mode');
  const inCI = !!process.env.CI && process.env.CI !== 'false';
  if (inCI && (args['--mode'] || args['--capture-inventory'])) fail('CI_requires_normal_mandatory_gate');
  const cp = path.resolve(args['--config']); regular(cp); const c = readJSON(cp), base = path.dirname(cp);
  if (c.format !== 'savana-picomatch-verifier/1') fail('unsupported_config_format');
  const root = fs.realpathSync(path.resolve(base, c.repoRoot)), pr = resolveWithin(root, c.packageRoot);
  const packages = runtimePackages(pr), current = collectInventory(c, root, pr, packages), snapshot = resolveWithin(root, c.inventory.snapshot);
  if (args['--capture-inventory']) {
    const candidate = resolveWithin(root, path.relative(root, path.resolve(base, args['--capture-inventory']))); if (candidate === snapshot) fail('candidate_must_be_new_and_distinct_from_approved_snapshot');
    fs.writeFileSync(candidate, JSON.stringify(current, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return { candidateOnly: true, approved: false, file: path.relative(root, candidate), files: Object.keys(current.files).length };
  }
  const issues = [], check = (ok, code) => { if (!ok) issues.push(code); };
  check(JSON.stringify(current) === JSON.stringify(readJSON(snapshot)), 'consumer_inventory_changed_requires_review');
  const archive = resolveWithin(root, c.archive.path), mb = fs.readFileSync(resolveWithin(root, c.manifest.path)), manifest = JSON.parse(mb), ab = fs.readFileSync(archive);
  check(sha(ab) === c.archive.sha256, 'archive_sha256_mismatch'); check('sha512-' + crypto.createHash('sha512').update(ab).digest('base64') === c.archive.sri, 'archive_sri_mismatch');
  check(sha(mb) === c.manifest.sha256, 'manifest_sha256_mismatch'); check(Number.isSafeInteger(c.manifest.fileCount) && c.manifest.fileCount > 0 && manifest.files.length === c.manifest.fileCount, 'frozen_file_count_mismatch');
  const alias = path.join(pr, 'node_modules', c.owned.alias), owned = packages.filter(p => p.manifest.name === c.owned.name), upstream = packages.filter(p => p.manifest.name === 'picomatch');
  check(owned.length === 1 && owned[0]?.root === alias, 'exactly_one_owned_alias_required'); check(upstream.length === 0, 'upstream_runtime_package_present');
  const installed = readJSON(path.join(alias, 'package.json')); check(installed.name === c.owned.name && installed.version === c.owned.version, 'installed_identity_mismatch');
  const expectedFiles = manifest.files.map(f => f.path).sort(), actualFiles = filesBelow(alias).map(p => path.relative(alias, p).split(path.sep).join('/')).sort();
  check(JSON.stringify(expectedFiles) === JSON.stringify(actualFiles), 'installed_file_set_mismatch');
  for (const f of manifest.files) { const p = resolveWithin(alias, f.path); regular(p); const b = fs.readFileSync(p); check(b.length === f.bytes && sha(b) === f.sha256, 'installed_hash_mismatch:' + f.path); }
  const lock = readJSON(path.join(pr, 'package-lock.json')), pmEntries = Object.entries(lock.packages || {}).filter(([k]) => k.endsWith('node_modules/' + c.owned.alias));
  check(pmEntries.length === 1 && pmEntries[0][1].name === c.owned.name && pmEntries[0][1].version === c.owned.version && pmEntries[0][1].integrity === c.archive.sri, 'lock_owned_alias_mismatch');
  const localArchive = spec => typeof spec === 'string' && spec.startsWith('file:') && !path.isAbsolute(spec.slice(5)) && path.resolve(pr, spec.slice(5)) === archive;
  check(pmEntries.length === 1 && localArchive(pmEntries[0][1].resolved), 'lock_archive_path_mismatch');
  const intent = readJSON(path.join(pr, 'package.json'));
  check(localArchive(intent.devDependencies?.[c.owned.alias] || intent.dependencies?.[c.owned.alias]) && intent.overrides?.[c.owned.alias] === '$' + c.owned.alias, 'direct_local_override_required');
  const rq = createRequire(path.join(pr, 'package.json')), entry = rq.resolve(c.owned.alias); check(inside(alias, entry), 'root_alias_resolves_outside_owned_package');
  for (const file of Object.keys(current.files)) if (/\.[cm]?[jt]sx?$/.test(file)) {
    const source = resolveWithin(root, file);
    const anchor = inside(pr, source) ? source : current.resolutionAnchors?.[file] && resolveWithin(root, current.resolutionAnchors[file]);
    if (!anchor) { issues.push('resolution_anchor_required_for_repository_script:' + file); continue; }
    try { check(inside(alias, createRequire(anchor).resolve(c.owned.alias)), 'consumer_alias_resolution_mismatch:' + file); }
    catch { issues.push('consumer_alias_resolution_failed:' + file); }
  }
  for (const suffix of ['lib/picomatch.js', 'lib/parse.js', 'lib/scan.js', 'upstream/index.js', 'package.json']) {
    let blocked = false; try { rq.resolve(c.owned.alias + '/' + suffix); } catch (e) { blocked = ['ERR_PACKAGE_PATH_NOT_EXPORTED', 'MODULE_NOT_FOUND'].includes(e.code); } check(blocked, 'deep_import_resolvable:' + suffix);
  }
  check(c.tracking?.advisory === 'GHSA-fc5q-39xc-vjpf' && c.tracking.embeddedEnginePatched === false && c.tracking.upstreamVersion === '4.0.5', 'embedded_engine_tracking_required');
  if (process.env.NODE_OPTIONS) issues.push('nonempty_NODE_OPTIONS_unsupported');
  if (issues.length) return { passed: false, phase: 'static', issues, codeExecuted: false };
  // This pure, already hash-checked module creates no Worker. Check THIS process,
  // rather than allowing a clean proof subprocess to hide its parent heap flags.
  require(path.join(alias, 'heap-flags.cjs'))();
  const npm = npmProof(pr, Math.min(c.limits?.npmDeadlineMilliseconds || 30000, 60000));
  const memory = memoryEvidence(c.limits?.maxCIMemoryLimitBytes);
  if (args['--mode'] === 'inspect') return { format: 'savana-picomatch-inspection/1', staticChecksPassed: true, mandatoryGatePassed: false, diagnosticOnly: true, identity: { name: c.owned.name, version: c.owned.version, archiveSHA256: c.archive.sha256, manifestSHA256: c.manifest.sha256, frozenFiles: manifest.files.length, ownedAliasCopies: owned.length, runtimeUpstreamPackages: upstream.length }, inventoryFiles: Object.keys(current.files).length, npm, memory, proofExecuted: false };
  if (!memory.verified) fail('finite_cgroup_memory_limit_required_for_normal_proof');
  const proof = resolveWithin(root, c.proof.entry), deadline = c.limits?.proofDeadlineMilliseconds;
  if (!Number.isInteger(deadline) || deadline < 1000 || deadline > 20000) fail('proof_deadline_required_1000_to_20000ms');
  regular(proof); check(sha(fs.readFileSync(proof)) === c.proof.sha256, 'proof_entry_hash_mismatch'); if (issues.length) return { passed: false, phase: 'proof-integrity', issues };
  const p = spawnSync(process.execPath, [proof, '--package-root', pr], { cwd: root, env: { ...process.env }, encoding: 'utf8', timeout: deadline, maxBuffer: 256 * 1024, killSignal: 'SIGKILL' });
  let evidence; try { evidence = JSON.parse(p.stdout); } catch {}
  check(!p.error && p.status === 0 && evidence?.passed === true, 'bounded_proof_failed');
  const result = { format: 'savana-picomatch-verification/1', passed: issues.length === 0, node: process.version, identity: { name: c.owned.name, version: c.owned.version, archiveSHA256: c.archive.sha256, manifestSHA256: c.manifest.sha256, frozenFiles: manifest.files.length }, inventoryFiles: Object.keys(current.files).length, npm, memory, proof: evidence || { exitCode: p.status, signal: p.signal, error: p.error?.code }, issues, embeddedEnginePatched: false, adoptionAccepted: false };
  if (args['--report']) { const p = resolveWithin(root, path.relative(root, path.resolve(base, args['--report']))); fs.writeFileSync(p, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
  return result;
}
module.exports = { run, collectInventory, runtimePackages };
if (require.main === module) { try { const r = run(); console.log(JSON.stringify(r, null, 2)); process.exitCode = r.passed === false ? 1 : 0; } catch (e) { console.log(JSON.stringify({ passed: false, error: e.message })); process.exitCode = 1; } }
