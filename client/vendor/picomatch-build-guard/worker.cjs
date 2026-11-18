'use strict';
const { workerData } = require('node:worker_threads');
const codec = require('./codec.cjs');
const header = new Int32Array(workerData.header);
const memory = new Uint8Array(workerData.memory);
const upstream = require('./upstream');
const posix = require('./upstream/lib/picomatch');
const nativeToRegex = posix.toRegex;
function boundedToRegex(source, options) {
  if (typeof source === 'string' && source.length > 16384) throw new RangeError('PICOMATCH_COMPILED_SOURCE_LIMIT');
  return nativeToRegex(source, options);
}
// Both the public wrapper and the private upstream compiler use this property.
// This adds a source-size bound without changing any accepted regex language.
posix.toRegex = boundedToRegex;
upstream.toRegex = boundedToRegex;
const entities = new Map();
const identifiers = new WeakMap();
const externalRegexes = new Map();
const dirtyRegexes = new Set();
const opaqueStates = new WeakSet();
let nextId = 1;
// The callable deletes regex.state before returning its matcher. Fast-path
// states do not contain input/tokens, so seal them at the compiler boundary
// rather than relying on the shape of a later returned object.
const nativeCompileRe = posix.compileRe;
function boundedCompileRe(state, ...args) {
  if (state && typeof state === 'object') opaqueStates.add(state);
  return nativeCompileRe(state, ...args);
}
posix.compileRe = boundedCompileRe;
upstream.compileRe = boundedCompileRe;

function retain(value) {
  if (!identifiers.has(value)) {
    if (entities.size >= 16384) throw new RangeError('PICOMATCH_ENTITY_LIMIT');
    identifiers.set(value, nextId);
    entities.set(nextId++, value);
  }
  return identifiers.get(value);
}

function send(state, value) {
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

const outgoing = {
  describe(value) {
    if (typeof value === 'function') return { t: 'remoteFunction', id: retain(value), name: value.name };
    if (value instanceof RegExp) {
      if (value.state && typeof value.state === 'object') opaqueStates.add(value.state);
      return { t: 'remoteRegex', id: retain(value), flags: value.flags, lastIndex: value.lastIndex };
    }
    if (value && typeof value === 'object' && (opaqueStates.has(value) ||
        (typeof value.output === 'string' && typeof value.input === 'string' && Array.isArray(value.tokens)))) {
      return { t: 'remoteParseState', id: retain(value), omitProps: true };
    }
    return null;
  }
};

const incoming = {
  restore(node) {
    if (node.t === 'entity' || node.t === 'entityRegex') {
      if (!entities.has(node.id)) throw new Error('PICOMATCH_ENTITY_UNKNOWN');
      const value = entities.get(node.id);
      if (node.t === 'entityRegex') value.lastIndex = node.lastIndex;
      return value;
    }
    if (node.t === 'nativeRegex') {
      let regex = externalRegexes.get(node.ownerId);
      if (!regex || regex.source !== node.source || regex.flags !== node.flags) {
        if (!externalRegexes.has(node.ownerId) && externalRegexes.size >= 4096) throw new RangeError('PICOMATCH_EXTERNAL_REGEX_LIMIT');
        regex = new RegExp(node.source, node.flags);
        externalRegexes.set(node.ownerId, regex);
      }
      regex.lastIndex = node.lastIndex;
      dirtyRegexes.add(node.ownerId);
      return regex;
    }
    throw new Error('PICOMATCH_WIRE_TYPE');
  }
};

function execute(request) {
  if (request.op === 'root') return upstream;
  if (request.op === 'posixRoot') return posix;
  const entity = entities.get(request.id);
  if (request.op === 'call') {
    if (typeof entity !== 'function') throw new TypeError('PICOMATCH_NOT_CALLABLE');
    // Bound the input pattern size for compilation/scanning independently of
    // the larger subject/input budget enforced by the codec.
    const patternOps = new Map([[upstream, 0], [posix, 0], [upstream.scan, 0], [upstream.parse, 0],
      [upstream.makeRe, 0], [upstream.isMatch, 1], [upstream.matchBase, 1]]);
    if (entity === upstream.parse.fastpaths ||
        ((entity === upstream.makeRe || entity === upstream.compileRe) && request.args[2] === true)) {
      const error = new Error('PICOMATCH_NATIVE_SOURCE_EXPORT_UNSUPPORTED');
      error.code = error.message;
      throw error;
    }
    if (patternOps.has(entity)) {
      const pattern = request.args[patternOps.get(entity)];
      const validate = value => {
        let leaves = 0;
        let nodes = 0;
        const active = new Set();
        const visit = (item, depth = 0) => {
          if (++nodes > 50000 || depth > 64) throw new RangeError('PICOMATCH_PATTERN_TREE_LIMIT');
          if (Array.isArray(item)) {
            if (item.length > 1024) throw new RangeError('PICOMATCH_PATTERN_LIMIT');
            if (active.has(item)) throw new RangeError('PICOMATCH_PATTERN_CYCLE_UNSUPPORTED');
            active.add(item);
            for (const child of item) visit(child, depth + 1);
            active.delete(item);
          } else {
            if (++leaves > 1024 || (typeof item === 'string' && item.length > 4096) ||
                (item && typeof item === 'object' && typeof item.input === 'string' && item.input.length > 4096)) {
              throw new RangeError('PICOMATCH_PATTERN_LIMIT');
            }
          }
        };
        visit(value);
      };
      validate(pattern);
      const optionsIndex = patternOps.get(entity) === 1 ? 2 : 1;
      const options = request.args[optionsIndex];
      if (options && typeof options === 'object' && options.ignore !== undefined) validate(options.ignore);
    }
    return Reflect.apply(entity, undefined, request.args);
  }
  if (request.op === 'regex') {
    if (!(entity instanceof RegExp)) throw new TypeError('PICOMATCH_NOT_REGEX');
    entity.lastIndex = request.lastIndex;
    let value;
    if (request.method === 'exec') value = entity.exec(request.input);
    else if (request.method === 'test') value = entity.test(request.input);
    else if (request.method === 'match') value = String(request.input).match(entity);
    else if (request.method === 'search') value = String(request.input).search(entity);
    else if (request.method === 'replace') value = String(request.input).replace(entity, request.replacement);
    else if (request.method === 'split') value = String(request.input).split(entity, request.limit);
    else if (request.method === 'matchAll') value = Array.from(String(request.input).matchAll(entity));
    else throw new Error('PICOMATCH_REGEX_OPERATION_UNSUPPORTED');
    return { value, lastIndex: entity.lastIndex };
  }
  throw new Error('PICOMATCH_OPERATION_UNSUPPORTED');
}

while (true) {
  const state = Atomics.load(header, 0);
  if (state !== 1) { Atomics.wait(header, 0, state); continue; }
  dirtyRegexes.clear();
  let response;
  try { response = { value: execute(read()) }; }
  catch (error) { response = { error }; }
  response.externalRegexUpdates = [...dirtyRegexes].map(id => [id, externalRegexes.get(id).lastIndex]);
  try { send(2, response); }
  catch (error) { send(2, { error }); }
  while (Atomics.load(header, 0) === 2) Atomics.wait(header, 0, 2);
}
