#!/usr/bin/env python3
"""
Game Streamer – game-settings API
Stores per-game scoreboard settings so the OBS Lua script can fetch them.

Endpoints:
  GET  /api/game-settings/{gameId}  – return stored settings JSON
  PUT  /api/game-settings/{gameId}  – save settings JSON
  OPTIONS                           – CORS preflight

Settings are stored as /app/data/game-settings/{gameId}.json
"""

import json
import os
import re
from http.server import BaseHTTPRequestHandler, HTTPServer

DATA_DIR    = os.environ.get('APP_DATA', '/app/data')
SETTINGS_DIR = os.path.join(DATA_DIR, 'game-settings')
os.makedirs(SETTINGS_DIR, exist_ok=True)

GAME_ID_RE = re.compile(r'^/api/game-settings/(\d{1,20})$')

ALLOWED_KEYS = {
    'away', 'home',
    'awayColor', 'awayColor2',
    'homeColor', 'homeColor2',
    'awayLogo', 'homeLogo',
    'replay',
}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass  # suppress noisy access log

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    def _game_id(self):
        m = GAME_ID_RE.match(self.path)
        return m.group(1) if m else None

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        gid = self._game_id()
        if not gid:
            self.send_response(404)
            self.end_headers()
            return
        path = os.path.join(SETTINGS_DIR, f'{gid}.json')
        if os.path.exists(path):
            with open(path, 'rb') as f:
                data = f.read()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self._cors()
            self.end_headers()
            self.wfile.write(data)
        else:
            self.send_response(404)
            self.send_header('Content-Type', 'application/json')
            self._cors()
            self.end_headers()
            self.wfile.write(b'{"error":"not found"}')

    def do_PUT(self):
        gid = self._game_id()
        if not gid:
            self.send_response(404)
            self.end_headers()
            return
        length = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(length)
        try:
            incoming = json.loads(body)
            filtered = {k: incoming[k] for k in ALLOWED_KEYS if k in incoming}
            path = os.path.join(SETTINGS_DIR, f'{gid}.json')
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(filtered, f)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self._cors()
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
        except Exception as exc:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self._cors()
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(exc)}).encode())


if __name__ == '__main__':
    port = int(os.environ.get('API_PORT', '8001'))
    print(f'[api] listening on 127.0.0.1:{port}', flush=True)
    HTTPServer(('127.0.0.1', port), Handler).serve_forever()
