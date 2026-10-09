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
const master = path.join(publicRoot, 'brand/wa-savana-mark-v15.svg');
const badgeMaster = path.join(publicRoot, 'brand/wa-savana-badge-v15.svg');
const appIconMaster = path.join(publicRoot, 'brand/wa-savana-app-icon-v16.svg');
const outputs = [
    ['brand/wa-savana-mark-v15.png', 512],
    ['icons/favicon-v15-32.png', 32],
    ['icons/apple-touch-icon-v15.png', 180],
    ['icons/wa-savana-v15-192.png', 192],
    ['icons/wa-savana-v15-512.png', 512],
    ['icons/wa-savana-badge-v15-96.png', 96],
    ['icons/favicon-v16-32.png', 32, 'favicon'],
    ['icons/apple-touch-icon-v16.png', 180, 'app'],
    ['icons/wa-savana-v16-192.png', 192, 'app'],
    ['icons/wa-savana-v16-512.png', 512, 'app'],
    ['icons/wa-savana-maskable-v16-192.png', 192, 'app'],
    ['icons/wa-savana-maskable-v16-512.png', 512, 'app'],
    ['icons/wa-savana-maskable-v16-1024.png', 1024, 'app'],
];
const aliases = [
    ['brand/wa-savana-mark-v15.png', 'logo.png'],
    ['icons/apple-touch-icon-v16.png', 'icons/apple-touch-icon.png'],
    ['icons/wa-savana-v16-192.png', 'icons/wa-savana-192.png'],
    ['icons/wa-savana-v16-512.png', 'icons/wa-savana-512.png'],
];

async function main() {
    const source = await fs.readFile(master);
    const badgeSource = await fs.readFile(badgeMaster);
    const appIconSource = await fs.readFile(appIconMaster);
    // Browser favicons do not use launcher masks: keep the larger original mark
    // readable at 32px, while giving it the same opaque app background.
    const faviconSource = Buffer.from(source.toString('utf8').replace(
        /(<svg\b[^>]*>)/,
        '$1<rect width="1024" height="1024" fill="#f7f2e8" />',
    ));
    await fs.mkdir(path.join(publicRoot, 'icons'), { recursive: true });
    for (const [name, size, kind] of outputs) {
        // Render independently from the vector source, never from a smaller PNG.
        const artwork = kind === 'app' ? appIconSource
            : kind === 'favicon' ? faviconSource
                : name.includes('-badge-') ? badgeSource : source;
        let render = sharp(artwork, { density: 288 }).resize(size, size);
        if (kind === 'app' || kind === 'favicon') {
            render = render.flatten({ background: '#f7f2e8' }).removeAlpha();
        }
        await render.png().toFile(path.join(publicRoot, name));
    }
    for (const [name, alias] of aliases) {
        await fs.copyFile(path.join(publicRoot, name), path.join(publicRoot, alias));
    }
    console.log('Wa Savana v15 logo and opaque, launcher-safe v16 app icons generated.');
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
