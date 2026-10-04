import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';

const publicRoot = new URL('../../../public/', import.meta.url);
const primaryMark = '/brand/wa-savana-mark-v9.png';
const notificationIcon = '/icons/wa-savana-v9-192.png';
const notificationBadge = '/icons/wa-savana-badge-v9-96.png';
const expectedAssets = [
    [primaryMark, 512],
    ['/icons/favicon-v9-32.png', 32],
    ['/icons/apple-touch-icon-v9.png', 180],
    [notificationIcon, 192],
    ['/icons/wa-savana-v9-512.png', 512],
    [notificationBadge, 96],
];
const readSource = path => readFileSync(new URL(path, import.meta.url), 'utf8');

const pngDimensions = path => {
    const png = readFileSync(new URL(path.slice(1), publicRoot));
    assert.ok(png.length >= 33, `${path} must contain a complete PNG header`);
    assert.deepEqual(
        png.subarray(0, 8),
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        `${path} must have a PNG signature`,
    );
    assert.equal(png.readUInt32BE(8), 13, `${path} must have a standard IHDR chunk`);
    assert.equal(png.toString('ascii', 12, 16), 'IHDR', `${path} must start with IHDR`);
    return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
};

for (const [path, size] of expectedAssets) {
    test(`${path} is a ${size}x${size} PNG`, () => {
        assert.deepEqual(pngDimensions(path), { width: size, height: size });
    });
}

test('the manifest uses versioned icons at their declared resolution and preserves PWA identity', () => {
    const manifest = JSON.parse(readFileSync(new URL('manifest.webmanifest', publicRoot), 'utf8'));

    assert.deepEqual(manifest.icons, [
        { src: notificationIcon, sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/wa-savana-v9-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ]);
    for (const icon of manifest.icons) {
        const { width, height } = pngDimensions(icon.src);
        assert.equal(icon.sizes, `${width}x${height}`, `${icon.src} must match its declared size`);
    }
    assert.equal(manifest.id, '/');
    assert.equal(manifest.start_url, '/login?source=pwa');
    assert.equal(manifest.scope, '/');
});

test('the shared brand component uses the versioned primary mark', () => {
    const component = readSource('./WaBrandMark.jsx');
    const imageSources = [...component.matchAll(/\bsrc\s*=\s*["']([^"']+)["']/g)]
        .map(match => match[1]);
    assert.deepEqual(imageSources, [primaryMark]);
});

test('HTML favicon and Apple touch links use the versioned assets and correct sizes', () => {
    const html = readSource('../../../index.html');
    const links = [...html.matchAll(/<link\b[^>]*>/g)].map(match => match[0]);
    const linkWithRel = rel => links.find(link => link.includes(`rel="${rel}"`));

    assert.match(linkWithRel('icon'), /\bhref="\/icons\/favicon-v9-32\.png"/);
    assert.match(linkWithRel('icon'), /\bsizes="32x32"/);
    assert.match(linkWithRel('icon'), /\btype="image\/png"/);
    assert.match(linkWithRel('apple-touch-icon'), /\bhref="\/icons\/apple-touch-icon-v9\.png"/);
    assert.match(linkWithRel('apple-touch-icon'), /\bsizes="180x180"/);
    assert.match(linkWithRel('manifest'), /\bhref="\/manifest\.webmanifest"/);
});

for (const [label, path] of [
    ['service worker', '../../../public/sw.js'],
    ['server push payloads', '../../../../server/services/webPush.js'],
]) {
    test(`${label} use the same versioned notification icon and badge`, () => {
        const source = readSource(path);
        for (const [property, expected] of [['icon', notificationIcon], ['badge', notificationBadge]]) {
            const references = [...source.matchAll(new RegExp(`\\b${property}\\s*:\\s*['"]([^'"]+)['"]`, 'g'))]
                .map(match => match[1]);
            assert.ok(references.length > 0, `${label} must provide a ${property}`);
            assert.ok(references.every(reference => reference === expected), `${label} must use ${expected}`);
        }
    });
}
