#!/usr/bin/env node
'use strict';

// Build-time helper only; no image-processing dependency is added to the app.
const fs = require('node:fs/promises');
const path = require('node:path');

let sharp;
try {
    sharp = require(process.env.SAVANA_SHARP_MODULE || 'sharp');
} catch {
    console.error('PNG export requires sharp. Set SAVANA_SHARP_MODULE to its installed module path.');
    process.exit(1);
}

const root = path.resolve(__dirname, '..');
const publicRoot = path.join(root, 'client/public');
const master = path.join(publicRoot, 'brand/wa-savana-mark-v17.svg');
const badgeMaster = path.join(publicRoot, 'brand/wa-savana-badge-v17.svg');
const appIconMaster = path.join(publicRoot, 'brand/wa-savana-app-icon-v17.svg');
const roundedIconMaster = path.join(publicRoot, 'brand/wa-savana-rounded-icon-v18.svg');
const outputs = [
    ['brand/wa-savana-mark-v17.png', 512],
    ['icons/favicon-v18-16.png', 16],
    ['icons/favicon-v18-32.png', 32],
    ['icons/favicon-v18-48.png', 48],
    ['icons/apple-touch-icon-v17.png', 180, 'app'],
    ['icons/wa-savana-v18-192.png', 192, 'rounded'],
    ['icons/wa-savana-v18-512.png', 512, 'rounded'],
    ['icons/wa-savana-maskable-v17-192.png', 192, 'app'],
    ['icons/wa-savana-maskable-v17-512.png', 512, 'app'],
    ['icons/wa-savana-maskable-v17-1024.png', 1024, 'app'],
    ['icons/wa-savana-badge-v17-96.png', 96],
];
const aliases = [
    ['brand/wa-savana-mark-v17.png', 'logo.png'],
    ['icons/apple-touch-icon-v17.png', 'icons/apple-touch-icon.png'],
    ['icons/wa-savana-v18-192.png', 'icons/wa-savana-192.png'],
    ['icons/wa-savana-v18-512.png', 'icons/wa-savana-512.png'],
    ['icons/favicon-v18.ico', 'favicon.ico'],
];

// Standard ICONDIR with independent, alpha-preserving PNG frames. No additional
// encoder dependency is needed; offsets refer to the exact rendered PNG bytes.
function encodeIco(frames) {
    const directory = Buffer.alloc(6 + frames.length * 16);
    directory.writeUInt16LE(1, 2);
    directory.writeUInt16LE(frames.length, 4);
    let imageOffset = directory.length;
    for (const [index, { size, png }] of frames.entries()) {
        const entry = 6 + index * 16;
        directory[entry] = size === 256 ? 0 : size;
        directory[entry + 1] = size === 256 ? 0 : size;
        directory.writeUInt16LE(1, entry + 4);
        directory.writeUInt16LE(32, entry + 6);
        directory.writeUInt32LE(png.length, entry + 8);
        directory.writeUInt32LE(imageOffset, entry + 12);
        imageOffset += png.length;
    }
    return Buffer.concat([directory, ...frames.map(frame => frame.png)]);
}

async function main() {
    const source = await fs.readFile(master);
    const badgeSource = await fs.readFile(badgeMaster);
    const appIconSource = await fs.readFile(appIconMaster);
    const roundedIconSource = await fs.readFile(roundedIconMaster);
    await fs.mkdir(path.join(publicRoot, 'icons'), { recursive: true });
    for (const [name, size, kind] of outputs) {
        // Render independently from the vector source, never from a smaller PNG.
        const artwork = kind === 'app' ? appIconSource
            : kind === 'rounded' ? roundedIconSource
            : name.includes('-badge-') ? badgeSource : source;
        let render = sharp(artwork, { density: 288 }).resize(size, size);
        if (kind === 'app') {
            render = render.flatten({ background: '#f7f2e8' }).removeAlpha();
        }
        await render.png().toFile(path.join(publicRoot, name));
    }
    await fs.copyFile(master, path.join(publicRoot, 'icons/favicon-v18.svg'));
    const frames = await Promise.all([16, 32, 48].map(async size => ({
        size, png: await fs.readFile(path.join(publicRoot, `icons/favicon-v18-${size}.png`)),
    })));
    await fs.writeFile(path.join(publicRoot, 'icons/favicon-v18.ico'), encodeIco(frames));
    for (const [name, alias] of aliases) {
        await fs.copyFile(path.join(publicRoot, name), path.join(publicRoot, alias));
    }
    console.log('Wa Savana v18 rounded regular/favicon icons and unchanged v17 launcher-safe icons generated.');
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
