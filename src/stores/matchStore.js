import { v4 as uuidv4 } from 'uuid';

const STORAGE_KEY = 'game-streamer-matches';

/**
 * @typedef {Object} Match
 * @property {string} id
 * @property {string} awayTeam
 * @property {string} homeTeam
 * @property {string} time        - ISO datetime string
 * @property {string} location
 * @property {string} competition
 * @property {string} gameId      - WBSC game ID (optional)
 * @property {string} createdAt
 * @property {string} updatedAt
 */

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function persist(matches) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(matches));
}

// Push scoreboard settings to the server-side API so the OBS script can
// fetch them by game ID. Fire-and-forget — errors are silently ignored.
function pushGameSettings(match) {
  if (!match.gameId) return;
  const payload = {
    away:       match.awayTeam           || '',
    home:       match.homeTeam           || '',
    awayColor:  match.awayPrimaryColor   || '#808080',
    awayColor2: match.awaySecondaryColor || '#606060',
    homeColor:  match.homePrimaryColor   || '#808080',
    homeColor2: match.homeSecondaryColor || '#606060',
    awayLogo:   match.awayLogoUrl        || '',
    homeLogo:   match.homeLogoUrl        || '',
    replay:     match.replay             || false,
  };
  fetch(`/api/game-settings/${match.gameId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

export function getMatches() {
  return load();
}

export function getMatch(id) {
  return load().find((m) => m.id === id) || null;
}

export function createMatch(data) {
  const matches = load();
  const now = new Date().toISOString();
  const match = {
    id: uuidv4(),
    awayTeam: '',
    homeTeam: '',
    time: '',
    location: '',
    competition: '',
    gameId: '',
    ...data,
    createdAt: now,
    updatedAt: now,
  };
  matches.push(match);
  persist(matches);
  pushGameSettings(match);
  return match;
}

export function updateMatch(id, data) {
  const matches = load();
  const idx = matches.findIndex((m) => m.id === id);
  if (idx === -1) return null;
  const updated = { ...matches[idx], ...data, updatedAt: new Date().toISOString() };
  matches[idx] = updated;
  persist(matches);
  pushGameSettings(updated);
  return updated;
}

export function duplicateMatch(id) {
  const matches = load();
  const original = matches.find((m) => m.id === id);
  if (!original) return null;
  const now = new Date().toISOString();
  const copy = {
    ...original,
    id: uuidv4(),
    gameId: '',
    createdAt: now,
    updatedAt: now,
  };
  matches.push(copy);
  persist(matches);
  return copy;
}

export function deleteMatch(id) {
  const matches = load().filter((m) => m.id !== id);
  persist(matches);
}
