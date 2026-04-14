import Keycloak from 'keycloak-js';

// Runtime config written by start.sh from Cloudron env vars (production).
// Falls back to Vite build-time env vars for local development.
const runtimeCfg = window.__APP_CONFIG__ || {};

const keycloak = new Keycloak({
  url:      runtimeCfg.keycloakUrl      || import.meta.env.VITE_KEYCLOAK_URL      || 'http://localhost:8080',
  realm:    runtimeCfg.keycloakRealm    || import.meta.env.VITE_KEYCLOAK_REALM    || 'game-streamer',
  clientId: runtimeCfg.keycloakClientId || import.meta.env.VITE_KEYCLOAK_CLIENT_ID || 'game-streamer-app',
});

export default keycloak;
