import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import Scoreboard from '../components/Scoreboard';
import { getMatch } from '../stores/matchStore';
import { useGameData } from '../hooks/useGameData';

export default function Overlay() {
  const { matchId } = useParams();
  const [searchParams] = useSearchParams();
  const [match, setMatch] = useState(null);
  const [notFound, setNotFound] = useState(false);

  // chromakey=1 → solid green background so FFmpeg colorkey can composite
  // onto the Pi4 camera feed. Has no effect in OBS (OBS ignores body bg).
  useEffect(() => {
    if (searchParams.get('chromakey') === '1') {
      document.documentElement.style.background = '#00ff00';
      document.body.style.background = '#00ff00';
    }
    return () => {
      document.documentElement.style.background = '';
      document.body.style.background = '';
    };
  }, [searchParams]);

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

