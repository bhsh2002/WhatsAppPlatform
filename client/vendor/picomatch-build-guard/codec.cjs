'use strict';
// Preserve object graphs/captures without compiling RegExp in the caller.
const v8 = require('node:v8');
const MAX_NODES = 50000;
const MAX_STRING = 65536;
const MAX_BYTES = 2 * 1024 * 1024;

function encode(value, handlers) {
  const seen = new Map();
  const nodes = [];
  let estimate = 128;
  const charge = count => {
    estimate += count;
    if (estimate > MAX_BYTES) throw new RangeError('PICOMATCH_MESSAGE_LIMIT');
  };
  const string = value => {
    if (value.length > MAX_STRING) throw new RangeError('PICOMATCH_INPUT_LIMIT');
    charge(Buffer.byteLength(value, 'utf8') + 16);
  };
  const ref = (item, depth = 0) => {
    if (typeof item === 'string') string(item);
    if (typeof item === 'bigint' || typeof item === 'symbol') throw new TypeError('PICOMATCH_VALUE_TYPE_UNSUPPORTED');
    if (item === null || (typeof item !== 'object' && typeof item !== 'function')) { charge(16); return { v: item }; }
    if (seen.has(item)) return { r: seen.get(item) };
    if (depth > 64 || nodes.length >= MAX_NODES) throw new RangeError('PICOMATCH_GRAPH_LIMIT');
    const index = nodes.length;
    seen.set(item, index);
    nodes.push(null);
    const special = handlers.describe(item);
    const node = special || { t: Array.isArray(item) ? 'array' : item instanceof Error ? 'error' : 'object' };
    charge(128);
    if (node.t === 'error') Object.assign(node, { name: item.name, message: item.message, code: item.code });
    for (const value of Object.values(node)) if (typeof value === 'string') string(value);
    if (Array.isArray(item)) {
      if (item.length > 65536) throw new RangeError('PICOMATCH_ARRAY_LIMIT');
      charge(item.length * 8); node.length = item.length;
    }
    node.props = node.omitProps ? [] : Object.keys(item).map(key => {
      string(key); charge(32);
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor || descriptor.get || descriptor.set) throw new TypeError('PICOMATCH_ACCESSOR_UNSUPPORTED');
      return [key, ref(descriptor.value, depth + 1)];
    });
    nodes[index] = node;
    return { r: index };
  };
  const graph = { root: ref(value), nodes };
  const bytes = v8.serialize(graph);
  if (bytes.length > MAX_BYTES) throw new RangeError('PICOMATCH_MESSAGE_LIMIT');
  return bytes;
}

function decode(bytes, handlers) {
  const graph = v8.deserialize(bytes);
  if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length > MAX_NODES) throw new Error('PICOMATCH_WIRE_INVALID');
  const values = new Array(graph.nodes.length);
  const allocated = new Set();
  const resolve = ref => {
    if ('v' in ref) return ref.v;
    const index = ref.r;
    if (!Number.isInteger(index) || index < 0 || index >= graph.nodes.length) throw new Error('PICOMATCH_WIRE_REFERENCE');
    if (allocated.has(index)) return values[index];
    const node = graph.nodes[index];
    let value;
    if (node.t === 'array') value = new Array(node.length);
    else if (node.t === 'object') value = {};
    else if (node.t === 'error') {
      const types = { Error, TypeError, RangeError, SyntaxError };
      value = new (types[node.name] || Error)(node.message);
      value.name = node.name;
      if (node.code !== undefined) value.code = node.code;
    } else value = handlers.restore(node);
    allocated.add(index);
    values[index] = value;
    for (const [key, item] of node.props || []) {
      // Never interpret __proto__ as an assignment to an inherited setter.
      Object.defineProperty(value, key, { value: resolve(item), enumerable: true, configurable: true, writable: true });
    }
    return value;
  };
  return resolve(graph.root);
}

module.exports = { encode, decode, MAX_BYTES, MAX_STRING };
