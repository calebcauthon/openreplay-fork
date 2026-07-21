#!/usr/bin/env bash
#
# Build the OpenReplay dashboard SPA into frontend/public.
#
# docker-compose bind-mounts that directory over /var/www/openreplay in the frontend
# container, so this is how local changes under frontend/ reach the running stack. The
# container serves static files only — editing .tsx does nothing until this reruns.
#
# After building: `docker restart frontend` (or `make dev`) to be sure nginx picks up
# the new hashed filenames, then hard-reload the browser.
#
# Usage: make dev-frontend
set -Eeuo pipefail

GREEN='\033[0;32m'; YELLOW='\033[0;33m'; RED='\033[0;31m'; NC='\033[0m'
info() { echo -e "${GREEN}[frontend]${NC} $*"; }
warn() { echo -e "${YELLOW}[frontend]${NC} $*"; }
die()  { echo -e "${RED}[frontend]${NC} $*" >&2; exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FE="$ROOT/frontend"

[[ -d "$FE" ]] || die "frontend/ not found at $FE"

# The repo pins yarn 4.x via packageManager, which is only on PATH through corepack.
if command -v yarn >/dev/null 2>&1; then
  YARN=(yarn)
elif command -v corepack >/dev/null 2>&1; then
  info "yarn not on PATH; using corepack."
  corepack enable >/dev/null 2>&1 || true
  YARN=(corepack yarn)
else
  die "Neither yarn nor corepack found. Install Node 18+ (corepack ships with it)."
fi

cd "$FE"

if [[ ! -d node_modules ]]; then
  info "Installing dependencies (first run, this takes a minute)..."
  "${YARN[@]}" install
fi

info "Building SPA -> frontend/public ..."
"${YARN[@]}" build

[[ -f "$FE/public/index.html" ]] || die "Build finished but frontend/public/index.html is missing."
info "Done. $(find "$FE/public" -maxdepth 1 -type f | wc -l | tr -d ' ') files, $(du -sh "$FE/public" | cut -f1)."

if docker inspect frontend >/dev/null 2>&1; then
  info "Restarting the frontend container..."
  docker restart frontend >/dev/null
  info "Restarted. Hard-reload the browser (Cmd+Shift+R) to drop cached assets."
else
  warn "frontend container not running — start the stack with: make dev"
fi
