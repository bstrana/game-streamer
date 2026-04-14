/**
 * Overlay page — publicly accessible, no Keycloak auth.
 * Intended as an OBS browser source URL.
 *
 * Route: /overlay/:matchId
 *
 * - Loads match data from localStorage
 * - Polls WBSC API every 10 s when a gameId is set
 * - Renders transparent-background scoreboard overlay
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import Scoreboard from '../components/Scoreboard';
import { getMatch } from '../stores/matchStore';
import { useGameData } from '../hooks/useGameData';

export default function Overlay() {
  const { matchId } = useParams();
  const [match, setMatch] = useState(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const m = getMatch(matchId);
    if (!m) {
      setNotFound(true);
    } else {
      setMatch(m);
    }
  }, [matchId]);

  const { gameData, loading, error } = useGameData(match?.gameId || '');

  if (notFound) {
    return (
      <div className="overlay-root">
        <div className="overlay-error">Match not found</div>
      </div>
    );
  }

  if (!match) return null;

  return (
    <div className="overlay-root">
      {loading && !gameData && match.gameId && (
        <div className="overlay-loading">Loading live data…</div>
      )}
      {error && (
        <div className="overlay-error-banner">
          ⚠ Live data unavailable — showing scheduled info
        </div>
      )}
      <Scoreboard
        gameData={match.gameId ? gameData : null}
        match={match}
      />
    </div>
  );
}
