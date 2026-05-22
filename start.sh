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
  # Strip carriage returns so CRLF files (Windows editors) don't break JS output
  _cfg=$(mktemp)
  sed 's/\r//' /app/data/config.env > "$_cfg"
  set -a
  # shellcheck disable=SC1091
  . "$_cfg"
  set +a
  rm -f "$_cfg"
fi

# ── Resolve effective Keycloak settings ───────────────────────────────────
# Priority: config.env (loaded above) > Cloudron keycloak addon > localhost default
KEYCLOAK_URL="${KEYCLOAK_URL:-${CLOUDRON_KEYCLOAK_URL:-http://localhost:8080}}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-${CLOUDRON_KEYCLOAK_REALM:-game-streamer}}"
KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-${CLOUDRON_KEYCLOAK_CLIENT_ID:-game-streamer-app}}"

echo "[start.sh] Keycloak URL:    ${KEYCLOAK_URL}"
echo "[start.sh] Keycloak realm:  ${KEYCLOAK_REALM}"
echo "[start.sh] Keycloak client: ${KEYCLOAK_CLIENT_ID}"

# ── Runtime config (read by the SPA via window.__APP_CONFIG__) ────────────
cat > /tmp/config.js << EOF
window.__APP_CONFIG__ = {
  keycloakUrl:      "${KEYCLOAK_URL}",
  keycloakRealm:    "${KEYCLOAK_REALM}",
  keycloakClientId: "${KEYCLOAK_CLIENT_ID}",
  appBaseUrl:       "${APP_BASE_URL:-}"
};
EOF

# ── Game-settings API (for OBS script integration) ───────────────────────
mkdir -p /app/data/game-settings
python3 /app/api.py &

exec nginx -g 'daemon off;'
