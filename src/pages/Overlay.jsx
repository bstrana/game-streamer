/**
 * Overlay page — publicly accessible, no Keycloak auth.
 * Intended as an OBS browser source URL.
 *
 * Route: /overlay/:matchId
 *
 * - Loads match data from the server API (works in OBS browser source)
 * - Polls the API every 10 s so live edits (replay toggle, gameId, colors)
 *   are picked up without reloading the OBS source
 * - Polls WBSC live game data every 10 s when a gameId is set
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
    let cancelled = false;

    async function load() {
      const m = await getMatch(matchId);
      if (cancelled) return;
      if (!m) {
        setNotFound(true);
      } else {
        setMatch(m);
        setNotFound(false);
      }
    }

    load();
    // Poll every 10 s — picks up edits made in the management UI
    const timer = setInterval(load, 10_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [matchId]);

  const { gameData, loading, error } = useGameData(match?.gameId || '', match?.replay || false);

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
      {error && !gameData && (
        <div className="overlay-error-banner">
          ⚠ {error}
        </div>
      )}
      <Scoreboard
        gameData={match.gameId ? gameData : null}
        match={match}
      />
    </div>
  );
}
