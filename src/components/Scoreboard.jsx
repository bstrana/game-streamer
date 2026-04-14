import DiamondDisplay from './DiamondDisplay';

function CountDots({ filled, total, activeClass }) {
  return (
    <div className="count-dots">
      {Array.from({ length: total }).map((_, i) => (
        <span key={i} className={`dot ${i < filled ? activeClass : 'dot-empty'}`} />
      ))}
    </div>
  );
}

export default function Scoreboard({ gameData, match }) {
  /* ── Pre-game ───────────────────────────────────────────────────────── */
  if (!gameData) {
    return (
      <div className="scoreboard">
        <div className="sb-teams">
          <div className="sb-row">
            <div className="sb-team-info">
              <span className="sb-abbr">{match.awayTeam || 'Away'}</span>
            </div>
            <div className="sb-score">—</div>
          </div>
          <div className="sb-row-divider" />
          <div className="sb-row">
            <div className="sb-team-info">
              <span className="sb-abbr">{match.homeTeam || 'Home'}</span>
            </div>
            <div className="sb-score">—</div>
          </div>
        </div>
        <div className="sb-col-divider" />
        <div className="sb-side">
          <div className="sb-scheduled-label">SCH</div>
          {match.time && !isNaN(new Date(match.time).getTime()) && (
            <div className="sb-scheduled-time">
              {new Intl.DateTimeFormat(undefined, {
                month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit',
              }).format(new Date(match.time))}
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ── Live / Final ───────────────────────────────────────────────────── */
  const {
    awayAbbr, homeAbbr, awayFull, homeFull,
    scoreAway, scoreHome,
    status, inning, isTop,
    balls, strikes, outs,
    r1, r2, r3,
    pitcherName, pitcherNum,
    batterName, batterNum,
  } = gameData;

  const isFinal = status === 2;
  const isLive  = status === 1;

  return (
    <div className="scoreboard">
      <div className="sb-main">

        {/* ── Left: stacked team rows ───────────────────────────────── */}
        <div className="sb-teams">
          <div className="sb-row">
            <div className="sb-team-info">
              <span className="sb-abbr">{awayAbbr || match.awayTeam}</span>
              {(awayFull && awayFull !== awayAbbr) && (
                <span className="sb-city">{awayFull}</span>
              )}
            </div>
            <div className="sb-score">{scoreAway}</div>
          </div>

          <div className="sb-row-divider" />

          <div className="sb-row">
            <div className="sb-team-info">
              <span className="sb-abbr">{homeAbbr || match.homeTeam}</span>
              {(homeFull && homeFull !== homeAbbr) && (
                <span className="sb-city">{homeFull}</span>
              )}
            </div>
            <div className="sb-score">{scoreHome}</div>
          </div>
        </div>

        {/* ── Right: status + inning + count ───────────────────────── */}
        <div className="sb-col-divider" />
        <div className="sb-side">

          {/* Status */}
          {isLive && (
            <div className="sb-live-row">
              <span className="sb-live-dot" />
              <span className="sb-live-text">LIVE</span>
            </div>
          )}
          {isFinal && <div className="sb-final-text">FINAL</div>}
          {!isLive && !isFinal && <div className="sb-pre-text">PRE</div>}

          {/* Inning */}
          <div className="sb-inning-row">
            <span className="sb-inn-num">{inning}</span>
            <span className="sb-inn-arrow">{isTop ? '▲' : '▼'}</span>
          </div>

          {/* Count dots */}
          <div className="sb-count-dots-col">
            <CountDots filled={balls}   total={4} activeClass="dot-ball" />
            <CountDots filled={strikes} total={3} activeClass="dot-strike" />
          </div>

          {/* Outs + B·S numeric */}
          <div className="sb-count-nums">
            <span className="sb-outs">
              {Array.from({ length: 3 }).map((_, i) => (
                <span key={i} className={`dot dot-sm ${i < outs ? 'dot-out' : 'dot-empty'}`} />
              ))}
            </span>
            <span className="sb-bs">{balls} · {strikes}</span>
          </div>

        </div>
      </div>

      {/* ── Bottom: runners + players (only when live) ─────────────── */}
      {isLive && (
        <div className="sb-bottom-bar">
          <div className="sb-diamond-wrap">
            <DiamondDisplay r1={r1} r2={r2} r3={r3} />
          </div>
          <div className="sb-players">
            {batterName && (
              <div className="sb-player">
                <span className="player-role">BAT</span>
                {batterNum && <span className="player-num">#{batterNum}</span>}
                <span className="player-name">{batterName}</span>
              </div>
            )}
            {pitcherName && (
              <div className="sb-player">
                <span className="player-role">PIT</span>
                {pitcherNum && <span className="player-num">#{pitcherNum}</span>}
                <span className="player-name">{pitcherName}</span>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
