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
const outputs = [
    ['brand/wa-savana-mark-v17.png', 512],
    ['icons/favicon-v17-32.png', 32],
    ['icons/apple-touch-icon-v17.png', 180, 'app'],
    ['icons/wa-savana-v17-192.png', 192, 'app'],
    ['icons/wa-savana-v17-512.png', 512, 'app'],
    ['icons/wa-savana-maskable-v17-192.png', 192, 'app'],
    ['icons/wa-savana-maskable-v17-512.png', 512, 'app'],
    ['icons/wa-savana-maskable-v17-1024.png', 1024, 'app'],
    ['icons/wa-savana-badge-v17-96.png', 96],
];
const aliases = [
    ['brand/wa-savana-mark-v17.png', 'logo.png'],
    ['icons/apple-touch-icon-v17.png', 'icons/apple-touch-icon.png'],
    ['icons/wa-savana-v17-192.png', 'icons/wa-savana-192.png'],
    ['icons/wa-savana-v17-512.png', 'icons/wa-savana-512.png'],
];

async function main() {
    const source = await fs.readFile(master);
    const badgeSource = await fs.readFile(badgeMaster);
    const appIconSource = await fs.readFile(appIconMaster);
    await fs.mkdir(path.join(publicRoot, 'icons'), { recursive: true });
    for (const [name, size, kind] of outputs) {
        // Render independently from the vector source, never from a smaller PNG.
        const artwork = kind === 'app' ? appIconSource
            : name.includes('-badge-') ? badgeSource : source;
        let render = sharp(artwork, { density: 288 }).resize(size, size);
        if (kind === 'app') {
            render = render.flatten({ background: '#f7f2e8' }).removeAlpha();
        }
        await render.png().toFile(path.join(publicRoot, name));
    }
    for (const [name, alias] of aliases) {
        await fs.copyFile(path.join(publicRoot, name), path.join(publicRoot, alias));
    }
    console.log('Approved Wa Savana v17 logo, badge and opaque, launcher-safe app icons generated.');
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
