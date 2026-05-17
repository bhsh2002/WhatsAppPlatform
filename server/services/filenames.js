const ARABIC_TEXT_RE = /[\u0600-\u06FF]/;
const MOJIBAKE_SIGNAL_RE = /[ÃÂØÙÛÚÐÑÝÞþð]/;

export function repairMojibakeFilename(value) {
    if (typeof value !== 'string' || value.length === 0) return value;
    if (!MOJIBAKE_SIGNAL_RE.test(value)) return value;

    const decoded = Buffer.from(value, 'latin1').toString('utf8');
    if (!decoded || decoded === value || decoded.includes('\uFFFD')) return value;

    return ARABIC_TEXT_RE.test(decoded) ? decoded : value;
}

export function normalizeFilename(value, fallback = 'مستند') {
    const filename = repairMojibakeFilename(value || '').trim();
    return filename || fallback;
}
