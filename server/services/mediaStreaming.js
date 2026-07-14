import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const DEFAULT_MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const MIN_MAX_MEDIA_BYTES = 1024 * 1024;
const MAX_MAX_MEDIA_BYTES = 100 * 1024 * 1024;

export class MediaTooLargeError extends Error {
    constructor(maxBytes) {
        super(`Media exceeds the ${maxBytes} byte download limit`);
        this.name = 'MediaTooLargeError';
        this.code = 'MEDIA_TOO_LARGE';
        this.maxBytes = maxBytes;
    }
}

export const normalizeMaxMediaBytes = (value = process.env.MAX_MEDIA_DOWNLOAD_BYTES) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return DEFAULT_MAX_MEDIA_BYTES;
    return Math.min(MAX_MAX_MEDIA_BYTES, Math.max(MIN_MAX_MEDIA_BYTES, parsed));
};

export const createMediaLimitTransform = (maxBytes) => {
    let received = 0;
    return new Transform({
        transform(chunk, _encoding, callback) {
            received += chunk.length;
            if (received > maxBytes) return callback(new MediaTooLargeError(maxBytes));
            return callback(null, chunk);
        },
    });
};

export const pipeFetchResponse = async (fetchResponse, expressResponse, {
    contentType = 'application/octet-stream',
    maxBytes = normalizeMaxMediaBytes(),
} = {}) => {
    if (!fetchResponse.body) throw new Error('Media response has no body');

    const contentLength = Number.parseInt(fetchResponse.headers.get('content-length'), 10);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        throw new MediaTooLargeError(maxBytes);
    }

    expressResponse.setHeader('Content-Type', contentType);
    if (Number.isFinite(contentLength)) expressResponse.setHeader('Content-Length', String(contentLength));
    await pipeline(
        Readable.fromWeb(fetchResponse.body),
        createMediaLimitTransform(maxBytes),
        expressResponse
    );
};
