const API = '/api/matches';

export async function getMatches() {
  const r = await fetch(API);
  const d = await r.json();
  return d.matches || [];
}

export async function getMatch(id) {
  const r = await fetch(`${API}/${id}`);
  if (!r.ok) return null;
  return r.json();
}

export async function createMatch(data) {
  const r = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return r.json();
}

export async function updateMatch(id, data) {
  const r = await fetch(`${API}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return r.json();
}

export async function deleteMatch(id) {
  await fetch(`${API}/${id}`, { method: 'DELETE' });
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
// Safe to call on every load — exits immediately if server already has data
// or localStorage is empty.
export async function migrateFromLocalStorage() {
  const LEGACY_KEY = 'game-streamer-matches';
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) return 0;
  let old;
  try { old = JSON.parse(raw); } catch { localStorage.removeItem(LEGACY_KEY); return 0; }
  if (!Array.isArray(old) || !old.length) { localStorage.removeItem(LEGACY_KEY); return 0; }

  const existing = await getMatches();
  if (existing.length > 0) {
    // Server already has authoritative data — just drop the stale local copy.
    localStorage.removeItem(LEGACY_KEY);
    return 0;
  }

  for (const match of old) {
    await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(match),
    });
  }
  localStorage.removeItem(LEGACY_KEY);
  return old.length;
}
