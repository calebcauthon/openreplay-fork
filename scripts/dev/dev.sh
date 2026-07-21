#!/usr/bin/env bash
#
# Local dev runner for OpenReplay.
#
# Brings up the full OpenReplay stack (prebuilt release images) on your machine
# at https://localhost, using the existing docker-compose definition under
# scripts/docker-compose but adapted for local use:
#
#   - domain is "localhost" with a Caddy self-signed cert (no public DNS needed)
#   - secrets/passwords are generated once and persisted (so the DB volume keeps
#     matching across restarts)
#   - everything is staged into a gitignored dir, so tracked files are never
#     mutated (unlike scripts/docker-compose/install.sh)
#
# Usage: scripts/dev/dev.sh {up|down|clean|logs|ps|urls}
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DC="$ROOT/scripts/docker-compose"
STAGE="$DC/.local"
LOCAL_ENV="$DC/common.env.local"   # persisted, gitignored (*.env)
PROJECT="openreplay-dev"

GREEN='\033[0;32m'; YELLOW='\033[0;33m'; RED='\033[0;31m'; NC='\033[0m'
info() { echo -e "${GREEN}[dev]${NC} $*"; }
warn() { echo -e "${YELLOW}[dev]${NC} $*"; }
die()  { echo -e "${RED}[dev]${NC} $*" >&2; exit 1; }

# docker compose v2 (plugin) vs legacy docker-compose
compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    die "Docker Compose not found. Install Docker Desktop or the compose plugin."
  fi
}

preflight() {
  command -v docker >/dev/null 2>&1 || die "Docker is not installed / not in PATH."
  docker info >/dev/null 2>&1 || die "Docker daemon not reachable. Start Docker and retry."
  command -v envsubst >/dev/null 2>&1 || die "envsubst not found. Install gettext (macOS: brew install gettext)."

  # OpenReplay publishes amd64-only images. On arm64 hosts (Apple Silicon), force
  # amd64 so Docker pulls the right manifest and runs it under emulation.
  if [[ -z "${DOCKER_DEFAULT_PLATFORM:-}" ]]; then
    case "$(uname -m)" in
      arm64|aarch64)
        export DOCKER_DEFAULT_PLATFORM=linux/amd64
        warn "arm64 host detected -> DOCKER_DEFAULT_PLATFORM=linux/amd64 (images run under emulation; expect slower startup)."
        ;;
    esac
  fi
}

rand() { openssl rand -hex 16; }

# Create common.env.local once, deriving from the tracked common.env:
#   - localhost domain, https protocol
#   - every change_me_* placeholder replaced with a persisted random secret
gen_env() {
  if [[ -f "$LOCAL_ENV" ]]; then
    return
  fi
  info "Generating local secrets -> ${LOCAL_ENV#$ROOT/} (persisted, gitignored)"
  cp "$DC/common.env" "$LOCAL_ENV"

  # Point at localhost over https (Caddy serves a self-signed cert for localhost)
  sed -i.bak "s/^COMMON_DOMAIN_NAME=.*/COMMON_DOMAIN_NAME=localhost/" "$LOCAL_ENV"
  sed -i.bak "s#^COMMON_PROTOCOL=.*#COMMON_PROTOCOL=https#" "$LOCAL_ENV"
  echo 'CADDY_DOMAIN=localhost' >> "$LOCAL_ENV"

  # Replace each unique change_me_* token with a persisted random secret.
  for token in $(grep -oE 'change_me_[a-zA-Z0-9_]*' "$LOCAL_ENV" | sort -u); do
    sed -i.bak "s/${token}/$(rand)/g" "$LOCAL_ENV"
  done
  rm -f "$LOCAL_ENV.bak"
}

# Stage a self-contained copy of the compose project with env files expanded.
stage() {
  rm -rf "$STAGE"
  mkdir -p "$STAGE"
  cp "$DC/docker-compose.yaml" "$STAGE/"
  cp "$DC/nginx.conf" "$STAGE/"
  cp -R "$DC/docker-envs" "$STAGE/"
  cp -R "$DC/migration-files" "$STAGE/"
  cp "$LOCAL_ENV" "$STAGE/common.env"

  # The frontend image's internal nginx has a `server_name localhost` block that
  # serves the stock "Welcome to nginx" page; the real SPA lives on its default
  # server. Since we run on the literal "localhost" domain, forwarding the
  # browser's `Host: localhost` to the frontend hits that welcome block. Send a
  # fixed non-localhost Host for the frontend proxy only (other locations keep
  # their Host — MinIO presigned-URL signatures depend on it).
  sed -i.bak '/set \$upstream_frontend/,/}/ s/proxy_set_header Host \$http_host;/proxy_set_header Host frontend-openreplay;/' "$STAGE/nginx.conf"
  rm -f "$STAGE/nginx.conf.bak"

  # Local Caddyfile: terminate TLS with an internal (self-signed) cert for localhost.
  cat > "$STAGE/Caddyfile" <<'EOF'
localhost {
  reverse_proxy nginx-openreplay:80
  tls internal
}
EOF

  # Expand ${COMMON_*} placeholders inside the service env files (Compose loads
  # env_file entries literally, so they must be substituted ahead of time).
  # NOTE: nginx.conf is intentionally NOT substituted (it uses nginx $variables).
  set -a; . "$STAGE/common.env"; set +a
  for f in "$STAGE"/docker-envs/*.env; do
    envsubst < "$f" > "$f.tmp" && mv "$f.tmp" "$f"
  done

  # We serve https with a self-signed cert, so the signup preflight's SSL
  # health-check (requests.get(SITE_URL, verify=True)) fails and disables
  # "Create Account". SKIP_H_SSL drops that check — the same thing the upstream
  # installer does for private/self-signed domains.
  grep -q '^SKIP_H_SSL=' "$STAGE/docker-envs/chalice.env" || \
    echo 'SKIP_H_SSL=True' >> "$STAGE/docker-envs/chalice.env"
}

dc() {
  # Enable the "migration" profile for every compose command so that down/clean
  # also remove the one-shot migration containers. Otherwise they linger as
  # orphans bound to the (now-deleted) network and break the next `up` with
  # "failed to set up container networking: network ... not found".
  COMPOSE_PROFILES=migration \
    compose -f "$STAGE/docker-compose.yaml" --project-directory "$STAGE" \
    --env-file "$STAGE/common.env" -p "$PROJECT" "$@"
}

cmd_up() {
  preflight
  gen_env
  stage
  info "Starting OpenReplay (prebuilt release images). First run pulls images + runs DB migrations..."
  dc up -d --remove-orphans
  echo
  cmd_urls
}

cmd_down() {
  [[ -d "$STAGE" ]] || { warn "Nothing staged; nothing to stop."; return; }
  info "Stopping stack (data volumes kept)."
  dc down --remove-orphans
}

cmd_clean() {
  if [[ -d "$STAGE" ]]; then
    info "Removing containers + data volumes."
    dc down --volumes --remove-orphans || true
  fi
  rm -rf "$STAGE"
  warn "Removed staging dir. Secrets kept at ${LOCAL_ENV#$ROOT/} (delete it to fully reset)."
}

cmd_logs() { [[ -d "$STAGE" ]] || die "Not running. Try: make dev"; dc logs -f --tail=100 "$@"; }
cmd_ps()   { [[ -d "$STAGE" ]] || die "Not running. Try: make dev"; dc ps; }

cmd_urls() {
  info "OpenReplay is starting up. Give the app/db containers a minute on first boot."
  echo -e "  ${GREEN}App:${NC}      https://localhost   (self-signed cert — accept the browser warning)"
  echo -e "  ${GREEN}Logs:${NC}     make dev-logs"
  echo -e "  ${GREEN}Status:${NC}   make dev-ps"
  echo -e "  ${GREEN}Stop:${NC}     make dev-down     ${GREEN}Reset:${NC} make dev-clean"
}

case "${1:-up}" in
  up)    cmd_up ;;
  down)  cmd_down ;;
  clean) cmd_clean ;;
  logs)  shift; cmd_logs "$@" ;;
  ps)    cmd_ps ;;
  urls)  cmd_urls ;;
  *)     die "Unknown command: $1 (use up|down|clean|logs|ps|urls)" ;;
esac
