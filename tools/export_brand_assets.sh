#!/usr/bin/env bash
set -euo pipefail

brand_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "$brand_root/tools/export_brand_assets.cjs"
