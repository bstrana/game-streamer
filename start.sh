#!/bin/sh
# Cloudron entrypoint
# - Creates nginx writable temp dirs in /tmp (read-only root filesystem)
# - Generates /tmp/config.js from Cloudron env vars so the SPA can read
#   Keycloak settings at runtime without rebuilding the Docker image
set -e

# ── nginx temp dirs ───────────────────────────────────────────────────────
mkdir -p \
  /tmp/nginx/client_temp \
  /tmp/nginx/proxy_temp \
  /tmp/nginx/fastcgi_temp \
  /tmp/nginx/uwsgi_temp \
  /tmp/nginx/scgi_temp

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
