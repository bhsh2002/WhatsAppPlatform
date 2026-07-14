import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { MediaTooLargeError, createMediaLimitTransform, normalizeMaxMediaBytes } from '../services/mediaStreaming.js';

const collect = async stream => {
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
};

test('media streaming passes bounded content without buffering the whole response', async () => {
    const source = Readable.from([Buffer.from('hello'), Buffer.from(' world')]);
    const result = await collect(source.pipe(createMediaLimitTransform(11)));
    assert.equal(result.toString(), 'hello world');
});

test('media streaming aborts once the byte ceiling is crossed', async () => {
    const source = Readable.from([Buffer.alloc(8), Buffer.alloc(8)]);
    await assert.rejects(collect(source.pipe(createMediaLimitTransform(10))), MediaTooLargeError);
    assert.equal(normalizeMaxMediaBytes('20'), 1024 * 1024);
    assert.equal(normalizeMaxMediaBytes(String(200 * 1024 * 1024)), 100 * 1024 * 1024);
});
