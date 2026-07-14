import assert from 'node:assert/strict';
import test from 'node:test';

import {
    InvalidUploadTypeError,
    detectUploadMime,
    mediaMessageTypeForMime,
    validateUploadContent,
} from '../security/fileContent.js';

function zipCentralDirectory(entryNames) {
    const prefix = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    const directoryChunks = [];
    for (const entryName of entryNames) {
        const name = Buffer.from(entryName, 'utf8');
        const header = Buffer.alloc(46);
        header.writeUInt32LE(0x02014b50, 0);
        header.writeUInt16LE(name.length, 28);
        directoryChunks.push(header, name);
    }
    const directory = Buffer.concat(directoryChunks);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(entryNames.length, 8);
    eocd.writeUInt16LE(entryNames.length, 10);
    eocd.writeUInt32LE(directory.length, 12);
    eocd.writeUInt32LE(prefix.length, 16);
    return Buffer.concat([prefix, directory, eocd]);
}

test('upload content detection recognizes allowlisted image signatures', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const webp = Buffer.concat([
        Buffer.from('RIFF'),
        Buffer.alloc(4),
        Buffer.from('WEBPVP8 '),
    ]);

    assert.equal(detectUploadMime(png), 'image/png');
    assert.equal(detectUploadMime(jpeg), 'image/jpeg');
    assert.equal(detectUploadMime(webp), 'image/webp');
});

test('declaring executable text as an image does not bypass byte validation', () => {
    assert.throws(
        () => validateUploadContent(Buffer.from('<script>alert(1)</script>'), {
            policy: 'image',
            declaredMime: 'image/jpeg',
        }),
        InvalidUploadTypeError
    );
});

test('CSV imports accept UTF-8 text and reject binary files with CSV headers', () => {
    const csv = validateUploadContent(Buffer.from('sku,name\n1,Example\n'), {
        policy: 'csv',
        declaredMime: 'text/csv',
    });
    assert.deepEqual(csv, {
        mime: 'text/csv',
        extension: 'csv',
        detectedMime: 'text/plain',
    });

    assert.throws(
        () => validateUploadContent(Buffer.from([0x00, 0xff, 0x00, 0x7f]), {
            policy: 'csv',
            declaredMime: 'text/csv',
        }),
        InvalidUploadTypeError
    );
});

test('OOXML containers require expected central-directory entries without decompression', () => {
    const docx = zipCentralDirectory(['[Content_Types].xml', 'word/document.xml']);
    const xlsx = zipCentralDirectory(['[Content_Types].xml', 'xl/workbook.xml']);
    const arbitraryZip = zipCentralDirectory(['payload.html']);

    assert.equal(
        validateUploadContent(docx, { policy: 'document' }).mime,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    assert.equal(
        validateUploadContent(xlsx, { policy: 'document' }).mime,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    assert.throws(
        () => validateUploadContent(arbitraryZip, {
            policy: 'document',
            declaredMime: 'application/pdf',
        }),
        InvalidUploadTypeError
    );
});

test('legacy compound Office files require a compatible declared Office family', () => {
    const cfb = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

    assert.equal(
        validateUploadContent(cfb, {
            policy: 'document',
            declaredMime: 'application/msword',
        }).mime,
        'application/msword'
    );
    assert.throws(
        () => validateUploadContent(cfb, {
            policy: 'document',
            declaredMime: 'application/pdf',
        }),
        InvalidUploadTypeError
    );
});

test('ISO media containers retain safe audio-only declarations', () => {
    const m4a = Buffer.concat([
        Buffer.alloc(4),
        Buffer.from('ftypM4A '),
        Buffer.alloc(8),
    ]);

    assert.deepEqual(
        validateUploadContent(m4a, {
            policy: 'media',
            declaredMime: 'audio/mp4',
        }),
        {
            mime: 'audio/mp4',
            extension: 'm4a',
            detectedMime: 'video/mp4',
        }
    );
});

test('verified MIME maps to exactly one WhatsApp media payload type', () => {
    assert.equal(mediaMessageTypeForMime('image/png'), 'image');
    assert.equal(mediaMessageTypeForMime('video/mp4'), 'video');
    assert.equal(mediaMessageTypeForMime('audio/mpeg'), 'audio');
    assert.equal(mediaMessageTypeForMime('application/pdf'), 'document');
    assert.equal(mediaMessageTypeForMime('application/octet-stream'), null);
});
