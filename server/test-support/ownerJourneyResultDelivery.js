import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';

const limit = 4_194_304;
const mime = value => typeof value === 'string' ? value.split(';', 1)[0].trim().toLowerCase() : null;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

// Observe the actual completed owner HTTP response, not a prepared service
// return. This never changes a body/header or grants access to a result.
export const createOwnerJourneyResultDelivery = ({ onDelivered }) => {
    if (typeof onDelivered !== 'function') throw new TypeError('Actual result delivery requires an observer');
    const active = new AsyncLocalStorage();
    const capture = event => {
        const pending = active.getStore();
        if (!pending || pending.event || !Buffer.isBuffer(event?.representation?.bytes)) return false;
        pending.event = { ...event, representation: { ...event.representation, bytes: Buffer.from(event.representation.bytes) } };
        return true;
    };
    const middleware = (req, res, next) => {
        if (req.method !== 'GET' || !/^\/workspace\/commands\/[^/]+\/result$/.test(req.path)) return next();
        const pending = { event: null, chunks: [], length: 0, invalid: false };
        const append = (chunk, encoding) => {
            if (chunk === undefined || chunk === null || typeof chunk === 'function' || pending.invalid) return;
            if (typeof chunk !== 'string' && !(chunk instanceof Uint8Array)) { pending.invalid = true; return; }
            const bytes = typeof chunk === 'string' ? Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8') : Buffer.from(chunk);
            pending.length += bytes.length;
            if (pending.length > limit) { pending.invalid = true; pending.chunks = []; return; }
            pending.chunks.push(bytes);
        };
        const write = res.write, end = res.end;
        res.write = function (...args) { append(args[0], args[1]); return write.apply(this, args); };
        res.end = function (...args) { append(args[0], args[1]); return end.apply(this, args); };
        res.once('finish', () => {
            try {
                const expected = pending.event?.representation;
                if (res.statusCode !== 200 || pending.invalid || !expected || pending.length < 1
                    || !['application/json', 'text/csv'].includes(expected.contentType)
                    || mime(res.getHeader('Content-Type')) !== expected.contentType
                    || !/^[a-f0-9]{64}$/.test(expected.sha256 || '')
                    || res.getHeader('X-Savana-Result-SHA256') !== expected.sha256) return;
                const delivered = Buffer.concat(pending.chunks, pending.length);
                if (!delivered.equals(expected.bytes) || sha(delivered) !== expected.sha256) return;
                onDelivered({ ...pending.event, representation: { ...expected, bytes: delivered } });
            } catch { /* Failed observer evidence cannot turn a completed HTTP read into a fabricated proof. */ }
            finally { pending.event = null; pending.chunks = []; }
        });
        res.once('close', () => { pending.event = null; pending.chunks = []; });
        return active.run(pending, next);
    };
    return { middleware, capture };
};
