#!/usr/bin/env python3
"""
Game Streamer – backend API server

Endpoints – game settings (OBS Lua integration):
  GET  /api/game-settings/{gameId}  – return stored settings JSON
  PUT  /api/game-settings/{gameId}  – save settings JSON

Endpoints – YouTube scheduling:
  GET    /api/youtube/status        – check if YouTube account is connected
  GET    /api/youtube/auth-url      – get Google OAuth consent URL
  POST   /api/youtube/callback      – exchange auth code for tokens
  DELETE /api/youtube/disconnect    – remove stored tokens
  POST   /api/youtube/schedule      – create & bind a YouTube live broadcast
"""

import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

DATA_DIR      = os.environ.get('APP_DATA', '/app/data')
SETTINGS_DIR  = os.path.join(DATA_DIR, 'game-settings')
TOKENS_FILE   = os.path.join(DATA_DIR, 'youtube-tokens.json')
os.makedirs(SETTINGS_DIR, exist_ok=True)

GOOGLE_CLIENT_ID     = os.environ.get('GOOGLE_CLIENT_ID', '')
GOOGLE_CLIENT_SECRET = os.environ.get('GOOGLE_CLIENT_SECRET', '')
APP_BASE_URL         = os.environ.get('APP_BASE_URL', '').rstrip('/')

GAME_ID_RE = re.compile(r'^/api/game-settings/(\d{1,20})$')

ALLOWED_KEYS = {
    'away', 'home',
    'awayColor', 'awayColor2',
    'homeColor', 'homeColor2',
    'awayLogo', 'homeLogo',
    'replay',
}

GOOGLE_AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth'
GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
YT_API_BASE      = 'https://www.googleapis.com/youtube/v3'
YT_SCOPES        = 'https://www.googleapis.com/auth/youtube'


# ── YouTube helpers ───────────────────────────────────────────────────────────

def _redirect_uri():
    return f'{APP_BASE_URL}/youtube/callback'


def _load_tokens():
    if not os.path.exists(TOKENS_FILE):
        return None
    with open(TOKENS_FILE, encoding='utf-8') as f:
        return json.load(f)


def _save_tokens(tokens):
    with open(TOKENS_FILE, 'w', encoding='utf-8') as f:
        json.dump(tokens, f)


def _get_access_token():
    tokens = _load_tokens()
    if not tokens:
        return None
    if tokens.get('expires_at', 0) > time.time() + 60:
        return tokens['access_token']
    refresh_token = tokens.get('refresh_token')
    if not refresh_token:
        return None
    data = urllib.parse.urlencode({
        'client_id':     GOOGLE_CLIENT_ID,
        'client_secret': GOOGLE_CLIENT_SECRET,
        'refresh_token': refresh_token,
        'grant_type':    'refresh_token',
    }).encode()
    req = urllib.request.Request(GOOGLE_TOKEN_URL, data=data, method='POST')
    req.add_header('Content-Type', 'application/x-www-form-urlencoded')
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read())
    tokens['access_token'] = result['access_token']
    tokens['expires_at']   = time.time() + result.get('expires_in', 3600)
    _save_tokens(tokens)
    return tokens['access_token']


def _yt(path, method='GET', body=None, token=None):
    req = urllib.request.Request(f'{YT_API_BASE}{path}', data=body, method=method)
    req.add_header('Authorization', f'Bearer {token}')
    if body:
        req.add_header('Content-Type', 'application/json')
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def _upload_thumbnail(broadcast_id, thumbnail_url, token):
    with urllib.request.urlopen(thumbnail_url, timeout=15) as resp:
        image_data    = resp.read()
        content_type  = resp.headers.get('Content-Type', 'image/jpeg').split(';')[0].strip()
    url = f'https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId={broadcast_id}&uploadType=media'
    req = urllib.request.Request(url, data=image_data, method='POST')
    req.add_header('Authorization', f'Bearer {token}')
    req.add_header('Content-Type', content_type)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


# ── HTTP handler ──────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass  # suppress noisy access log

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    def _json(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        length = int(self.headers.get('Content-Length') or 0)
        return self.rfile.read(length)

    def _game_id(self):
        m = GAME_ID_RE.match(self.path)
        return m.group(1) if m else None

    # ── Routing ───────────────────────────────────────────────────────────

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path.startswith('/api/youtube/'):
            self._yt_get()
        else:
            self._settings_get()

    def do_PUT(self):
        self._settings_put()

    def do_POST(self):
        if self.path.startswith('/api/youtube/'):
            self._yt_post()
        else:
            self.send_response(404)
            self.end_headers()

    def do_DELETE(self):
        if self.path == '/api/youtube/disconnect':
            if os.path.exists(TOKENS_FILE):
                os.remove(TOKENS_FILE)
            self._json(200, {'ok': True})
        else:
            self.send_response(404)
            self.end_headers()

    # ── Game-settings ─────────────────────────────────────────────────────

    def _settings_get(self):
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
            self._json(404, {'error': 'not found'})

    def _settings_put(self):
        gid = self._game_id()
        if not gid:
            self.send_response(404)
            self.end_headers()
            return
        try:
            incoming = json.loads(self._body())
            filtered = {k: incoming[k] for k in ALLOWED_KEYS if k in incoming}
            path = os.path.join(SETTINGS_DIR, f'{gid}.json')
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(filtered, f)
            self._json(200, {'ok': True})
        except Exception as exc:
            self._json(400, {'error': str(exc)})

    # ── YouTube OAuth & scheduling ────────────────────────────────────────

    def _yt_get(self):
        if self.path == '/api/youtube/status':
            tokens = _load_tokens()
            connected = bool(tokens and tokens.get('refresh_token'))
            self._json(200, {'connected': connected})

        elif self.path == '/api/youtube/auth-url':
            if not GOOGLE_CLIENT_ID:
                self._json(503, {'error': 'GOOGLE_CLIENT_ID not configured'})
                return
            params = urllib.parse.urlencode({
                'client_id':     GOOGLE_CLIENT_ID,
                'redirect_uri':  _redirect_uri(),
                'response_type': 'code',
                'scope':         YT_SCOPES,
                'access_type':   'offline',
                'prompt':        'consent',
            })
            self._json(200, {'url': f'{GOOGLE_AUTH_URL}?{params}'})

        else:
            self._json(404, {'error': 'not found'})

    def _yt_post(self):
        if self.path == '/api/youtube/callback':
            try:
                body = json.loads(self._body())
                code = body.get('code', '')
                if not code:
                    self._json(400, {'error': 'missing code'})
                    return
                data = urllib.parse.urlencode({
                    'code':          code,
                    'client_id':     GOOGLE_CLIENT_ID,
                    'client_secret': GOOGLE_CLIENT_SECRET,
                    'redirect_uri':  _redirect_uri(),
                    'grant_type':    'authorization_code',
                }).encode()
                req = urllib.request.Request(GOOGLE_TOKEN_URL, data=data, method='POST')
                req.add_header('Content-Type', 'application/x-www-form-urlencoded')
                with urllib.request.urlopen(req) as resp:
                    result = json.loads(resp.read())
                if 'refresh_token' not in result:
                    self._json(400, {'error': 'No refresh token received. Try disconnecting and reconnecting.'})
                    return
                _save_tokens({
                    'access_token':  result['access_token'],
                    'refresh_token': result['refresh_token'],
                    'expires_at':    time.time() + result.get('expires_in', 3600),
                })
                self._json(200, {'ok': True})
            except Exception as exc:
                self._json(400, {'error': str(exc)})

        elif self.path == '/api/youtube/schedule':
            try:
                body = json.loads(self._body())
                token = _get_access_token()
                if not token:
                    self._json(401, {'error': 'YouTube not connected'})
                    return

                title          = body.get('title', 'Baseball Game')
                scheduled_time = body.get('scheduledStartTime', '')
                description    = body.get('description', '')
                privacy        = body.get('privacy', 'unlisted')
                thumbnail_url  = body.get('thumbnailUrl', '')

                if not scheduled_time:
                    self._json(400, {'error': 'scheduledStartTime is required'})
                    return

                # 1. Create broadcast
                broadcast_body = json.dumps({
                    'snippet': {
                        'title':              title,
                        'description':        description,
                        'scheduledStartTime': scheduled_time,
                    },
                    'status': {
                        'privacyStatus': privacy,
                    },
                    'contentDetails': {
                        'enableAutoStart': False,
                        'enableAutoStop':  False,
                        'monitorStream':   {'enableMonitorStream': False},
                    },
                }).encode()
                broadcast = _yt(
                    '/liveBroadcasts?part=snippet,status,contentDetails',
                    method='POST', body=broadcast_body, token=token,
                )
                broadcast_id = broadcast['id']

                # 2. Find persistent stream (fixed key)
                streams = _yt(
                    '/liveStreams?part=id,snippet&mine=true&maxResults=5',
                    token=token,
                )
                items = streams.get('items', [])
                if not items:
                    self._json(400, {'error': 'No persistent stream key found. Create one in YouTube Studio first.'})
                    return
                stream_id = items[0]['id']

                # 3. Bind broadcast to stream
                _yt(
                    f'/liveBroadcasts/bind?id={broadcast_id}&streamId={stream_id}&part=id,contentDetails',
                    method='POST', body=b'', token=token,
                )

                # 4. Upload thumbnail if provided (best-effort)
                thumb_ok = False
                if thumbnail_url:
                    try:
                        _upload_thumbnail(broadcast_id, thumbnail_url, token)
                        thumb_ok = True
                    except Exception:
                        pass  # thumbnail failure doesn't fail the whole schedule

                self._json(200, {
                    'ok':           True,
                    'broadcastId':  broadcast_id,
                    'broadcastUrl': f'https://youtu.be/{broadcast_id}',
                    'streamId':     stream_id,
                    'thumbnailSet': thumb_ok,
                })
            except urllib.error.HTTPError as exc:
                err_body = exc.read().decode()
                self._json(exc.code, {'error': err_body})
            except Exception as exc:
                self._json(500, {'error': str(exc)})

        else:
            self._json(404, {'error': 'not found'})


if __name__ == '__main__':
    port = int(os.environ.get('API_PORT', '8001'))
    print(f'[api] listening on 127.0.0.1:{port}', flush=True)
    HTTPServer(('127.0.0.1', port), Handler).serve_forever()
