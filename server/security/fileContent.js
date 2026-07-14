import { TextDecoder } from 'node:util';

import {
    ALLOWED_DOCUMENT_MIMES,
    ALLOWED_IMAGE_MIMES,
    ALLOWED_MEDIA_MIMES,
} from '../config/index.js';

const OLE_STORAGE_MIME = 'application/x-ole-storage';
const GENERIC_BINARY_MIME = 'application/octet-stream';

const POLICY_MIMES = Object.freeze({
    image: new Set(ALLOWED_IMAGE_MIMES),
    document: new Set(ALLOWED_DOCUMENT_MIMES),
    media: new Set(ALLOWED_MEDIA_MIMES),
    csv: new Set(['text/csv']),
});

const MIME_EXTENSIONS = Object.freeze({
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.ms-powerpoint': 'ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'text/plain': 'txt',
    'text/csv': 'csv',
    'video/mp4': 'mp4',
    'video/3gpp': '3gp',
    'audio/aac': 'aac',
    'audio/amr': 'amr',
    'audio/mp4': 'm4a',
    'audio/mpeg': 'mp3',
    'audio/ogg': 'ogg',
});

const LEGACY_OFFICE_MIMES = new Set([
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint',
]);

const startsWith = (buffer, bytes, offset = 0) => {
    if (!Buffer.isBuffer(buffer) || buffer.length < offset + bytes.length) return false;
    return bytes.every((byte, index) => buffer[offset + index] === byte);
};

const asciiAt = (buffer, offset, length) => buffer.subarray(offset, offset + length).toString('ascii');

function detectOoxmlMime(buffer) {
    if (!startsWith(buffer, [0x50, 0x4b])) return null;

    const minimumEocdOffset = Math.max(0, buffer.length - 22 - 0xffff);
    let eocdOffset = -1;
    for (let offset = buffer.length - 22; offset >= minimumEocdOffset; offset -= 1) {
        if (!startsWith(buffer, [0x50, 0x4b, 0x05, 0x06], offset)) continue;
        const commentLength = buffer.readUInt16LE(offset + 20);
        if (offset + 22 + commentLength === buffer.length) {
            eocdOffset = offset;
            break;
        }
    }
    if (eocdOffset < 0) return GENERIC_BINARY_MIME;

    const diskNumber = buffer.readUInt16LE(eocdOffset + 4);
    const directoryDisk = buffer.readUInt16LE(eocdOffset + 6);
    const entriesOnDisk = buffer.readUInt16LE(eocdOffset + 8);
    const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
    const directorySize = buffer.readUInt32LE(eocdOffset + 12);
    const directoryOffset = buffer.readUInt32LE(eocdOffset + 16);
    const directoryEnd = directoryOffset + directorySize;

    // Multi-disk and ZIP64 archives are unnecessary for the 16MB upload limit.
    if (
        diskNumber !== 0
        || directoryDisk !== 0
        || entriesOnDisk !== totalEntries
        || totalEntries === 0
        || totalEntries > 4096
        || directoryEnd > eocdOffset
    ) {
        return GENERIC_BINARY_MIME;
    }

    const entryNames = new Set();
    let offset = directoryOffset;

    // Read only ZIP central-directory metadata. No entry is decompressed, so a
    // compressed bomb cannot consume memory while its container type is checked.
    for (let entry = 0; entry < totalEntries; entry += 1) {
        if (offset + 46 > directoryEnd || !startsWith(buffer, [0x50, 0x4b, 0x01, 0x02], offset)) {
            return GENERIC_BINARY_MIME;
        }
        const nameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        const end = offset + 46 + nameLength + extraLength + commentLength;
        if (end > directoryEnd) return GENERIC_BINARY_MIME;

        entryNames.add(buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'));
        offset = end;
    }
    if (offset !== directoryEnd) return GENERIC_BINARY_MIME;

    if (!entryNames.has('[Content_Types].xml')) return GENERIC_BINARY_MIME;
    if (entryNames.has('word/document.xml')) {
        return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    }
    if (entryNames.has('xl/workbook.xml')) {
        return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    }
    if (entryNames.has('ppt/presentation.xml')) {
        return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    }
    return GENERIC_BINARY_MIME;
}

function isUtf8Text(buffer) {
    if (buffer.includes(0)) return false;

    let value;
    try {
        value = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
        return false;
    }

    let disallowedControls = 0;
    for (const char of value) {
        const codePoint = char.codePointAt(0);
        if (codePoint < 0x20 && ![0x09, 0x0a, 0x0c, 0x0d].includes(codePoint)) {
            disallowedControls += 1;
        }
    }
    return disallowedControls <= Math.floor(value.length * 0.001);
}

/**
 * Detect the small, explicit set of formats accepted by this application.
 * Unknown binary data is deliberately not guessed from its filename or header.
 */
export function detectUploadMime(buffer) {
    if (!Buffer.isBuffer(buffer)) {
        throw new TypeError('Upload content must be a Buffer');
    }

    if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'image/jpeg';
    if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
    if (asciiAt(buffer, 0, 4) === 'RIFF' && asciiAt(buffer, 8, 4) === 'WEBP') return 'image/webp';

    const pdfHeaderOffset = buffer.subarray(0, 1024).indexOf(Buffer.from('%PDF-'));
    if (pdfHeaderOffset >= 0) return 'application/pdf';

    if (startsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
        return OLE_STORAGE_MIME;
    }

    const ooxmlMime = detectOoxmlMime(buffer);
    if (ooxmlMime) return ooxmlMime;

    if (asciiAt(buffer, 0, 4) === 'OggS') {
        const header = buffer.subarray(0, 512).toString('latin1');
        if (header.includes('OpusHead') || header.includes('vorbis') || header.includes('Speex')) {
            return 'audio/ogg';
        }
        return GENERIC_BINARY_MIME;
    }
    if (asciiAt(buffer, 0, 6) === '#!AMR\n') return 'audio/amr';
    if (asciiAt(buffer, 0, 3) === 'ID3') return 'audio/mpeg';
    if (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0) return 'audio/aac';
    if (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0 && (buffer[1] & 0x06) !== 0) {
        return 'audio/mpeg';
    }

    if (asciiAt(buffer, 4, 4) === 'ftyp') {
        const brand = asciiAt(buffer, 8, 4).toLowerCase();
        return brand.startsWith('3gp') ? 'video/3gpp' : 'video/mp4';
    }

    if (isUtf8Text(buffer)) return 'text/plain';
    return GENERIC_BINARY_MIME;
}

export class InvalidUploadTypeError extends Error {
    constructor(message = 'نوع الملف غير مدعوم أو لا يطابق محتواه') {
        super(message);
        this.name = 'InvalidUploadTypeError';
        this.code = 'INVALID_FILE_TYPE';
        this.status = 400;
    }
}

/**
 * Validate detected content against a route-specific policy and return the MIME
 * and extension that may safely be used downstream.
 */
export function validateUploadContent(buffer, { policy, declaredMime = '' } = {}) {
    const allowedMimes = POLICY_MIMES[policy];
    if (!allowedMimes) throw new TypeError(`Unknown upload policy: ${policy}`);

    const detectedMime = detectUploadMime(buffer);
    let mime = detectedMime;

    if (detectedMime === OLE_STORAGE_MIME && LEGACY_OFFICE_MIMES.has(declaredMime)) {
        mime = declaredMime;
    } else if (policy === 'csv' && detectedMime === 'text/plain') {
        mime = 'text/csv';
    } else if (detectedMime === 'video/mp4' && declaredMime === 'audio/mp4') {
        // ISO BMFF does not reliably distinguish an audio-only M4A from MP4
        // without parsing every track. Both are in the media allowlist.
        mime = 'audio/mp4';
    }

    if (!allowedMimes.has(mime)) throw new InvalidUploadTypeError();

    return {
        mime,
        extension: MIME_EXTENSIONS[mime],
        detectedMime,
    };
}

export function mediaMessageTypeForMime(mime) {
    if (ALLOWED_IMAGE_MIMES.includes(mime)) return 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    if (ALLOWED_DOCUMENT_MIMES.includes(mime)) return 'document';
    return null;
}
