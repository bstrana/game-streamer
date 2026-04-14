import { useState, useEffect, useCallback, useRef } from 'react';

const POLL_INTERVAL = 5_000; // 5 seconds

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
  const batterName  = sit.batter   ?? '';
  const batterNum   = sit.batterid ?? '';
  const pitcherName = sit.pitcher  ?? '';
  const pitcherNum  = sit.pitcherid ?? '';

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
    batterName, batterNum,
    pitcherName, pitcherNum,
    innScore,
  };
}

export function useGameData(gameId) {
  const [gameData, setGameData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    if (!gameId) return;
    try {
      // Step 1: get the latest play ID
      const latestRes = await fetch(`/gamedata/${gameId}/latest.json`, { cache: 'no-store' });
      if (!latestRes.ok) throw new Error(`latest.json HTTP ${latestRes.status}`);
      const latestJson = await latestRes.json();

      // latest.json may use different field names
      const playId =
        latestJson.latestplayid ?? latestJson.playid ?? latestJson.id ??
        latestJson.latest ?? latestJson.play_id;
      if (playId == null) throw new Error('No play ID in latest.json');

      // Step 2: fetch that specific play
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
      if (mountedRef.current) {
        setLoading(false);
        timerRef.current = setTimeout(fetchData, POLL_INTERVAL);
      }
    }
  }, [gameId]);

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
    fetchData();

    return () => {
      mountedRef.current = false;
      clearTimeout(timerRef.current);
    };
  }, [gameId, fetchData]);

  return { gameData, loading, error };
}
