#!/bin/sh
# Cloudron mounts the root filesystem read-only.
# nginx needs writable directories for temp files and its PID — create them in /tmp.
set -e

mkdir -p \
  /tmp/nginx/client_temp \
  /tmp/nginx/proxy_temp \
  /tmp/nginx/fastcgi_temp \
  /tmp/nginx/uwsgi_temp \
  /tmp/nginx/scgi_temp

exec nginx -g 'daemon off;'
