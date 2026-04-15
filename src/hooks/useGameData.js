import { useState, useEffect, useRef } from 'react';

const POLL_INTERVAL   = 5_000; // live mode:   5 s between polls
const REPLAY_INTERVAL = 3_000; // replay mode: 3 s between plays

/**
 * Normalises a WBSC play{id}.json payload.
 * Game state comes from the "situation" key; scores from the "linescore" key.
 */
function normalise(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const sit  = raw.situation  ?? {};
  const ls   = raw.linescore  ?? {};

  // ── Teams (top-level) ────────────────────────────────────────────────────
  const awayAbbr = raw.eventaway ?? raw.team_away?.abbr ?? raw.team_away?.name ?? raw.team_away ?? raw.ateam ?? '';
  const homeAbbr = raw.eventhome ?? raw.team_home?.abbr ?? raw.team_home?.name ?? raw.team_home ?? raw.hteam ?? '';
  const awayFull = raw.team_away?.fullname ?? raw.team_away_full ?? awayAbbr;
  const homeFull = raw.team_home?.fullname ?? raw.team_home_full ?? homeAbbr;

  // ── Scores (linescore.awaytotals / hometotals) ───────────────────────────
  const scoreAway = Number(ls.awaytotals?.R ?? 0);
  const scoreHome = Number(ls.hometotals?.R ?? 0);

  // ── Game status (top-level; not present in situation) ────────────────────
  // 0 = pre-game, 1 = in progress, 2 = final, 3 = postponed
  const status = Number(raw.gamestatus ?? raw.status ?? raw.game_status ?? 0);

  // ── Inning + half (situation.currentinning e.g. "BOT 5" / "TOP 3") ──────
  const currentInningStr = sit.currentinning ?? '';
  const [halfStr, innStr] = currentInningStr.split(' ');
  const inning = innStr ? Number(innStr) : (Math.floor(Number(sit.inning)) || 1);
  const isTop  = halfStr ? halfStr.toUpperCase() === 'TOP' : false;

  // ── Count (situation) ────────────────────────────────────────────────────
  const balls   = Number(sit.balls   ?? 0);
  const strikes = Number(sit.strikes ?? 0);
  const outs    = Number(sit.outs    ?? 0);

  // ── Runners (situation.runner1/2/3) ──────────────────────────────────────
  const r1 = Boolean(Number(sit.runner1 ?? 0));
  const r2 = Boolean(Number(sit.runner2 ?? 0));
  const r3 = Boolean(Number(sit.runner3 ?? 0));

  // ── Players (situation) ──────────────────────────────────────────────────
  const batterName  = sit.nbatter ?? sit.batter ?? '';
  const batterAvg   = sit.batting ?? sit.avg    ?? '';
  const pitcherName = sit.pitcher ?? '';

  // Pitch count: WBSC stores it as PITCHES (uppercase) on the player entry
  // keyed by sit.pitcherid inside a player-collection object in the raw payload.
  // We search common collection keys; fall back to situation-level keys.
  const pitcherid = String(sit.pitcherid ?? sit.pitcher_id ?? '');
  let pitcherPitches = null;

  if (pitcherid) {
    const PLAYER_COLLECTIONS = [
      'boxscore',
      'players', 'awayplayers', 'homeplayers',
      'lineup',  'awaylineup',  'homelineup',
      'roster',  'awayroster',  'homeroster',
    ];
    for (const key of PLAYER_COLLECTIONS) {
      const col = raw[key];
      if (!col || typeof col !== 'object') continue;
      // The collection is a dict keyed by player/roster ID
      const entry = col[pitcherid]
        ?? Object.values(col).find(p => p && String(p.playerid) === pitcherid);
      if (entry) {
        // WBSC uses uppercase PITCHES on the player stats entry
        const pp = entry.PITCHES ?? entry.pitches ?? entry.np ?? entry.pc ?? null;
        if (pp !== null) { pitcherPitches = Number(pp); }
        break;
      }
    }
  }
  // Last-resort: situation-level keys (older / different feed formats)
  if (pitcherPitches === null) {
    const _pp = sit.pitches ?? sit.np ?? sit.pc ?? sit.pitchcount ?? sit.totalp ?? null;
    if (_pp !== null) pitcherPitches = Number(_pp);
  }

  // ── Play description (first entry in playdata) ───────────────────────────
  const playDesc = raw.playdata?.[0]?.n?.trim() ?? '';

  // ── Inning-by-inning (linescore.awayruns / homeruns) ─────────────────────
  // Arrays are 1-indexed: index 0 is null/unused, index N = inning N.
  const innScore = [];
  const awayRuns = ls.awayruns;
  const homeRuns = ls.homeruns;
  if (Array.isArray(awayRuns) && awayRuns.length > 1) {
    const len = Math.max(awayRuns.length, Array.isArray(homeRuns) ? homeRuns.length : 0);
    for (let i = 1; i < len; i++) {
      const a = awayRuns[i];
      const h = Array.isArray(homeRuns) ? homeRuns[i] : undefined;
      innScore.push({
        inning: i,
        away: a === null || a === undefined ? '-' : a,
        home: h === null || h === undefined ? '-' : h,
      });
    }
  }

  return {
    awayAbbr, homeAbbr, awayFull, homeFull,
    scoreAway, scoreHome,
    status, inning, isTop,
    balls, strikes, outs,
    r1, r2, r3,
    batterName, batterAvg,
    pitcherName, pitcherPitches,
    playDesc,
    innScore,
  };
}

/**
 * @param {string}  gameId  - WBSC numeric game ID
 * @param {boolean} replay  - true = replay mode (play1 → latest, 3 s/play)
 *                            false = live mode  (always latest play, poll 5 s)
 */
export function useGameData(gameId, replay = false) {
  const [gameData, setGameData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const timerRef   = useRef(null);
  const mountedRef = useRef(true);
  // replay tracking
  const playNumRef = useRef(1);
  const maxPlayRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    if (!gameId) {
      setGameData(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setGameData(null);
    setError(null);
    playNumRef.current = 1;
    maxPlayRef.current = null;

    async function step() {
      if (!mountedRef.current) return;
      try {
        // Fetch latest.json:
        //   live mode  → every step (stay current)
        //   replay mode → only on first step (to know the endpoint)
        if (!replay || maxPlayRef.current === null) {
          const latestRes = await fetch(`/gamedata/${gameId}/latest.json`, { cache: 'no-store' });
          if (!latestRes.ok) throw new Error(`latest.json HTTP ${latestRes.status}`);
          const n = Number(await latestRes.json());
          if (!n) throw new Error(`Invalid play ID from latest.json`);
          maxPlayRef.current = n;
          if (!replay) playNumRef.current = n; // live: always jump to newest play
        }

        const playId = playNumRef.current;
        const playRes = await fetch(`/gamedata/${gameId}/play${playId}.json`, { cache: 'no-store' });
        if (!playRes.ok) throw new Error(`play${playId}.json HTTP ${playRes.status}`);
        const raw = await playRes.json();

        if (mountedRef.current) {
          setGameData(normalise(raw));
          setError(null);
        }
      } catch (err) {
        if (mountedRef.current) setError(err.message);
      } finally {
        if (!mountedRef.current) return;
        setLoading(false);

        if (replay) {
          // advance to next play, stop when we reach the last known play
          const next = playNumRef.current + 1;
          if (next <= (maxPlayRef.current ?? 0)) {
            playNumRef.current = next;
            timerRef.current = setTimeout(step, REPLAY_INTERVAL);
          }
          // else: replay finished — stay on last play, no more timers
        } else {
          timerRef.current = setTimeout(step, POLL_INTERVAL);
        }
      }
    }

    step();

    return () => {
      mountedRef.current = false;
      clearTimeout(timerRef.current);
    };
  }, [gameId, replay]);

  return { gameData, loading, error };
}
