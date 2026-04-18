const API = '/api/matches';

async function _checkOk(r, context) {
  if (!r.ok) throw new Error(`${context} failed: ${r.status}`);
  return r;
}

export async function getMatches() {
  try {
    const r = await fetch(API);
    if (!r.ok) return [];
    const d = await r.json();
    return d.matches || [];
  } catch {
    return [];
  }
}

export async function getMatch(id) {
  try {
    const r = await fetch(`${API}/${id}`);
    if (!r.ok) return null;
    return r.json();
  } catch {
    return null;
  }
}

export async function createMatch(data) {
  const r = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  await _checkOk(r, 'createMatch');
  return r.json();
}

export async function updateMatch(id, data) {
  const r = await fetch(`${API}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  await _checkOk(r, 'updateMatch');
  return r.json();
}

export async function deleteMatch(id) {
  const r = await fetch(`${API}/${id}`, { method: 'DELETE' });
  if (!r.ok) throw new Error(`deleteMatch failed: ${r.status}`);
}

export async function duplicateMatch(id) {
  const match = await getMatch(id);
  if (!match) return null;
  // eslint-disable-next-line no-unused-vars
  const { id: _id, createdAt: _ca, updatedAt: _ua, youtubeUrl: _yt, ...rest } = match;
  return createMatch(rest);
}

export async function setMatchYouTubeUrl(id, youtubeUrl) {
  return updateMatch(id, { youtubeUrl });
}

// One-time migration: move any existing localStorage matches to the server.
export async function migrateFromLocalStorage() {
  const LEGACY_KEY = 'game-streamer-matches';
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) return 0;
  let old;
  try { old = JSON.parse(raw); } catch { localStorage.removeItem(LEGACY_KEY); return 0; }
  if (!Array.isArray(old) || !old.length) { localStorage.removeItem(LEGACY_KEY); return 0; }

  const existing = await getMatches();
  if (existing.length > 0) {
    localStorage.removeItem(LEGACY_KEY);
    return 0;
  }

  let migrated = 0;
  for (const match of old) {
    try {
      await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(match),
      });
      migrated++;
    } catch { /* skip individual failures */ }
  }
  localStorage.removeItem(LEGACY_KEY);
  return migrated;
}
