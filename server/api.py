#!/usr/bin/env python3
"""
Game Streamer – backend API server

Endpoints – matches (persistent storage in /app/data/matches.json):
  GET    /api/matches              – list all matches
  GET    /api/matches/:id          – get single match
  POST   /api/matches              – create match (server assigns UUID)
  PUT    /api/matches/:id          – update match
  DELETE /api/matches/:id          – delete match

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

import ipaddress
import json
import os
import re
import socket
import sys
import time
import traceback
import uuid as _uuid
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer

DATA_DIR      = os.environ.get('APP_DATA', '/app/data')
SETTINGS_DIR  = os.path.join(DATA_DIR, 'game-settings')
MATCHES_FILE  = os.path.join(DATA_DIR, 'matches.json')
TOKENS_FILE   = os.path.join(DATA_DIR, 'youtube-tokens.json')
OBS_STATUS_FILE  = os.path.join(DATA_DIR, 'obs-status.json')
OBS_COMMAND_FILE = os.path.join(DATA_DIR, 'obs-command.json')
OBS_SECRET_FILE  = os.path.join(DATA_DIR, 'obs-secret.txt')
os.makedirs(SETTINGS_DIR, exist_ok=True)

GOOGLE_CLIENT_ID     = os.environ.get('GOOGLE_CLIENT_ID', '')
GOOGLE_CLIENT_SECRET = os.environ.get('GOOGLE_CLIENT_SECRET', '')
APP_BASE_URL         = os.environ.get('APP_BASE_URL', '').rstrip('/')

GAME_ID_RE  = re.compile(r'^/api/game-settings/(\d{1,20})$')
MATCH_ID_RE = re.compile(r'^/api/matches/([0-9a-f\-]{36})$')
HEX_COLOR_RE = re.compile(r'^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$')

THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024   # 2 MB
REQUEST_MAX_BYTES   = 64 * 1024         # 64 KB for JSON bodies

MATCH_STR_LIMITS = {
    'awayTeam': 120, 'homeTeam': 120,
    'location': 256, 'competition': 200,
    'gameId': 20,
    'streamDescription': 5000,
    'awayLogoUrl': 2048, 'homeLogoUrl': 2048,
    'awayPrimaryColor': 7, 'awaySecondaryColor': 7,
    'homePrimaryColor': 7, 'homeSecondaryColor': 7,
    'youtubeUrl': 2048, 'streamUrl': 2048,
    'broadcastId': 64,
}
COLOR_FIELDS = {'awayPrimaryColor', 'awaySecondaryColor', 'homePrimaryColor', 'homeSecondaryColor'}

def _validate_match(data):
    for field, max_len in MATCH_STR_LIMITS.items():
        val = data.get(field)
        if val is not None and isinstance(val, str) and len(val) > max_len:
            raise ValueError(f'{field} too long (max {max_len})')
    for f in COLOR_FIELDS:
        val = data.get(f)
        if val and not HEX_COLOR_RE.match(val):
            raise ValueError(f'{f} must be a 3- or 6-digit hex color')

def _log_exc(context=''):
    print(f'[api] {context}: {traceback.format_exc()}', file=sys.stderr, flush=True)


def _get_obs_secret():
    """Return the persistent OBS API secret, generating it on first call."""
    if os.path.exists(OBS_SECRET_FILE):
        try:
            with open(OBS_SECRET_FILE, encoding='utf-8') as f:
                s = f.read().strip()
            if s:
                return s
        except Exception:
            pass
    s = str(_uuid.uuid4())
    with open(OBS_SECRET_FILE, 'w', encoding='utf-8') as f:
        f.write(s)
    try:
        os.chmod(OBS_SECRET_FILE, 0o600)
    except Exception:
        pass
    return s


# Private IPv4/IPv6 ranges that must never be fetched (SSRF guard)
_PRIVATE_NETS = [
    ipaddress.ip_network('10.0.0.0/8'),
    ipaddress.ip_network('172.16.0.0/12'),
    ipaddress.ip_network('192.168.0.0/16'),
    ipaddress.ip_network('127.0.0.0/8'),
    ipaddress.ip_network('169.254.0.0/16'),   # link-local / AWS metadata
    ipaddress.ip_network('100.64.0.0/10'),    # Carrier-grade NAT
    ipaddress.ip_network('::1/128'),
    ipaddress.ip_network('fc00::/7'),
    ipaddress.ip_network('fe80::/10'),
]

def _assert_safe_url(url):
    """Raise ValueError if url is non-HTTPS or resolves to a private address."""
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != 'https':
        raise ValueError('URL must use HTTPS')
    host = parsed.hostname or ''
    if not host:
        raise ValueError('URL has no hostname')
    try:
        infos = socket.getaddrinfo(host, None, socket.AF_UNSPEC, socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise ValueError(f'Could not resolve hostname: {exc}')
    for info in infos:
        addr_str = info[4][0]
        try:
            ip = ipaddress.ip_address(addr_str)
        except ValueError:
            continue
        if any(ip in net for net in _PRIVATE_NETS):
            raise ValueError(f'URL resolves to a private/reserved address ({addr_str})')

ALLOWED_SETTINGS_KEYS = {
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


# ── Matches storage ───────────────────────────────────────────────────────────

def _now_iso():
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')


def _load_matches():
    if not os.path.exists(MATCHES_FILE):
        return []
    try:
        with open(MATCHES_FILE, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return []


def _save_matches(matches):
    tmp = MATCHES_FILE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(matches, f)
    os.replace(tmp, MATCHES_FILE)


def _sync_game_settings(match):
    """Write game-settings file whenever a match with a numeric gameId is saved."""
    game_id = str(match.get('gameId', '')).strip()
    if not game_id or not game_id.isdigit():
        return
    payload = {
        'away':      match.get('awayTeam', ''),
        'home':      match.get('homeTeam', ''),
        'awayColor': match.get('awayPrimaryColor', '#808080'),
        'awayColor2': match.get('awaySecondaryColor', '#606060'),
        'homeColor': match.get('homePrimaryColor', '#808080'),
        'homeColor2': match.get('homeSecondaryColor', '#606060'),
        'awayLogo':  match.get('awayLogoUrl', ''),
        'homeLogo':  match.get('homeLogoUrl', ''),
        'replay':    match.get('replay', False),
    }
    path = os.path.join(SETTINGS_DIR, f'{game_id}.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(payload, f)


# ── OBS helpers ───────────────────────────────────────────────────────────────

def _load_obs_status():
    if not os.path.exists(OBS_STATUS_FILE):
        return {}
    try:
        with open(OBS_STATUS_FILE, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}

def _save_obs_status(data):
    tmp = OBS_STATUS_FILE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f)
    os.replace(tmp, OBS_STATUS_FILE)

def _load_obs_command():
    if not os.path.exists(OBS_COMMAND_FILE):
        return {}
    try:
        with open(OBS_COMMAND_FILE, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}

def _save_obs_command(data):
    tmp = OBS_COMMAND_FILE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f)
    os.replace(tmp, OBS_COMMAND_FILE)

def _obs_connected(status):
    updated = status.get('updatedAt')
    if not updated:
        return False
    try:
        dt = datetime.fromisoformat(updated.replace('Z', '+00:00'))
        return (datetime.now(timezone.utc) - dt).total_seconds() < 15
    except Exception:
        return False


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
    try:
        os.chmod(TOKENS_FILE, 0o600)
    except Exception:
        pass


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
    _assert_safe_url(thumbnail_url)
    parsed = urllib.parse.urlparse(thumbnail_url)
    # Fetch image with tight timeout and size cap to prevent SSRF/DoS
    req = urllib.request.Request(thumbnail_url)
    req.add_header('User-Agent', 'GameStreamer-thumbnail/1.0')
    with urllib.request.urlopen(req, timeout=8) as resp:
        content_type = resp.headers.get('Content-Type', 'image/jpeg').split(';')[0].strip()
        if not content_type.startswith('image/'):
            raise ValueError(f'URL did not return an image (got {content_type})')
        image_data = resp.read(THUMBNAIL_MAX_BYTES + 1)
    if len(image_data) > THUMBNAIL_MAX_BYTES:
        raise ValueError('Thumbnail exceeds 2 MB limit')
    url = f'https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId={broadcast_id}&uploadType=media'
    upload_req = urllib.request.Request(url, data=image_data, method='POST')
    upload_req.add_header('Authorization', f'Bearer {token}')
    upload_req.add_header('Content-Type', content_type)
    with urllib.request.urlopen(upload_req) as resp:
        return json.loads(resp.read())


# ── HTTP handler ──────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def _cors(self):
        if APP_BASE_URL:
            # Production: only echo back the origin if it matches the app's own URL.
            # Same-origin SPA requests don't send Origin, so no CORS header is needed.
            # This prevents cross-origin requests from other websites.
            origin = self.headers.get('Origin', '')
            if origin == APP_BASE_URL:
                self.send_header('Access-Control-Allow-Origin', origin)
                self.send_header('Vary', 'Origin')
        else:
            # Development (no APP_BASE_URL): allow all so vite dev server can reach the API.
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
        if length > REQUEST_MAX_BYTES:
            raise ValueError(f'Request body too large ({length} bytes)')
        return self.rfile.read(length)

    # ── Routing ───────────────────────────────────────────────────────────

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path.startswith('/api/youtube/'):
            self._yt_get()
        elif self.path in ('/api/obs/status', '/api/obs/secret'):
            self._obs_get()
        elif self.path.startswith('/api/matches'):
            self._matches_get()
        else:
            self._settings_get()

    def do_PUT(self):
        if self.path == '/api/obs/status':
            self._obs_put()
        elif self.path.startswith('/api/matches/'):
            self._matches_put()
        else:
            self._settings_put()

    def do_POST(self):
        if self.path.startswith('/api/youtube/'):
            self._yt_post()
        elif self.path == '/api/obs/command':
            self._obs_command_post()
        elif self.path.startswith('/api/matches'):
            self._matches_post()
        else:
            self.send_response(404)
            self.end_headers()

    def do_DELETE(self):
        if self.path == '/api/youtube/disconnect':
            if os.path.exists(TOKENS_FILE):
                os.remove(TOKENS_FILE)
            self._json(200, {'ok': True})
        elif self.path.startswith('/api/matches/'):
            self._matches_delete()
        else:
            self.send_response(404)
            self.end_headers()

    # ── Matches CRUD ──────────────────────────────────────────────────────

    def _matches_get(self):
        m = MATCH_ID_RE.match(self.path)
        if m:
            match_id = m.group(1)
            match = next((x for x in _load_matches() if x['id'] == match_id), None)
            if match:
                self._json(200, match)
            else:
                self._json(404, {'error': 'not found'})
        elif self.path == '/api/matches':
            self._json(200, {'matches': _load_matches()})
        else:
            self._json(404, {'error': 'not found'})

    def _matches_post(self):
        if self.path != '/api/matches':
            self._json(404, {'error': 'not found'})
            return
        try:
            data = json.loads(self._body())
            _validate_match(data)
            now = _now_iso()
            match = {
                'awayTeam': '',
                'homeTeam': '',
                'time': '',
                'location': '',
                'competition': '',
                'gameId': '',
                **data,
                'id': data.get('id') or str(_uuid.uuid4()),
                'createdAt': data.get('createdAt') or now,
                'updatedAt': now,
            }
            matches = _load_matches()
            matches.append(match)
            _save_matches(matches)
            _sync_game_settings(match)
            self._json(201, match)
        except (json.JSONDecodeError, ValueError) as exc:
            self._json(400, {'error': str(exc)})
        except Exception:
            _log_exc('_matches_post')
            self._json(500, {'error': 'Internal server error'})

    def _matches_put(self):
        m = MATCH_ID_RE.match(self.path)
        if not m:
            self._json(404, {'error': 'not found'})
            return
        match_id = m.group(1)
        try:
            data = json.loads(self._body())
            _validate_match(data)
            matches = _load_matches()
            idx = next((i for i, x in enumerate(matches) if x['id'] == match_id), -1)
            if idx == -1:
                self._json(404, {'error': 'not found'})
                return
            updated = {**matches[idx], **data, 'id': match_id, 'updatedAt': _now_iso()}
            matches[idx] = updated
            _save_matches(matches)
            _sync_game_settings(updated)
            self._json(200, updated)
        except (json.JSONDecodeError, ValueError) as exc:
            self._json(400, {'error': str(exc)})
        except Exception:
            _log_exc('_matches_put')
            self._json(500, {'error': 'Internal server error'})

    def _matches_delete(self):
        m = MATCH_ID_RE.match(self.path)
        if not m:
            self._json(404, {'error': 'not found'})
            return
        match_id = m.group(1)
        matches = _load_matches()
        new_matches = [x for x in matches if x['id'] != match_id]
        if len(new_matches) == len(matches):
            self._json(404, {'error': 'not found'})
            return
        _save_matches(new_matches)
        self._json(200, {'ok': True})

    # ── OBS status & commands ─────────────────────────────────────────────────

    def _check_obs_auth(self):
        expected = f'Bearer {_get_obs_secret()}'
        return self.headers.get('Authorization', '') == expected

    def _obs_get(self):
        if self.path == '/api/obs/secret':
            self._json(200, {'secret': _get_obs_secret()})
            return
        status = _load_obs_status()
        command = _load_obs_command()
        self._json(200, {
            'connected':      _obs_connected(status),
            'streaming':      status.get('streaming', False),
            'recording':      status.get('recording', False),
            'scene':          status.get('scene', ''),
            'updatedAt':      status.get('updatedAt'),
            'pendingCommand': command if command.get('id') else None,
        })

    def _obs_put(self):
        if not self._check_obs_auth():
            self._json(401, {'error': 'Unauthorized'})
            return
        try:
            body = json.loads(self._body())
            status = {
                'streaming': bool(body.get('streaming', False)),
                'recording': bool(body.get('recording', False)),
                'scene':     str(body.get('scene', ''))[:200],
                'updatedAt': _now_iso(),
            }
            _save_obs_status(status)
            ack_id = body.get('ackCommandId', '')
            command = _load_obs_command()
            if ack_id and command.get('id') == ack_id:
                _save_obs_command({})
                command = {}
            self._json(200, {'ok': True, 'pendingCommand': command if command.get('id') else None})
        except (json.JSONDecodeError, ValueError) as exc:
            self._json(400, {'error': str(exc)})
        except Exception:
            _log_exc('obs_put')
            self._json(500, {'error': 'Internal server error'})

    def _obs_command_post(self):
        if not self._check_obs_auth():
            self._json(401, {'error': 'Unauthorized'})
            return
        try:
            body = json.loads(self._body())
            command = body.get('command', '')
            if command not in ('start_streaming', 'stop_streaming'):
                self._json(400, {'error': 'command must be start_streaming or stop_streaming'})
                return
            broadcast_id = body.get('broadcastId', '').strip()
            if broadcast_id and not re.match(r'^[A-Za-z0-9_\-]{1,64}$', broadcast_id):
                self._json(400, {'error': 'Invalid broadcastId'})
                return
            cmd = {'id': str(_uuid.uuid4()), 'command': command, 'createdAt': _now_iso()}
            if broadcast_id:
                cmd['broadcastId'] = broadcast_id
            _save_obs_command(cmd)
            self._json(200, {'ok': True, 'commandId': cmd['id']})
        except (json.JSONDecodeError, ValueError) as exc:
            self._json(400, {'error': str(exc)})
        except Exception:
            _log_exc('obs_command_post')
            self._json(500, {'error': 'Internal server error'})

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
            filtered = {k: incoming[k] for k in ALLOWED_SETTINGS_KEYS if k in incoming}
            path = os.path.join(SETTINGS_DIR, f'{gid}.json')
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(filtered, f)
            self._json(200, {'ok': True})
        except (json.JSONDecodeError, ValueError) as exc:
            self._json(400, {'error': str(exc)})
        except Exception:
            _log_exc('_settings_put')
            self._json(500, {'error': 'Internal server error'})

    def _game_id(self):
        m = GAME_ID_RE.match(self.path)
        return m.group(1) if m else None

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

        elif self.path.startswith('/api/youtube/broadcast-status'):
            parsed = urllib.parse.urlparse(self.path)
            params = urllib.parse.parse_qs(parsed.query)
            ids_str = params.get('ids', [''])[0]
            if not ids_str:
                self._json(400, {'error': 'ids param required'})
                return
            token = _get_access_token()
            if not token:
                self._json(401, {'error': 'YouTube not connected'})
                return
            try:
                raw_ids = [i.strip() for i in ids_str.split(',') if i.strip()][:50]
                safe_ids = [i for i in raw_ids if re.match(r'^[A-Za-z0-9_\-]{1,64}$', i)]
                if not safe_ids:
                    self._json(400, {'error': 'No valid ids'})
                    return
                id_param = urllib.parse.quote(','.join(safe_ids))
                data = _yt(
                    f'/liveBroadcasts?part=status,statistics&id={id_param}',
                    token=token,
                )
                statuses = {}
                for item in data.get('items', []):
                    bid = item['id']
                    statuses[bid] = {
                        'status': item.get('status', {}).get('lifeCycleStatus', 'unknown'),
                        'concurrentViewers': int(item.get('statistics', {}).get('concurrentViewers') or 0),
                    }
                self._json(200, {'statuses': statuses})
            except urllib.error.HTTPError as exc:
                self._json(exc.code, {'error': exc.read().decode()})
            except Exception:
                _log_exc('broadcast-status')
                self._json(500, {'error': 'Internal server error'})

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
                        pass

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

        elif self.path == '/api/youtube/transition':
            try:
                body = json.loads(self._body())
                broadcast_id = body.get('broadcastId', '').strip()
                status = body.get('status', '')
                if not broadcast_id or not re.match(r'^[A-Za-z0-9_\-]{1,64}$', broadcast_id):
                    self._json(400, {'error': 'Invalid broadcastId'})
                    return
                if status not in ('testing', 'live', 'complete'):
                    self._json(400, {'error': 'status must be testing, live, or complete'})
                    return
                token = _get_access_token()
                if not token:
                    self._json(401, {'error': 'YouTube not connected'})
                    return
                result = _yt(
                    f'/liveBroadcasts/transition?broadcastStatus={status}'
                    f'&id={urllib.parse.quote(broadcast_id)}&part=id,status',
                    method='POST', body=b'', token=token,
                )
                self._json(200, {
                    'ok': True,
                    'status': result.get('status', {}).get('lifeCycleStatus', 'unknown'),
                })
            except urllib.error.HTTPError as exc:
                self._json(exc.code, {'error': exc.read().decode()})
            except Exception:
                _log_exc('transition')
                self._json(500, {'error': 'Internal server error'})

        elif self.path == '/api/youtube/update-broadcast':
            try:
                body = json.loads(self._body())
                broadcast_id = body.get('broadcastId', '').strip()
                if not broadcast_id or not re.match(r'^[A-Za-z0-9_\-]{1,64}$', broadcast_id):
                    self._json(400, {'error': 'Invalid broadcastId'})
                    return
                token = _get_access_token()
                if not token:
                    self._json(401, {'error': 'YouTube not connected'})
                    return
                existing = _yt(
                    f'/liveBroadcasts?part=snippet,status&id={urllib.parse.quote(broadcast_id)}',
                    token=token,
                )
                items = existing.get('items', [])
                if not items:
                    self._json(404, {'error': 'Broadcast not found'})
                    return
                snippet = dict(items[0].get('snippet', {}))
                status_obj = dict(items[0].get('status', {}))
                if 'title' in body:
                    snippet['title'] = str(body['title'])[:100]
                if 'description' in body:
                    snippet['description'] = str(body['description'])[:5000]
                if 'scheduledStartTime' in body:
                    snippet['scheduledStartTime'] = body['scheduledStartTime']
                if body.get('privacy') in ('public', 'private', 'unlisted'):
                    status_obj['privacyStatus'] = body['privacy']
                update_body = json.dumps({
                    'id': broadcast_id,
                    'snippet': snippet,
                    'status': status_obj,
                }).encode()
                _yt('/liveBroadcasts?part=snippet,status', method='PUT', body=update_body, token=token)
                self._json(200, {'ok': True})
            except urllib.error.HTTPError as exc:
                self._json(exc.code, {'error': exc.read().decode()})
            except Exception:
                _log_exc('update-broadcast')
                self._json(500, {'error': 'Internal server error'})

        else:
            self._json(404, {'error': 'not found'})


if __name__ == '__main__':
    port = int(os.environ.get('API_PORT', '8001'))
    print(f'[api] listening on 127.0.0.1:{port}', flush=True)
    HTTPServer(('127.0.0.1', port), Handler).serve_forever()
