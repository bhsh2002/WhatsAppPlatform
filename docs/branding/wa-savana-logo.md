# Wa Savana primary logo

The approved local master is `/brand/wa-savana-mark-v15.svg`, accepted on
5 October 2026. It is byte-identical to the approved preview at
`docs/branding/wa-savana-mark-v15-preview.svg`. The primary mark was published
to production on 5 October 2026 (release `16e33edeeeef280217925118743f7ba6d883abb3`).

The emerald page represents content and page management. Its narrower width,
less-rounded corners and two aligned white message lines balance the prominent
coral conversation bubble. The bubble retains Savana's smooth opposing arms,
equal vertically aligned circular nodes and S-shaped negative space.
The square viewBox is 1024×1024, with clear margins for small website/app icons.

The bubble body and its short angular coral tail share one continuous filled
contour. A gentle shoulder and rounded tip make the tail distinct without adding
a heavy outline. The closed white border follows only the elliptical body, not
the tail. Its centerline radii are 184×172 units and its width is 28 units; the
outer body radii are 212×200 units. Along the principal axes this leaves a
14-unit coral edge, giving the requested nominal 1:2 coral-to-white ratio.

Two restrained, fully opaque local linear gradients add color depth: the page
runs from `#12ad7b` through `#09976b` to platform green `#087f5b`; the bubble runs
from `#ff8258` through coral `#ff633f` to `#f34f32`. All white artwork remains
`#ffffff`. There are no raster embeds, filters, shadows, external resources or
internal transparency holes. Keep proportions and paths intact; resize the
complete mark, never stretch individual elements.

`savana-reference.png` preserves the original company logo. Superseded public
draft exports are retained under `docs/branding/archive/`, outside the public
asset directory; other design references remain in this documentation folder.
The prior approved raster reference
`wa-savana-page-chat-s-v9.png` and its generation prompt are retained for history.
The v15 master is authored SVG, not a generated bitmap.

## Application exports

The shared UI uses the native SVG for crisp scaling. PNG exports are rendered
directly from that source with `sharp`, retaining the composition and alpha:

| Asset | Size | Usage |
| --- | --- | --- |
| `/brand/wa-savana-mark-v15.svg` | Scalable square | Shared `WaBrandMark` component |
| `/brand/wa-savana-mark-v15.png` | 512×512 | Raster compatibility export |
| `/brand/wa-savana-app-icon-v16.svg` | Scalable square | Opaque, launcher-safe app artwork |
| `/icons/favicon-v16-32.png` | 32×32 | Opaque browser tab icon, larger mark for legibility |
| `/icons/apple-touch-icon-v16.png` | 180×180 | Opaque Apple home-screen icon |
| `/icons/wa-savana-v16-192.png` | 192×192 | Opaque PWA `any` and notification icon |
| `/icons/wa-savana-v16-512.png` | 512×512 | Opaque PWA `any` icon |
| `/icons/wa-savana-maskable-v16-192.png` | 192×192 | Opaque adaptive launcher icon |
| `/icons/wa-savana-maskable-v16-512.png` | 512×512 | Opaque adaptive launcher icon |
| `/icons/wa-savana-maskable-v16-1024.png` | 1024×1024 | High-resolution adaptive launcher icon |
| `/icons/wa-savana-badge-v15-96.png` | 96×96 | Monochrome notification badge |

The badge is rendered from `/brand/wa-savana-badge-v15.svg`. This technical
single-color OS glyph uses the approved speech silhouette, an elliptical
transparent interior, and the two-node mark. Its filled white contour keeps the
S arms connected after alpha masking. It is not used as the colored primary logo.

On 9 October 2026 the home-screen exports were corrected after launcher masks
cropped the transparent artwork. The v16 app source adds a full-square, opaque
cream background (`#f7f2e8`) and scales the complete approved mark to 72% about
the canvas center. Its furthest artwork pixel lies at approximately 38.1% of the
canvas width from the center, inside the guaranteed 40%-radius circle. Do not
pre-round or pre-mask these files: the operating system applies its own shape.
The `any`, Apple and `maskable` app exports share the same composition. The
favicon keeps the larger original composition on the same opaque background.

Versioned paths prevent stale image-cache reuse. `/logo.png` remains the v15
primary mark. The `/icons/apple-touch-icon.png`, `/icons/wa-savana-192.png`, and
`/icons/wa-savana-512.png` aliases now contain v16 app artwork for compatibility.
The PWA identity, start URL, scope, theme colors and display mode remain unchanged.
The manifest declares separate `any` and `maskable` entries.

Already installed apps may require the user to accept an icon update or add the
home-screen icon again; changing icon URLs makes the new assets discoverable but
does not force operating systems to replace installed artwork immediately.
See the [manifest maskable safe zone](https://www.w3.org/TR/appmanifest/#icon-masks),
[Apple web-app icon setup](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html),
[WebKit high-resolution maskable guidance](https://webkit.org/blog/14787/webkit-features-in-safari-17-2/),
and [Chrome app identity updates](https://developer.chrome.com/blog/improvements-to-web-app-updates).

The shared component is used by the landing header/footer, login/registration,
admin and customer sidebars, mobile header and empty unified conversation view.
Actual WhatsApp channel icons remain channel indicators, not platform logos.

## Regenerate and verify

Run `bash tools/export_brand_assets.sh` with Node.js and the build-time `sharp`
module available. If it is not on Node's module search path, set
`SAVANA_SHARP_MODULE` to its installed module path. This tool does not add a
runtime dependency to the application. Run `npm test`, `npm run lint` and
`npm run build` from `client/`. Asset checks cover the approved source, PNG
dimensions, opaque app RGB pixels, maskable pixels inside the safe circle,
primary-brand references, notification badge and unchanged PWA identity. Review
launcher circle/rounded-square masks and small sizes before publication.
