#!/bin/sh
# Cloudron entrypoint
# - Creates nginx writable temp dirs in /tmp (read-only root filesystem)
# - Optionally loads /app/data/config.env to override Keycloak and app settings
# - Generates /tmp/config.js from env vars so the SPA can read them at runtime
set -e

# ── nginx temp dirs ───────────────────────────────────────────────────────
mkdir -p \
  /tmp/nginx/client_temp \
  /tmp/nginx/proxy_temp \
  /tmp/nginx/fastcgi_temp \
  /tmp/nginx/uwsgi_temp \
  /tmp/nginx/scgi_temp

# ── Load config from /app/data/config.env if present ─────────────────────
# On first boot, write a sample file so the user knows which variables to set.
if [ ! -f /app/data/config.env ] && [ ! -f /app/data/config.env.sample ]; then
  cat > /app/data/config.env.sample << 'SAMPLE'
# Game Streamer – runtime configuration
# Copy this file to config.env, fill in your values, and restart the app.
#
KEYCLOAK_URL=https://auth.example.com
KEYCLOAK_REALM=game-streamer
KEYCLOAK_CLIENT_ID=game-streamer-app
APP_BASE_URL=https://gamestreamer.example.com
SAMPLE
fi

if [ -f /app/data/config.env ]; then
  echo "[start.sh] Loading config from /app/data/config.env"
  set -a
  # shellcheck disable=SC1091
  . /app/data/config.env
  set +a
fi

# ── Runtime config (read by the SPA via window.__APP_CONFIG__) ────────────
cat > /tmp/config.js << EOF
window.__APP_CONFIG__ = {
  keycloakUrl:      "${KEYCLOAK_URL:-http://localhost:8080}",
  keycloakRealm:    "${KEYCLOAK_REALM:-game-streamer}",
  keycloakClientId: "${KEYCLOAK_CLIENT_ID:-game-streamer-app}",
  appBaseUrl:       "${APP_BASE_URL:-}"
};
EOF

exec nginx -g 'daemon off;'
