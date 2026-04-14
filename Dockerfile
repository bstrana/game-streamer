# ── Stage 1: Build ──────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /build

# Install dependencies first (leverages layer cache)
COPY package.json package-lock.json* ./
RUN npm ci --prefer-offline

# Copy source and build
COPY . .

# Build args become VITE_ env vars at build time.
# At runtime these are re-injected via entrypoint for dynamic config.
ARG VITE_KEYCLOAK_URL=http://localhost:8080
ARG VITE_KEYCLOAK_REALM=game-streamer
ARG VITE_KEYCLOAK_CLIENT_ID=game-streamer-app
ARG VITE_APP_BASE_URL=http://localhost:8000

ENV VITE_KEYCLOAK_URL=$VITE_KEYCLOAK_URL \
    VITE_KEYCLOAK_REALM=$VITE_KEYCLOAK_REALM \
    VITE_KEYCLOAK_CLIENT_ID=$VITE_KEYCLOAK_CLIENT_ID \
    VITE_APP_BASE_URL=$VITE_APP_BASE_URL

RUN npm run build

# ── Stage 2: Runtime ─────────────────────────────────────────────────────
FROM nginx:1.27-alpine

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy built SPA and nginx config
COPY --from=builder /build/dist /app/dist
COPY nginx.conf /etc/nginx/conf.d/app.conf

# Cloudron runs as non-root; nginx needs to bind to non-privileged port
# Port 8000 is already non-privileged, nginx worker can run as nobody
RUN chown -R nginx:nginx /app/dist && \
    chmod -R 755 /app/dist

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:8000/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
