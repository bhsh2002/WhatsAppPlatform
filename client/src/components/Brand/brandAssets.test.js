import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';

const publicRoot = new URL('../../../public/', import.meta.url);
const primaryMark = '/brand/wa-savana-mark-v15.svg';
const notificationIcon = '/icons/wa-savana-v15-192.png';
const notificationBadge = '/icons/wa-savana-badge-v15-96.png';
const expectedAssets = [
    ['/brand/wa-savana-mark-v15.png', 512],
    ['/icons/favicon-v15-32.png', 32],
    ['/icons/apple-touch-icon-v15.png', 180],
    [notificationIcon, 192],
    ['/icons/wa-savana-v15-512.png', 512],
    [notificationBadge, 96],
];
const readSource = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const readPublicSvg = path => readFileSync(new URL(path.slice(1), publicRoot), 'utf8');
const svgPaints = svg => [...svg.matchAll(/\b(?:fill|stroke)\s*=\s*(["'])([^"']*)\1/gi)]
    .map(match => match[2].toLowerCase());
const attributes = element => Object.fromEntries(
    [...element.matchAll(/\b([\w:-]+)\s*=\s*(["'])([^"']*)\2/g)]
        .map(attribute => [attribute[1], attribute[3].toLowerCase()]),
);
const elements = (svg, tag) => [...svg.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'gi'))]
    .map(match => attributes(match[0]));

const assertSafeSquareSvg = svg => {
    const root = svg.match(/<svg\b[^>]*>/i)?.[0];
    assert.ok(root, 'the source must be a native SVG');
    assert.match(root, /\bxmlns\s*=\s*(["'])http:\/\/www\.w3\.org\/2000\/svg\1/);
    assert.match(root, /\bviewBox\s*=\s*(["'])0\s+0\s+1024\s+1024\1/);
    assert.doesNotMatch(svg, /<(?:image|script|filter|radialGradient|mask|foreignObject|animate|set)\b/i);
    assert.doesNotMatch(svg, /\b(?:filter|mask|style)\s*[:=]|\bon\w+\s*=|\b(?:xlink:)?href\s*=/i);
    for (const reference of svg.matchAll(/url\s*\(([^)]*)\)/gi)) {
        assert.match(reference[1], /^#[a-z][\w-]*$/i, 'paint references must be local SVG IDs');
    }
    for (const opacity of svg.matchAll(/\b(?:opacity|fill-opacity|stroke-opacity)\s*=\s*(["'])([^"']*)\1/gi)) {
        assert.equal(Number(opacity[2]), 1, 'the mark must not use fading or translucent paints');
    }
};

const normalizePath = path => path.replace(/\s+/g, ' ').trim();

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
    assert.equal(png[25], 6, `${path} must use RGBA PNG color type 6 to retain alpha`);
    return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
};

for (const [path, size] of expectedAssets) {
    test(`${path} is a ${size}x${size} PNG`, () => {
        assert.deepEqual(pngDimensions(path), { width: size, height: size });
    });
}

test('the public master is byte-identical to the approved v15 SVG preview', () => {
    const approvedSource = readFileSync(new URL('../../../../docs/branding/wa-savana-mark-v15-preview.svg', import.meta.url));
    const publicMaster = readFileSync(new URL(primaryMark.slice(1), publicRoot));
    assert.deepEqual(publicMaster, approvedSource, 'adopting the mark must not redraw or alter the approved preview');
});

test('the primary SVG is self-contained, square and uses opaque local paints', () => {
    const svg = readPublicSvg(primaryMark);
    assertSafeSquareSvg(svg);

    const gradients = [...svg.matchAll(/<linearGradient\b([^>]*)>([\s\S]*?)<\/linearGradient>/gi)];
    const gradientIds = new Set();
    for (const gradient of gradients) {
        const gradientAttributes = attributes(gradient[1]);
        assert.ok(gradientAttributes.id, 'gradients must have a local ID');
        assert.ok(!gradientIds.has(gradientAttributes.id), 'gradient IDs must be unique');
        gradientIds.add(gradientAttributes.id);
        const stops = elements(gradient[2], 'stop');
        for (const stop of stops) {
            assert.equal(Number(stop['stop-opacity'] ?? 1), 1, 'gradient stops must be fully opaque');
        }
    }
    const paints = svgPaints(svg);
    assert.ok(paints.includes('#ffffff'), 'the message lines and Savana S must stay white');
    for (const paint of paints) {
        if (paint === '#ffffff' || paint === 'none') continue;
        const reference = paint.match(/^url\(#([a-z][\w-]*)\)$/);
        assert.ok(reference && gradientIds.has(reference[1]), 'colored paints must resolve to a defined local gradient');
    }
    for (const gradientId of gradientIds) {
        assert.ok(paints.includes(`url(#${gradientId})`), 'each defined gradient must be used by the mark');
    }
});

test('the monochrome notification badge derives its silhouette and S from the approved primary mark', () => {
    const svg = readPublicSvg('/brand/wa-savana-badge-v15.svg');
    assertSafeSquareSvg(svg);
    assert.doesNotMatch(svg, /<linearGradient\b|url\s*\(/i, 'the badge must not use gradients');
    const paints = svgPaints(svg);
    assert.ok(paints.includes('#ffffff'), 'the badge must contain a white silhouette');
    assert.ok(paints.every(paint => paint === '#ffffff' || paint === 'none'), 'the badge must use only white or no paint');
    assert.doesNotMatch(svg, /<rect\b/i, 'the badge must not include the message page');
    const paths = elements(svg, 'path');
    const silhouettes = paths.filter(path => path.id === 'badge-silhouette');
    assert.equal(silhouettes.length, 1, 'the badge must use one joined silhouette');
    const silhouette = silhouettes[0];
    assert.equal(silhouette.fill, '#ffffff');
    assert.equal(silhouette['fill-rule'], 'evenodd', 'the badge must leave a transparent interior for OS alpha masking');
    assert.equal(silhouette.stroke, undefined, 'the silhouette must not be expanded by an extra stroke');
    const contours = normalizePath(silhouette.d).match(/m\b[^m]+/gi) ?? [];
    assert.equal(contours.length, 2, 'the badge must contain an outer silhouette and an interior cutout');
    assert.ok(contours.every(contour => /z\s*$/i.test(contour)), 'both badge contours must be closed');
    const primarySvg = readPublicSvg(primaryMark);
    const mainPaths = elements(primarySvg, 'path');
    const mainSilhouette = mainPaths.find(path => path.id === 'bubble-silhouette');
    assert.equal(normalizePath(contours[0]), normalizePath(mainSilhouette.d), 'the badge must preserve the approved chat contour');
    assert.deepEqual(paths.filter(path => path.id !== 'badge-silhouette'),
        mainPaths.filter(path => path.id !== 'bubble-silhouette'), 'the badge must preserve the approved S arms');
    assert.deepEqual(elements(svg, 'circle'), elements(primarySvg, 'circle'), 'the badge must preserve the approved S nodes');
});

test('the manifest uses versioned icons at their declared resolution and preserves PWA identity', () => {
    const manifest = JSON.parse(readFileSync(new URL('manifest.webmanifest', publicRoot), 'utf8'));

    assert.deepEqual(manifest.icons, [
        { src: notificationIcon, sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/wa-savana-v15-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ]);
    for (const icon of manifest.icons) {
        const { width, height } = pngDimensions(icon.src);
        assert.equal(icon.sizes, `${width}x${height}`, `${icon.src} must match its declared size`);
    }
    assert.equal(manifest.id, '/');
    assert.equal(manifest.start_url, '/login?source=pwa');
    assert.equal(manifest.scope, '/');
});

test('the shared brand component uses the versioned primary SVG', () => {
    const component = readSource('./WaBrandMark.jsx');
    const imageSources = [...component.matchAll(/\bsrc\s*=\s*["']([^"']+)["']/g)]
        .map(match => match[1]);
    assert.deepEqual(imageSources, [primaryMark]);
});

test('HTML favicon and Apple touch links use the versioned assets and correct sizes', () => {
    const html = readSource('../../../index.html');
    const links = [...html.matchAll(/<link\b[^>]*>/g)].map(match => match[0]);
    const linkWithRel = rel => links.find(link => link.includes(`rel="${rel}"`));

    assert.match(linkWithRel('icon'), /\bhref="\/icons\/favicon-v15-32\.png"/);
    assert.match(linkWithRel('icon'), /\bsizes="32x32"/);
    assert.match(linkWithRel('icon'), /\btype="image\/png"/);
    assert.match(linkWithRel('apple-touch-icon'), /\bhref="\/icons\/apple-touch-icon-v15\.png"/);
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
