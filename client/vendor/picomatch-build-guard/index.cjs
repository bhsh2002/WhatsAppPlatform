'use strict';
require('./heap-flags.cjs')();
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const codec = require('./codec.cjs');
const { types } = require('node:util');
const headerMemory = new SharedArrayBuffer(8);
const dataMemory = new SharedArrayBuffer(codec.MAX_BYTES);
const header = new Int32Array(headerMemory);
const memory = new Uint8Array(dataMemory);
const remoteFunctions = new WeakMap();
const remoteRegexes = new WeakMap();
const remoteStates = new WeakMap();
const nativeRegexIds = new WeakMap();
const nativeRegexes = new Map();
const cache = new Map();
const guardedRegexConstruction = Symbol('private guarded RegExp construction');
const stats = { calls: 0, callbacks: 0, timeouts: 0 };
let nextRegex = 1;
let busy = false;
let poison = null;
let terminationPromise = null;

class PicomatchBuildBudgetError extends Error {
  constructor(code) { super(code); this.name = 'PicomatchBuildBudgetError'; this.code = code; }
}

const worker = new Worker(path.join(__dirname, 'worker.cjs'), {
  workerData: { header: headerMemory, memory: dataMemory },
  env: { PATH: process.env.PATH || '', LANG: 'C', LC_ALL: 'C' },
  resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 }
});
worker.unref();
worker.on('error', () => { poison = 'PICOMATCH_WORKER_FAILED'; });
worker.once('exit', code => { stats.workerExited = true; stats.workerExitCode = code; });

function terminateOwnedWorker() {
  if (!terminationPromise) terminationPromise = worker.terminate();
  return terminationPromise;
}

function regexIndex(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new PicomatchBuildBudgetError('PICOMATCH_REGEX_LASTINDEX_UNSUPPORTED');
  }
  return value;
}

function write(state, value) {
  const bytes = codec.encode(value, outgoing);
  memory.set(bytes);
  Atomics.store(header, 1, bytes.length);
  Atomics.store(header, 0, state);
  Atomics.notify(header, 0);
}

function read() {
  const length = Atomics.load(header, 1);
  if (length < 0 || length > memory.length) throw new RangeError('PICOMATCH_MESSAGE_LIMIT');
  return codec.decode(Buffer.from(memory.slice(0, length)), incoming);
}

function rpc(value, timeout = 500) {
  if (poison) throw new PicomatchBuildBudgetError(poison);
  if (busy) throw new PicomatchBuildBudgetError('PICOMATCH_REENTRANT_CALLBACK_UNSUPPORTED');
  busy = true;
  stats.calls++;
  const deadline = performance.now() + timeout;
  try {
    write(1, value);
    while (true) {
      const state = Atomics.load(header, 0);
      if (state === 2) {
        const response = read();
        Atomics.store(header, 0, 0); Atomics.notify(header, 0);
        for (const [id, index] of response.externalRegexUpdates || []) {
          const original = nativeRegexes.get(id);
          if (!original) throw new Error('PICOMATCH_EXTERNAL_REGEX_UNKNOWN');
          original.lastIndex = index;
        }
        if (response.error) throw response.error;
        return response.value;
      }
      if (state === 3) {
        poison = 'PICOMATCH_CALLBACK_PROTOCOL_UNSUPPORTED'; terminateOwnedWorker();
        throw new PicomatchBuildBudgetError(poison);
      }
      const remaining = deadline - performance.now();
      if (remaining <= 0 || Atomics.wait(header, 0, state, remaining) === 'timed-out') {
        poison = 'PICOMATCH_OPERATION_DEADLINE'; stats.timeouts++;
        terminateOwnedWorker();
        throw new PicomatchBuildBudgetError(poison);
      }
    }
  } finally { busy = false; }
}

class GuardedRegExp {
  constructor(token, id, flags, lastIndex) {
    if (token !== guardedRegexConstruction || !Number.isSafeInteger(id) || id < 1) {
      throw new PicomatchBuildBudgetError('PICOMATCH_GUARDED_REGEX_CONSTRUCTION_UNSUPPORTED');
    }
    remoteRegexes.set(this, id);
    Object.defineProperties(this, {
      flags: { value: flags, enumerable: false },
      lastIndex: { value: lastIndex, writable: true, enumerable: false },
      source: { get() { throw new PicomatchBuildBudgetError('PICOMATCH_NATIVE_SOURCE_EXPORT_UNSUPPORTED'); } }
    });
    Object.defineProperty(this, '__picomatchCloneBlocked', { enumerable: true,
      value() { throw new PicomatchBuildBudgetError('PICOMATCH_NATIVE_SERIALIZATION_UNSUPPORTED'); } });
  }
  #call(method, input, extra = {}) {
    if (input !== null && (typeof input === 'object' || typeof input === 'function')) {
      throw new PicomatchBuildBudgetError('PICOMATCH_REGEX_OBJECT_SUBJECT_UNSUPPORTED');
    }
    if ((method === 'replace' && extra.replacement !== null && typeof extra.replacement === 'object') ||
        (method === 'split' && extra.limit !== null && typeof extra.limit === 'object')) {
      throw new PicomatchBuildBudgetError('PICOMATCH_REGEX_OBJECT_COERCION_UNSUPPORTED');
    }
    const result = rpc({ op: 'regex', id: remoteRegexes.get(this), method, input, lastIndex: regexIndex(this.lastIndex), ...extra });
    this.lastIndex = result.lastIndex;
    return result.value;
  }
  exec(input) { return this.#call('exec', input); }
  test(input) { return this.#call('test', input); }
  [Symbol.match](input) { return this.#call('match', input); }
  [Symbol.search](input) { return this.#call('search', input); }
  [Symbol.replace](input, replacement) { return this.#call('replace', input, { replacement }); }
  [Symbol.split](input, limit) { return this.#call('split', input, { limit }); }
  [Symbol.matchAll](input) { return this.#call('matchAll', input).values(); }
  toString() { throw new PicomatchBuildBudgetError('PICOMATCH_NATIVE_SOURCE_EXPORT_UNSUPPORTED'); }
  toJSON() { throw new PicomatchBuildBudgetError('PICOMATCH_NATIVE_SERIALIZATION_UNSUPPORTED'); }
}
Object.setPrototypeOf(GuardedRegExp.prototype, RegExp.prototype);
Object.defineProperty(GuardedRegExp.prototype, Symbol.toStringTag, { value: 'RegExp' });
Object.defineProperty(GuardedRegExp.prototype, require('node:util').inspect.custom,
  { value: () => '[GuardedRegExp: native source export disabled]' });
for (const [name, flag] of Object.entries({ global: 'g', ignoreCase: 'i', multiline: 'm', dotAll: 's', unicode: 'u', sticky: 'y', hasIndices: 'd', unicodeSets: 'v' })) {
  Object.defineProperty(GuardedRegExp.prototype, name, { get() {
    if (!remoteRegexes.has(this)) throw new PicomatchBuildBudgetError('PICOMATCH_GUARDED_REGEX_RECEIVER_UNSUPPORTED');
    return this.flags.includes(flag);
  } });
}

const outgoing = {
  describe(value) {
    if (remoteFunctions.has(value)) return { t: 'entity', id: remoteFunctions.get(value), omitProps: true };
    if (remoteRegexes.has(value)) return { t: 'entityRegex', id: remoteRegexes.get(value), lastIndex: regexIndex(value.lastIndex), omitProps: true };
    if (remoteStates.has(value)) return { t: 'entity', id: remoteStates.get(value), omitProps: true };
    if (types.isProxy(value)) throw new PicomatchBuildBudgetError('PICOMATCH_EXTERNAL_PROXY_UNSUPPORTED');
    if (typeof value === 'function') {
      throw new PicomatchBuildBudgetError('PICOMATCH_LOCAL_CALLBACK_UNSUPPORTED');
    }
    if (value instanceof RegExp) {
      if (Object.getPrototypeOf(value) !== RegExp.prototype ||
          Object.getOwnPropertyNames(value).some(k => k !== 'lastIndex') ||
          Object.getOwnPropertySymbols(value).length !== 0 ||
          !Object.getOwnPropertyDescriptor(value, 'lastIndex').writable) {
        throw new PicomatchBuildBudgetError('PICOMATCH_CUSTOM_NATIVE_REGEX_UNSUPPORTED');
      }
      const source = Object.getOwnPropertyDescriptor(RegExp.prototype, 'source').get.call(value);
      if (source.length > 4096) throw new PicomatchBuildBudgetError('PICOMATCH_NATIVE_REGEX_INPUT_LIMIT');
      const flags = Object.entries({ hasIndices: 'd', global: 'g', ignoreCase: 'i', multiline: 'm', dotAll: 's',
        unicode: 'u', unicodeSets: 'v', sticky: 'y' }).filter(([name]) => {
          const descriptor = Object.getOwnPropertyDescriptor(RegExp.prototype, name);
          return descriptor && descriptor.get.call(value);
        }).map(([, flag]) => flag).join('');
      if (!nativeRegexIds.has(value)) {
        if (nativeRegexes.size >= 4096) throw new PicomatchBuildBudgetError('PICOMATCH_EXTERNAL_REGEX_LIMIT');
        nativeRegexIds.set(value, nextRegex); nativeRegexes.set(nextRegex++, value);
      }
      return { t: 'nativeRegex', ownerId: nativeRegexIds.get(value), source, flags, lastIndex: regexIndex(value.lastIndex) };
    }
    if (value && typeof value === 'object') {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) {
        throw new PicomatchBuildBudgetError('PICOMATCH_NONPLAIN_ARGUMENT_UNSUPPORTED');
      }
      if (Object.getOwnPropertySymbols(value).length) throw new PicomatchBuildBudgetError('PICOMATCH_SYMBOL_ARGUMENT_UNSUPPORTED');
      for (const key of Object.getOwnPropertyNames(value)) {
        if (Array.isArray(value) && key === 'length') continue;
        if (!Object.getOwnPropertyDescriptor(value, key).enumerable) {
          throw new PicomatchBuildBudgetError('PICOMATCH_NONENUMERABLE_ARGUMENT_UNSUPPORTED');
        }
      }
    }
    return null;
  }
};

const incoming = {
  restore(node) {
    if (node.t === 'remoteFunction') {
      if (!cache.has('f' + node.id)) {
        const fn = (...args) => rpc({ op: 'call', id: node.id, args });
        Object.defineProperty(fn, 'name', { value: node.name || 'guardedPicomatch', configurable: true });
        remoteFunctions.set(fn, node.id); cache.set('f' + node.id, fn);
      }
      return cache.get('f' + node.id);
    }
    if (node.t === 'remoteRegex') {
      if (!cache.has('r' + node.id)) cache.set('r' + node.id, new GuardedRegExp(guardedRegexConstruction, node.id, node.flags, node.lastIndex));
      const regex = cache.get('r' + node.id); regex.lastIndex = node.lastIndex; return regex;
    }
    if (node.t === 'remoteParseState') {
      if (!cache.has('s' + node.id)) {
        const target = Object.create(null);
        const rejectInspection = () => { throw new PicomatchBuildBudgetError('PICOMATCH_PARSE_STATE_INSPECTION_UNSUPPORTED'); };
        const rejectMutation = () => { throw new PicomatchBuildBudgetError('PICOMATCH_PARSE_STATE_MUTATION_UNSUPPORTED'); };
        const state = new Proxy(target, { set: rejectMutation, defineProperty: rejectMutation,
          deleteProperty: rejectMutation, setPrototypeOf: rejectMutation,
          ownKeys: rejectInspection, getOwnPropertyDescriptor: rejectInspection,
          get(object, key, receiver) {
            if (key === 'toJSON') return () => { throw new PicomatchBuildBudgetError('PICOMATCH_PARSE_STATE_SERIALIZATION_UNSUPPORTED'); };
            return rejectInspection();
          } });
        remoteStates.set(state, node.id); cache.set('s' + node.id, state);
      }
      return cache.get('s' + node.id);
    }
    throw new Error('PICOMATCH_WIRE_TYPE');
  }
};

const facade = rpc({ op: 'root' }, 3000);
Object.defineProperty(facade, 'buildGuard', { value: Object.freeze({
  prototype: true,
  limits: Object.freeze({ operationMilliseconds: 500, patternCharacters: 4096, stringCharacters: 65536,
    compiledSourceCharacters: 16384,
    patternsPerArray: 1024, messageBytes: codec.MAX_BYTES, graphNodes: 50000, graphDepth: 64,
    workersPerResolvedModuleAndNodeIsolate: 1, workerOldGenerationMB: 64, workerYoungGenerationMB: 16,
    workerStackMB: 4, startupMilliseconds: 3000, remoteEntities: 16384, callbacks: 0,
    externalRegexes: 4096 }),
  stats: () => ({ ...stats }),
  posix: () => rpc({ op: 'posixRoot' }),
  close() { poison = 'PICOMATCH_GUARD_CLOSED'; return terminateOwnedWorker(); }
}) });
module.exports = facade;
