import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const publicRoot = new URL('../../../public/', import.meta.url);
const primaryMark = '/brand/wa-savana-mark-v17.svg';
const notificationIcon = '/icons/wa-savana-v17-192.png';
const notificationBadge = '/icons/wa-savana-badge-v17-96.png';
const iconBackground = [0xf7, 0xf2, 0xe8];
const expectedAssets = [
    ['/brand/wa-savana-mark-v17.png', 512, 6],
    ['/icons/favicon-v17-32.png', 32, 6],
    ['/icons/apple-touch-icon-v17.png', 180, 2],
    [notificationIcon, 192, 2],
    ['/icons/wa-savana-v17-512.png', 512, 2],
    ['/icons/wa-savana-maskable-v17-192.png', 192, 2],
    ['/icons/wa-savana-maskable-v17-512.png', 512, 2],
    ['/icons/wa-savana-maskable-v17-1024.png', 1024, 2],
    [notificationBadge, 96, 6],
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
const svgArtwork = svg => svg
    .replace(/^[\s\S]*?<svg\b[^>]*>/i, '')
    .replace(/<\/svg>\s*$/i, '')
    .replace(/<(title|desc)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

const readPng = path => {
    const png = readFileSync(new URL(path.slice(1), publicRoot));
    assert.ok(png.length >= 33, `${path} must contain a complete PNG header`);
    assert.deepEqual(
        png.subarray(0, 8),
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        `${path} must have a PNG signature`,
    );
    assert.equal(png.readUInt32BE(8), 13, `${path} must have a standard IHDR chunk`);
    assert.equal(png.toString('ascii', 12, 16), 'IHDR', `${path} must start with IHDR`);
    return png;
};

const pngDimensions = path => {
    const png = readPng(path);
    return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
};

// Read actual RGB/RGBA pixels without a native image dependency in CI. RGB
// phone icons cannot use a transparency chunk; platform tiles retain alpha
// only outside their rounded background.
const decodePngPixels = (path, colorType = 2) => {
    const png = readPng(path);
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    assert.equal(png[24], 8, `${path} must use 8-bit channels`);
    assert.equal(png[25], colorType, `${path} must use PNG color type ${colorType}`);
    assert.deepEqual([...png.subarray(26, 29)], [0, 0, 0], `${path} must use standard PNG compression and no interlacing`);
    const imageChunks = [];
    let complete = false;
    for (let offset = 8; offset < png.length;) {
        assert.ok(offset + 12 <= png.length, `${path} must contain complete PNG chunks`);
        const length = png.readUInt32BE(offset);
        const type = png.toString('ascii', offset + 4, offset + 8);
        const end = offset + 12 + length;
        assert.ok(end <= png.length, `${path} must not contain a truncated ${type} chunk`);
        assert.notEqual(type, 'tRNS', `${path} must not make any RGB pixels transparent`);
        if (type === 'IDAT') imageChunks.push(png.subarray(offset + 8, offset + 8 + length));
        if (type === 'IEND') {
            complete = true;
            break;
        }
        offset = end;
    }
    assert.ok(complete && imageChunks.length > 0, `${path} must contain complete pixel data`);
    const filtered = inflateSync(Buffer.concat(imageChunks));
    const channels = colorType === 6 ? 4 : 3;
    const stride = width * channels;
    assert.equal(filtered.length, (stride + 1) * height, `${path} must contain every pixel`);
    const pixels = Buffer.alloc(stride * height);
    const paeth = (left, above, upperLeft) => {
        const estimate = left + above - upperLeft;
        const leftDistance = Math.abs(estimate - left);
        const aboveDistance = Math.abs(estimate - above);
        const upperLeftDistance = Math.abs(estimate - upperLeft);
        if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
        return aboveDistance <= upperLeftDistance ? above : upperLeft;
    };
    for (let y = 0; y < height; y++) {
        const filter = filtered[y * (stride + 1)];
        assert.ok(filter <= 4, `${path} must use a valid PNG row filter`);
        for (let byte = 0; byte < stride; byte++) {
            const index = y * stride + byte;
            const left = byte >= channels ? pixels[index - channels] : 0;
            const above = y > 0 ? pixels[index - stride] : 0;
            const upperLeft = y > 0 && byte >= channels ? pixels[index - stride - channels] : 0;
            const prediction = [0, left, above, Math.floor((left + above) / 2), paeth(left, above, upperLeft)][filter];
            pixels[index] = (filtered[y * (stride + 1) + byte + 1] + prediction) & 0xff;
        }
    }
    return { width, height, pixels };
};

const decodeOpaqueRgbPng = path => decodePngPixels(path);

for (const [path, size, colorType] of expectedAssets) {
    test(`${path} is a ${size}x${size} PNG`, () => {
        assert.deepEqual(pngDimensions(path), { width: size, height: size });
        assert.equal(readPng(path)[25], colorType, `${path} must use the intended opaque or transparent PNG format`);
    });
}

test('phone icons have opaque warm backgrounds and visible artwork', () => {
    for (const [path, , colorType] of expectedAssets) {
        if (colorType !== 2) continue;
        const { width, height, pixels } = decodeOpaqueRgbPng(path);
        for (const [x, y] of [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]]) {
            const index = (y * width + x) * 3;
            assert.deepEqual([...pixels.subarray(index, index + 3)], iconBackground, `${path} must keep its background at every corner`);
        }
        let paintedPixels = 0;
        for (let index = 0; index < pixels.length; index += 3) {
            if (iconBackground.some((channel, offset) => pixels[index + offset] !== channel)) paintedPixels++;
        }
        assert.ok(paintedPixels > width * height * 0.05, `${path} must contain the logo, not just a solid background`);
    }
});

test('the platform PNG and favicon retain an opaque cream tile with transparent rounded corners', () => {
    for (const path of ['/brand/wa-savana-mark-v17.png', '/icons/favicon-v17-32.png']) {
        const { width, height, pixels } = decodePngPixels(path, 6);
        for (const [x, y] of [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]]) {
            assert.equal(pixels[(y * width + x) * 4 + 3], 0, `${path} must leave rounded corners outside the tile transparent`);
        }
        const inset = Math.max(1, Math.floor(width * 0.05));
        for (const [x, y] of [[Math.floor(width / 2), inset], [Math.floor(width / 2), height - 1 - inset], [inset, Math.floor(height / 2)], [width - 1 - inset, Math.floor(height / 2)]]) {
            const index = (y * width + x) * 4;
            assert.deepEqual([...pixels.subarray(index, index + 4)], [...iconBackground, 255], `${path} must have a fully opaque cream background within the rounded tile`);
        }
    }
});

test('all maskable and Apple icons keep the logo inside the phone launcher safe circle', () => {
    const safeCircleAssets = expectedAssets.filter(([path]) => /maskable|apple-touch-icon/.test(path));
    for (const [path] of safeCircleAssets) {
        const { width, height, pixels } = decodeOpaqueRgbPng(path);
        const radiusSquared = (width * 0.4) ** 2;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const index = (y * width + x) * 3;
                if (iconBackground.every((channel, offset) => pixels[index + offset] === channel)) continue;
                const distanceSquared = (x + 0.5 - width / 2) ** 2 + (y + 0.5 - height / 2) ** 2;
                assert.ok(distanceSquared <= radiusSquared, `${path}: launcher masks must not clip the logo pixel at (${x}, ${y})`);
            }
        }
    }
});

test('the public master is byte-identical to the approved v17 SVG preview', () => {
    const approvedSource = readFileSync(new URL('../../../../docs/branding/wa-savana-mark-v17-preview.svg', import.meta.url));
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
        if (paint === '#ffffff' || paint === '#f7f2e8' || paint === 'none') continue;
        const reference = paint.match(/^url\(#([a-z][\w-]*)\)$/);
        assert.ok(reference && gradientIds.has(reference[1]), 'colored paints must resolve to a defined local gradient');
    }
    for (const gradientId of gradientIds) {
        assert.ok(paints.includes(`url(#${gradientId})`), 'each defined gradient must be used by the mark');
    }
});

test('the primary and phone icons share approved artwork at their variant-specific centered scales', () => {
    const appIcon = readPublicSvg('/brand/wa-savana-app-icon-v17.svg');
    assertSafeSquareSvg(appIcon);
    const primarySvg = readPublicSvg(primaryMark);
    assert.deepEqual(elements(appIcon, 'g'), [{ transform: 'translate(122.88 122.88) scale(0.76)' }], 'the phone artwork must retain its centered launcher-safe scale');
    assert.deepEqual(elements(primarySvg, 'g'), [{ transform: 'translate(61.44 61.44) scale(0.88)' }], 'the platform artwork must use the larger centered scale within its rounded square');
    const artworkGroup = appIcon.match(/<g\b[^>]*>([\s\S]*?)<\/g>/i);
    const primaryGroup = primarySvg.match(/<g\b[^>]*>([\s\S]*?)<\/g>/i);
    assert.ok(artworkGroup && primaryGroup, 'both icons must contain the approved artwork');
    assert.equal(artworkGroup[1].replace(/\s+/g, ' ').trim(), primaryGroup[1].replace(/\s+/g, ' ').trim(), 'phone exports must reuse all approved shapes and colors without redrawing them');
    const background = svgArtwork(appIcon.replace(artworkGroup[0], ''));
    assert.deepEqual(elements(background, 'rect'), [{ width: '1024', height: '1024', fill: '#f7f2e8' }], 'the approved artwork must sit on a full opaque cream background');
    assert.match(background, /^<rect\b[^>]*\/?>$/, 'the phone icon must not add artwork outside the scaled group');
    const primaryBackground = svgArtwork(primarySvg.replace(primaryGroup[0], ''));
    assert.deepEqual(elements(primaryBackground, 'rect'), [{ width: '1024', height: '1024', rx: '224', fill: '#f7f2e8' }], 'the platform logo must use the approved rounded cream square');
    assert.match(primaryBackground, /^<rect\b[^>]*\/?>$/, 'the platform logo must not add artwork outside the scaled group');
});

test('the monochrome notification badge derives its silhouette and S from the approved primary mark', () => {
    const svg = readPublicSvg('/brand/wa-savana-badge-v17.svg');
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
        { src: '/icons/wa-savana-v17-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icons/wa-savana-maskable-v17-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
        { src: '/icons/wa-savana-maskable-v17-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        { src: '/icons/wa-savana-maskable-v17-1024.png', sizes: '1024x1024', type: 'image/png', purpose: 'maskable' },
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

    assert.match(linkWithRel('icon'), /\bhref="\/icons\/favicon-v17-32\.png"/);
    assert.match(linkWithRel('icon'), /\bsizes="32x32"/);
    assert.match(linkWithRel('icon'), /\btype="image\/png"/);
    assert.match(linkWithRel('apple-touch-icon'), /\bhref="\/icons\/apple-touch-icon-v17\.png"/);
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
