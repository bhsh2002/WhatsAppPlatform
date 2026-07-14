import dns from 'node:dns/promises';
import https from 'node:https';
import net from 'node:net';

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

export class UnsafeOutboundUrlError extends Error {
    constructor(message) {
        super(message);
        this.name = 'UnsafeOutboundUrlError';
        this.code = 'UNSAFE_OUTBOUND_URL';
    }
}

const normalizeHostname = (hostname) => hostname.replace(/^\[|\]$/g, '').toLowerCase();

const ipv4ToInteger = (address) => address.split('.').reduce(
    (value, octet) => ((value << 8) | Number(octet)) >>> 0,
    0
);

const isInIpv4Cidr = (address, base, prefix) => {
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (ipv4ToInteger(address) & mask) === (ipv4ToInteger(base) & mask);
};

const BLOCKED_IPV4_RANGES = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
];

const parseIpv6 = (address) => {
    let normalized = address.toLowerCase().split('%')[0];
    const ipv4Match = normalized.match(/(\d+\.\d+\.\d+\.\d+)$/);
    if (ipv4Match) {
        const value = ipv4ToInteger(ipv4Match[1]);
        normalized = normalized.slice(0, -ipv4Match[1].length)
            + `${((value >>> 16) & 0xffff).toString(16)}:${(value & 0xffff).toString(16)}`;
    }

    const halves = normalized.split('::');
    if (halves.length > 2) return null;

    const left = halves[0] ? halves[0].split(':') : [];
    const right = halves[1] ? halves[1].split(':') : [];
    const missing = 8 - left.length - right.length;
    if ((halves.length === 1 && missing !== 0) || missing < 0) return null;

    const groups = [...left, ...Array(missing).fill('0'), ...right];
    if (groups.length !== 8 || groups.some(group => !/^[0-9a-f]{1,4}$/.test(group))) return null;

    return groups.flatMap(group => {
        const value = Number.parseInt(group, 16);
        return [value >>> 8, value & 0xff];
    });
};

export const isPublicIpAddress = (address) => {
    const family = net.isIP(address);
    if (family === 4) {
        return !BLOCKED_IPV4_RANGES.some(([base, prefix]) => isInIpv4Cidr(address, base, prefix));
    }
    if (family !== 6) return false;

    const bytes = parseIpv6(address);
    if (!bytes) return false;

    const isMappedIpv4 = bytes.slice(0, 10).every(byte => byte === 0)
        && bytes[10] === 0xff && bytes[11] === 0xff;
    if (isMappedIpv4) return isPublicIpAddress(bytes.slice(12).join('.'));

    // A conservative policy keeps only globally routable IPv6 (2000::/3).
    if ((bytes[0] & 0xe0) !== 0x20) return false;

    // Documentation, Teredo and 6to4 ranges can conceal non-public targets.
    if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return false;
    if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) return false;
    if (bytes[0] === 0x20 && bytes[1] === 0x02) return false;

    return true;
};

export const parseOutboundUrl = (value) => {
    let url;
    try {
        url = new URL(value);
    } catch {
        throw new UnsafeOutboundUrlError('الرابط غير صالح');
    }

    if (url.protocol !== 'https:') throw new UnsafeOutboundUrlError('يجب أن يستخدم الرابط HTTPS');
    if (url.username || url.password) {
        throw new UnsafeOutboundUrlError('بيانات الاعتماد داخل الرابط غير مسموحة');
    }
    if (url.port && url.port !== '443') {
        throw new UnsafeOutboundUrlError('يسمح فقط بمنفذ HTTPS القياسي 443');
    }

    const hostname = normalizeHostname(url.hostname);
    if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')
        || hostname.endsWith('.local') || hostname.endsWith('.internal')
        || hostname.endsWith('.home.arpa')) {
        throw new UnsafeOutboundUrlError('اسم المضيف المحلي أو الداخلي غير مسموح');
    }

    return url;
};

export const resolveSafeOutboundTarget = async (value, lookup = dns.lookup) => {
    const url = parseOutboundUrl(value);
    const hostname = normalizeHostname(url.hostname);
    const literalFamily = net.isIP(hostname);
    const addresses = literalFamily
        ? [{ address: hostname, family: literalFamily }]
        : await lookup(hostname, { all: true, verbatim: true });

    if (!Array.isArray(addresses) || addresses.length === 0) {
        throw new UnsafeOutboundUrlError('تعذر حل اسم المضيف');
    }
    if (addresses.some(({ address }) => !isPublicIpAddress(address))) {
        throw new UnsafeOutboundUrlError('الرابط يحل إلى عنوان شبكة غير عام');
    }

    return { url, address: addresses[0].address, family: addresses[0].family };
};

export const validateOutboundUrl = async (value, options = {}) => {
    if (value === null || value === undefined || value === '') return null;
    const target = await resolveSafeOutboundTarget(value, options.lookup);
    return target.url.toString();
};

const requestPinnedTarget = ({ url, address, family }, options) => new Promise((resolve, reject) => {
    const body = options.body === undefined || options.body === null
        ? null
        : Buffer.from(String(options.body));
    const headers = { ...(options.headers || {}) };
    if (body && !Object.keys(headers).some(name => name.toLowerCase() === 'content-length')) {
        headers['Content-Length'] = String(body.length);
    }

    const request = https.request(url, {
        method: options.method || 'GET',
        headers,
        servername: normalizeHostname(url.hostname),
        lookup: (_hostname, _lookupOptions, callback) => callback(null, address, family),
        timeout: options.timeoutMs || DEFAULT_TIMEOUT_MS,
    }, response => {
        response.resume();
        resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode,
            headers: response.headers,
        });
    });

    request.on('timeout', () => request.destroy(new Error('انتهت مهلة الاتصال الخارجي')));
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
});

export const safeOutboundFetch = async (value, options = {}, redirectCount = 0) => {
    const target = await resolveSafeOutboundTarget(value, options.lookup);
    const response = await requestPinnedTarget(target, options);

    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    if (redirectCount >= MAX_REDIRECTS) throw new UnsafeOutboundUrlError('تجاوز الرابط حد التحويلات');

    const location = response.headers.location;
    if (!location) throw new UnsafeOutboundUrlError('استجابة التحويل لا تحتوي وجهة');
    const redirected = new URL(location, target.url);
    if (redirected.origin !== target.url.origin) {
        throw new UnsafeOutboundUrlError('التحويل إلى مضيف أو منفذ مختلف غير مسموح');
    }

    const redirectedOptions = response.status === 303
        ? { ...options, method: 'GET', body: undefined }
        : options;
    return safeOutboundFetch(redirected, redirectedOptions, redirectCount + 1);
};
