/**
 * Direct overlay — no match management, no auth.
 * Everything comes from the URL.
 *
 * Route: /overlay/game/:gameId
 *
 * Query params (all optional):
 *   away         Away team abbreviation          (default "Away")
 *   home         Home team abbreviation          (default "Home")
 *   awayColor    Away primary colour hex         (default #c0392b)
 *   awayColor2   Away secondary colour hex       (default #7b241c)
 *   homeColor    Home primary colour hex         (default #2471a3)
 *   homeColor2   Home secondary colour hex       (default #1a5276)
 *   awayLogo     Away team logo URL
 *   homeLogo     Home team logo URL
 *   replay       1 = replay mode, 0 = live       (default 0)
 *
 * Example OBS browser source URL:
 *   https://app.example.com/overlay/game/123456?away=SVK&home=USA&awayColor=c0392b&homeColor=2471a3
 */
import { useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import Scoreboard from '../components/Scoreboard';
import { useGameData } from '../hooks/useGameData';
import '../styles/overlay.css';

function ensureHash(val) {
  if (!val) return undefined;
  return val.startsWith('#') ? val : `#${val}`;
}

export default function OverlayDirect() {
  const { gameId } = useParams();
  const [params] = useSearchParams();

  const match = useMemo(() => ({
    gameId,
    awayTeam:          params.get('away')       || 'Away',
    homeTeam:          params.get('home')        || 'Home',
    awayPrimaryColor:  ensureHash(params.get('awayColor'))  || '#c0392b',
    awaySecondaryColor:ensureHash(params.get('awayColor2')) || '#7b241c',
    homePrimaryColor:  ensureHash(params.get('homeColor'))  || '#2471a3',
    homeSecondaryColor:ensureHash(params.get('homeColor2')) || '#1a5276',
    awayLogoUrl:       params.get('awayLogo')   || '',
    homeLogoUrl:       params.get('homeLogo')   || '',
    replay:            params.get('replay') === '1',
  }), [gameId, params]);

  const { gameData, loading, error } = useGameData(gameId, match.replay);

  return (
    <div className="overlay-root">
      {loading && !gameData && (
        <div className="overlay-loading">Loading…</div>
      )}
      {error && !gameData && (
        <div className="overlay-error-banner">⚠ {error}</div>
      )}
      <Scoreboard gameData={gameData} match={match} />
    </div>
  );
}
