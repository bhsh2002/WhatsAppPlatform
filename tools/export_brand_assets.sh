#!/usr/bin/env bash
set -euo pipefail

brand_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
brand_master="$brand_root/docs/branding/wa-savana-page-chat-s-v9.png"
brand_public="$brand_root/client/public"

command -v sips >/dev/null || {
  printf '%s\n' 'Regenerating these checked-in PNG exports requires macOS sips.' >&2
  exit 1
}
[[ -s "$brand_master" ]] || {
  printf '%s\n' 'Approved v9 master is missing.' >&2
  exit 1
}

mkdir -p "$brand_public/brand" "$brand_public/icons"

export_icon() {
  local size="$1"
  local target="$2"
  sips --resampleHeightWidth "$size" "$size" "$brand_master" \
    --out "$brand_public/$target" >/dev/null
}

export_icon 512 brand/wa-savana-mark-v9.png
export_icon 32 icons/favicon-v9-32.png
export_icon 180 icons/apple-touch-icon-v9.png
export_icon 192 icons/wa-savana-v9-192.png
export_icon 512 icons/wa-savana-v9-512.png
export_icon 96 icons/wa-savana-badge-v9-96.png

cp "$brand_public/brand/wa-savana-mark-v9.png" "$brand_public/logo.png"
cp "$brand_public/icons/apple-touch-icon-v9.png" "$brand_public/icons/apple-touch-icon.png"
cp "$brand_public/icons/wa-savana-v9-192.png" "$brand_public/icons/wa-savana-192.png"
cp "$brand_public/icons/wa-savana-v9-512.png" "$brand_public/icons/wa-savana-512.png"

printf '%s\n' 'Approved Wa Savana v9 PNG exports generated.'
