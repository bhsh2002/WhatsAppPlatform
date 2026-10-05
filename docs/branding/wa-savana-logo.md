# Wa Savana primary logo

The approved local master is `/brand/wa-savana-mark-v15.svg`, accepted on
5 October 2026. It is byte-identical to the approved preview at
`docs/branding/wa-savana-mark-v15-preview.svg`. This revision has not been
published to production.

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
| `/icons/favicon-v15-32.png` | 32×32 | Browser tab |
| `/icons/apple-touch-icon-v15.png` | 180×180 | Apple home-screen icon |
| `/icons/wa-savana-v15-192.png` | 192×192 | PWA and notification icon |
| `/icons/wa-savana-v15-512.png` | 512×512 | PWA icon |
| `/icons/wa-savana-badge-v15-96.png` | 96×96 | Monochrome notification badge |

The badge is rendered from `/brand/wa-savana-badge-v15.svg`. This technical
single-color OS glyph uses the approved speech silhouette, an elliptical
transparent interior, and the two-node mark. Its filled white contour keeps the
S arms connected after alpha masking. It is not used as the colored primary logo.

Versioned paths prevent stale image-cache reuse. The existing `/logo.png`,
`/icons/apple-touch-icon.png`, `/icons/wa-savana-192.png`, and
`/icons/wa-savana-512.png` aliases also contain the v15 logo for compatibility.
The PWA identity, start URL, scope, colors and display mode remain unchanged.
Icons use `purpose: any`; they are not declared maskable.

The shared component is used by the landing header/footer, login/registration,
admin and customer sidebars, mobile header and empty unified conversation view.
Actual WhatsApp channel icons remain channel indicators, not platform logos.

## Regenerate and verify

Run `bash tools/export_brand_assets.sh` with Node.js and the build-time `sharp`
module available. If it is not on Node's module search path, set
`SAVANA_SHARP_MODULE` to its installed module path. This tool does not add a
runtime dependency to the application. Run `npm test`, `npm run lint` and
`npm run build` from `client/`. Asset checks cover the approved source, PNG
dimensions and alpha, primary-brand references, notification badge and unchanged
PWA identity. Review the mark at small sizes and in the local desktop/mobile
login before publication.
