# Wa Savana primary logo

The current approved master is `/brand/wa-savana-mark-v17.svg`, adopted on
9 October 2026. It is byte-identical to
`docs/branding/wa-savana-mark-v17-preview.svg`. The larger curved speech tail,
rounded-square cream background, and increased artwork size were approved
before publication. The earlier v15 mark was published on 5 October 2026
(release `16e33edeeeef280217925118743f7ba6d883abb3`).

## Artwork

The emerald page represents content and page management. Its two aligned white
message lines balance the coral conversation bubble. The bubble retains
Savana's smooth opposing arms, vertically aligned circular nodes and S-shaped
negative space. The curved tail has a rounded end rather than a pointed arrow.
Its body and tail form one continuous filled silhouette.

The closed white border follows only the elliptical body, not the tail. Its
centerline radii are 184×172 units and its width is 28 units; outer body radii are
212×200 units. This leaves a nominal 14-unit coral edge along the principal axes,
preserving the requested 1:2 coral-to-white edge ratio.

Opaque local gradients add color depth: the page uses `#12ad7b`, `#09976b` and
`#087f5b`; the bubble uses `#ff8258`, `#ff633f` and `#f34f32`. White artwork
remains `#ffffff`. There are no raster embeds, filters, shadows, external
resources or internal transparency holes. Resize the entire mark, never stretch
individual shapes.

The website master has a 1024×1024 viewBox, a solid cream `#f7f2e8` tile with
corner radius 224, and the complete approved artwork centered at 88% scale
(`translate(61.44 61.44) scale(0.88)`). Only the exterior corners of this
rounded tile are transparent in the shared SVG, website PNG and favicon.

## Application exports

| Asset | Size | Usage |
| --- | --- | --- |
| `/brand/wa-savana-mark-v17.svg` | Scalable square | Shared rounded-square `WaBrandMark` |
| `/brand/wa-savana-mark-v17.png` | 512×512 | Rounded-square raster compatibility logo |
| `/brand/wa-savana-app-icon-v17.svg` | Scalable square | Opaque, launcher-safe app artwork |
| `/icons/favicon-v18.svg` | Scalable square | Rounded browser icon, identical to the approved primary SVG |
| `/icons/favicon-v18-16.png`, `-32.png`, `-48.png` | 16/32/48 | Rounded PNG browser fallbacks |
| `/icons/favicon-v18.ico` | 16/32/48 frames | Legacy browser icon fallback |
| `/icons/apple-touch-icon-v17.png` | 180×180 | Opaque Apple home-screen icon |
| `/brand/wa-savana-rounded-icon-v18.svg` | Scalable square | Rounded general-purpose icon artwork |
| `/icons/wa-savana-v18-192.png` | 192×192 | Rounded PWA `any` and notification icon |
| `/icons/wa-savana-v18-512.png` | 512×512 | Rounded PWA `any` icon |
| `/icons/wa-savana-maskable-v17-192.png` | 192×192 | Opaque adaptive launcher icon |
| `/icons/wa-savana-maskable-v17-512.png` | 512×512 | Opaque adaptive launcher icon |
| `/icons/wa-savana-maskable-v17-1024.png` | 1024×1024 | High-resolution adaptive launcher icon |
| `/icons/wa-savana-badge-v17-96.png` | 96×96 | Monochrome notification badge |

Maskable and Apple phone icons reuse exactly the approved artwork with a centered 76% scale
(`translate(122.88 122.88) scale(0.76)`) on a full-square opaque cream background.
This increases their size while keeping every painted artwork pixel inside the
guaranteed central circle of radius 40% of the canvas width. Do not pre-round or
pre-mask phone PNGs: the operating system supplies its rounded-square, circular,
or other supported shape. Apple and `maskable` app PNGs remain opaque RGB.

General-purpose `any` and notification icons instead use the v18 rounded cream
tile with the same 76% artwork. They are RGBA, transparent only outside the
rounded tile, so unmasked desktop/browser contexts do not display sharp corners.
Do not use these rounded PNGs as maskable icons. The icon-role separation changes
neither the approved logo drawing nor the primary website's larger 88% scale.

The favicon SVG is copied directly from the approved primary master. PNG
16/32/48 fallbacks are rendered independently from that SVG, then stored as
three alpha-preserving PNG frames in a standard ICO directory. HTML exposes all
formats with SVG last. `/favicon.ico` is a matching ICO alias, served with icon
MIME type and cache revalidation rather than the SPA fallback. Missing `/icons/`
files return 404 instead of HTML.

The monochrome badge derives its outline and S from
`/brand/wa-savana-badge-v17.svg`. It has a technical transparent interior for OS
alpha masking and is not a substitute for the colored platform logo.

The primary logo, Apple/maskable icons and badge retain v17 URLs; changed regular
icons and browser fallbacks use v18 URLs. `/logo.png` and the Apple alias remain
v17, while `/icons/wa-savana-192.png` and `/icons/wa-savana-512.png` match rounded
v18. Older versioned files are retained unchanged for cached applications.
The PWA identity, start URL, scope, theme colors, and display mode are unchanged;
the manifest exposes separate `any` and `maskable` entries.

Already installed apps may need the user to accept an icon update or add the
home-screen shortcut again. Versioned URLs make updates discoverable but cannot
force the operating system to replace installed artwork immediately. See the
[manifest maskable safe zone](https://www.w3.org/TR/appmanifest/#icon-masks),
[Apple web-app icon setup](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html),
[WebKit maskable icon guidance](https://webkit.org/blog/14787/webkit-features-in-safari-17-2/),
and [Chrome app identity updates](https://developer.chrome.com/blog/improvements-to-web-app-updates).

The shared component covers landing header/footer, login/registration, admin
and customer sidebars, mobile header, and empty unified conversations. WhatsApp
channel icons remain channel indicators, not platform branding.

## Regenerate and verify

Run `bash tools/export_brand_assets.sh` with Node.js and build-time `sharp`.
Set `SAVANA_SHARP_MODULE` to an installed module path if necessary. No image
processing dependency is added to the runtime application; every PNG is rendered
directly from its SVG, never from a smaller raster export.

Run `npm test`, `npm run lint`, and `npm run build` from `client/`. Checks cover
source equality, dimensions, RGB maskable/Apple backgrounds, rounded regular and website corners,
all maskable/Apple pixels inside the safe circle, identical artwork across
variant-specific centered scales, ICO directory/PNG frames and aliases, favicon
links and static serving, badge derivation, references, and PWA identity.
Review small sizes and launcher masks before publication. The original company
reference and earlier artwork remain in `docs/branding/` for history.
