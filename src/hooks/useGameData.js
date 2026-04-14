import { useState, useEffect, useCallback, useRef } from 'react';

const POLL_INTERVAL = 10_000; // 10 seconds

/**
 * Normalises the raw WBSC play123.json payload into a consistent shape,
 * handling multiple possible field-name conventions used across WBSC API versions.
 */
function normalise(raw) {
  if (!raw || typeof raw !== 'object') return null;

  // ── Teams ────────────────────────────────────────────────────────────────
  const awayAbbr =
    raw.team_away?.abbr ?? raw.team_away?.name ?? raw.team_away ?? raw.ateam ?? '';
  const homeAbbr =
    raw.team_home?.abbr ?? raw.team_home?.name ?? raw.team_home ?? raw.hteam ?? '';
  const awayFull = raw.team_away?.fullname ?? raw.team_away_full ?? awayAbbr;
  const homeFull = raw.team_home?.fullname ?? raw.team_home_full ?? homeAbbr;

  // ── Score ────────────────────────────────────────────────────────────────
  const scoreAway =
    raw.score?.away ?? raw.score_away ?? raw.ascore ??
    raw.linescore?.awaytotals?.R ?? 0;
  const scoreHome =
    raw.score?.home ?? raw.score_home ?? raw.hscore ??
    raw.linescore?.hometotals?.R ?? 0;

  const sit = raw.situation ?? {};

  // ── Game state ───────────────────────────────────────────────────────────
  const status =
    raw.gamestatus ?? raw.status ?? raw.game_status ?? 0;
  // 0 = scheduled/pre-game, 1 = in progress, 2 = final, 3 = postponed

  // currentinning e.g. "BOT 5" or "TOP 3"
  const currentInningStr = sit.currentinning ?? '';
  const [halfStr, innFromStr] = currentInningStr.split(' ');
  const inning =
    raw.period ?? raw.inning ?? raw.inn ??
    (innFromStr ? Number(innFromStr) : undefined) ??
    (Math.floor(Number(sit.inning)) || 1);
  const isTop =
    raw.topbot === 'T' || raw.topbot === 1 ||
    raw.top_bot === 'T' || raw.top_bot === 1 ||
    raw.topbot === 'Top' ||
    (halfStr ? halfStr.toUpperCase() === 'TOP' : false);

  // ── Count ────────────────────────────────────────────────────────────────
  const balls   = Number(raw.ball   ?? raw.balls   ?? sit.balls   ?? 0);
  const strikes = Number(raw.strike ?? raw.strikes ?? sit.strikes ?? 0);
  const outs    = Number(raw.out    ?? raw.outs    ?? sit.outs    ?? 0);

  // ── Runners (1 = occupied, 0 = empty) ───────────────────────────────────
  const r1 = Boolean(Number(raw.r1 ?? sit.runner1 ?? 0));
  const r2 = Boolean(Number(raw.r2 ?? sit.runner2 ?? 0));
  const r3 = Boolean(Number(raw.r3 ?? sit.runner3 ?? 0));

  // ── Players ─────────────────────────────────────────────────────────────
  const pitcherName =
    raw.pitcher?.name ?? raw.pitcher_name ?? sit.pitcher ?? raw.pitcher ?? '';
  const pitcherNum =
    raw.pitcher?.num ?? raw.pitcher_num ?? sit.pitcherid ?? '';
  const batterName =
    raw.batter?.name ?? raw.batter_name ?? sit.batter ?? raw.batter ?? '';
  const batterNum =
    raw.batter?.num ?? raw.batter_num ?? sit.batterid ?? '';

  // ── Inning-by-inning scores ──────────────────────────────────────────────
  // Prefer the linescore.awayruns/homeruns arrays (index 0 = unused/null,
  // index N = inning N).  Fall back to the older array-of-objects formats.
  let innScore = [];
  const awayRuns = raw.linescore?.awayruns;
  const homeRuns = raw.linescore?.homeruns;
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
  } else {
    const innScoreRaw = raw.innscore ?? raw.inn_score ?? raw.innings ?? [];
    innScore = Array.isArray(innScoreRaw)
      ? innScoreRaw.map((i) => ({
          inning: i.inning ?? i.inn ?? i.period ?? 0,
          away:   i.away  ?? i.ascore ?? i.away_r  ?? '-',
          home:   i.home  ?? i.hscore ?? i.home_r  ?? '-',
        }))
      : [];
  }

  return {
    awayAbbr,
    homeAbbr,
    awayFull,
    homeFull,
    scoreAway: Number(scoreAway),
    scoreHome: Number(scoreHome),
    status: Number(status),
    inning: Number(inning),
    isTop,
    balls,
    strikes,
    outs,
    r1,
    r2,
    r3,
    pitcherName,
    pitcherNum,
    batterName,
    batterNum,
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
    const url = `/gamedata/${gameId}/play123.json`;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json();
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
