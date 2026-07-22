#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f server/.env ]]; then
  echo "Missing server/.env; copy server/.env.example and supply production secrets" >&2
  exit 2
fi

mkdir -p data server/uploads
docker network inspect savana-control-plane-network >/dev/null

compose=(docker compose -f docker-compose.server.yml)
"${compose[@]}" config --quiet
"${compose[@]}" build
"${compose[@]}" up -d --remove-orphans --wait --wait-timeout 300

if [[ "$(docker inspect --format '{{if index .NetworkSettings.Networks "wa-savana-network"}}connected{{end}}' nginx_proxy_manager)" != "connected" ]]; then
  docker network connect wa-savana-network nginx_proxy_manager
fi

"${compose[@]}" ps
