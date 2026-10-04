# Wa Savana primary logo

The approved master is `wa-savana-page-chat-s-v9.png`. Its blue page represents
content and page management; the coral conversation bubble carries Savana's
smooth two-node mark and S-shaped negative space. The coral outer border is
approximately half the thickness of the white perimeter. Do not redraw or stretch
the mark when creating application exports.

`savana-reference.png` preserves the original company logo. Earlier design drafts
are not application assets. The approved artwork was generated with the built-in
image tool; its final refinement prompt is in `wa-savana-page-chat-s-v9.md`.

## Application exports

All PNG exports retain the approved composition and transparency. Mechanical
resizing uses macOS `sips` and introduces no artwork changes:

| Asset | Size | Usage |
| --- | --- | --- |
| `/brand/wa-savana-mark-v9.png` | 512×512 | Shared `WaBrandMark` component |
| `/icons/favicon-v9-32.png` | 32×32 | Browser tab |
| `/icons/apple-touch-icon-v9.png` | 180×180 | Apple home-screen icon |
| `/icons/wa-savana-v9-192.png` | 192×192 | PWA and notification icon |
| `/icons/wa-savana-v9-512.png` | 512×512 | PWA icon |
| `/icons/wa-savana-badge-v9-96.png` | 96×96 | Notification badge (browser masks alpha) |

Versioned paths prevent stale image-cache reuse. The existing `/logo.png`,
`/icons/apple-touch-icon.png`, `/icons/wa-savana-192.png`, and
`/icons/wa-savana-512.png` aliases also contain the approved logo for compatibility.
The PWA identity, start URL, scope, colors and display mode remain unchanged.
Icons use `purpose: any`; they are not declared maskable.

The shared component is used by the landing header/footer, login/registration,
admin and customer sidebars, mobile header and empty unified conversation view.
Actual WhatsApp channel icons remain channel indicators, not platform logos.

## Regenerate and verify

Run `bash tools/export_brand_assets.sh` on macOS, then run `npm test`,
`npm run lint` and `npm run build` from `client/`. The asset contract tests verify
PNG dimensions, all primary-brand references and the unchanged PWA identity.
