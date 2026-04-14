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
    raw.score?.away ?? raw.score_away ?? raw.ascore ?? 0;
  const scoreHome =
    raw.score?.home ?? raw.score_home ?? raw.hscore ?? 0;

  // ── Game state ───────────────────────────────────────────────────────────
  const status =
    raw.gamestatus ?? raw.status ?? raw.game_status ?? 0;
  // 0 = scheduled/pre-game, 1 = in progress, 2 = final, 3 = postponed

  const inning =
    raw.period ?? raw.inning ?? raw.inn ?? 1;
  const isTop =
    raw.topbot === 'T' ||
    raw.topbot === 1 ||
    raw.top_bot === 'T' ||
    raw.top_bot === 1 ||
    raw.topbot === 'Top' ||
    false;

  // ── Count ────────────────────────────────────────────────────────────────
  const balls   = Number(raw.ball   ?? raw.balls   ?? 0);
  const strikes = Number(raw.strike ?? raw.strikes ?? 0);
  const outs    = Number(raw.out    ?? raw.outs    ?? 0);

  // ── Runners (1 = occupied, 0 = empty) ───────────────────────────────────
  const r1 = Boolean(Number(raw.r1 ?? 0));
  const r2 = Boolean(Number(raw.r2 ?? 0));
  const r3 = Boolean(Number(raw.r3 ?? 0));

  // ── Players ─────────────────────────────────────────────────────────────
  const pitcherName =
    raw.pitcher?.name ?? raw.pitcher_name ?? raw.pitcher ?? '';
  const pitcherNum =
    raw.pitcher?.num ?? raw.pitcher_num ?? '';
  const batterName =
    raw.batter?.name ?? raw.batter_name ?? raw.batter ?? '';
  const batterNum =
    raw.batter?.num ?? raw.batter_num ?? '';

  // ── Inning-by-inning scores ──────────────────────────────────────────────
  const innScoreRaw =
    raw.innscore ?? raw.inn_score ?? raw.innings ?? [];
  const innScore = Array.isArray(innScoreRaw)
    ? innScoreRaw.map((i) => ({
        inning: i.inning ?? i.inn ?? i.period ?? 0,
        away:   i.away  ?? i.ascore ?? i.away_r  ?? '-',
        home:   i.home  ?? i.hscore ?? i.home_r  ?? '-',
      }))
    : [];

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
    const url = `https://game.wbsc.org/gamedata/${gameId}/play123.json`;
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
