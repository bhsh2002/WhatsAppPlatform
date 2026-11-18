#!/usr/bin/env node
'use strict';
// Run only inside the source owner's externally time/memory-limited CI job.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const i = process.argv.indexOf('--package-root'), root = i >= 0 && process.argv[i + 1];
if (!root) throw Error('--package-root required');
const script = `const{createRequire}=require('node:module');const path=require('node:path');const threads=require('node:worker_threads');let started=0,exited=0,limits;const Native=threads.Worker;threads.Worker=class extends Native{constructor(...args){started++;super(...args);limits=this.resourceLimits;this.once('exit',()=>exited++);}};(async()=>{let p;try{p=createRequire(path.join(process.argv[1],'package.json'))('picomatch');if(process.argv[2]==='deny')throw Error('unexpected_start');if(!p.isMatch('src/a.ts','**/*.ts'))throw Error('normal_match_failed');let patternRejected=false;try{p.isMatch('a','x'.repeat(4097));}catch(e){patternRejected=e instanceof RangeError&&e.message==='PICOMATCH_PATTERN_LIMIT';}if(!patternRejected)throw Error('pattern_limit_missing');let outcome;try{p.isMatch('a'.repeat(48)+'!','+(*a)');throw Object.assign(Error('unexpected_poc_return'),{code:'PICOMATCH_UNEXPECTED_POC_RETURN'});}catch(e){if(e.code!=='PICOMATCH_OPERATION_DEADLINE')throw e;outcome=e.code;}let reuseError;try{p.isMatch('a','*');}catch(e){reuseError=e.code;}await p.buildGuard.close();await new Promise(r=>setImmediate(r));const stats=p.buildGuard.stats();process.stdout.write(JSON.stringify({passed:started===1&&exited===1&&limits.maxOldGenerationSizeMb===64&&limits.maxYoungGenerationSizeMb===16&&outcome==='PICOMATCH_OPERATION_DEADLINE'&&stats.timeouts===1&&stats.workerExited===true&&reuseError==='PICOMATCH_OPERATION_DEADLINE',started,exited,limits,patternRejected,outcome,timeouts:stats.timeouts,reuseError,workerExited:stats.workerExited===true}));}catch(e){if(p)await p.buildGuard.close();process.stdout.write(JSON.stringify({passed:process.argv[2]==='deny'&&e.code==='PICOMATCH_WORKER_HEAP_FLAGS_UNSUPPORTED'&&started===0,started,exited,errorCode:e.code||'unexpected_error'}));}})().catch(()=>process.exit(2));`;
const cases = [
  { name: 'bounded_match_and_worker_exit', args: [], nodeOptions: '', mode: 'normal', timeout: 6000 },
  { name: 'nonempty_NODE_OPTIONS_denied_before_worker', args: [], nodeOptions: '--trace-warnings', mode: 'deny', timeout: 3000 },
  { name: 'CLI_heap_denied_before_worker', args: ['--max-old-space-size=128'], nodeOptions: '', mode: 'deny', timeout: 3000 },
];
const checks = [];
for (const c of cases) {
  const p = spawnSync(process.execPath, [...c.args, '-e', script, root, c.mode], { env: { PATH: process.env.PATH || '', NODE_OPTIONS: c.nodeOptions, LANG: 'C' }, encoding: 'utf8', timeout: c.timeout, maxBuffer: 65536, killSignal: 'SIGKILL' });
  let value; try { value = JSON.parse(p.stdout); } catch {}
  checks.push({ name: c.name, passed: !p.error && p.status === 0 && value?.passed === true, deadlineMilliseconds: c.timeout, result: value || { exitCode: p.status, signal: p.signal, error: p.error?.code } });
}
const result = { format: 'savana-picomatch-bounded-proof/1', node: process.version, passed: checks.every(c => c.passed), checks, requiresExternalCIMemoryLimit: true, nativeSourceHandoffAccepted: false };
console.log(JSON.stringify(result)); process.exitCode = result.passed ? 0 : 1;
