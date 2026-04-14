import DiamondDisplay from './DiamondDisplay';

export default function Scoreboard({ gameData, match }) {
  const primaryColor = match.primaryColor || '#c0392b';

  /* ── Pre-game (no live data) ────────────────────────────────────────── */
  if (!gameData) {
    return (
      <div className="scoreboard">
        <div className="sb-main">
          <div className="sb-teams">
            <div className="sb-row">
              <div className="sb-team-info">
                <span className="sb-abbr" style={{ backgroundColor: primaryColor }}>
                  {match.awayTeam || 'Away'}
                </span>
              </div>
              <div className="sb-score">—</div>
            </div>
            <div className="sb-row-divider" />
            <div className="sb-row">
              <div className="sb-team-info">
                <span className="sb-abbr" style={{ backgroundColor: primaryColor }}>
                  {match.homeTeam || 'Home'}
                </span>
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
            <div className="sb-side-diamond">
              <DiamondDisplay r1={false} r2={false} r3={false} />
            </div>
          </div>
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
    batterName, batterNum, batterAvg,
  } = gameData;

  const isFinal = status === 2;
  const isLive  = status === 1;

  return (
    <div className="scoreboard">

      {/* ── Top bar: pitcher (live only) ─────────────────────────────── */}
      {isLive && pitcherName && (
        <div className="sb-top-bar">
          <span className="player-role">PIT</span>
          {pitcherNum && <span className="player-num">#{pitcherNum}</span>}
          <span className="player-name">{pitcherName}</span>
        </div>
      )}

      <div className="sb-main">

        {/* ── Left: stacked team rows ───────────────────────────────── */}
        <div className="sb-teams">
          <div className="sb-row">
            <div className="sb-team-info">
              <span className="sb-abbr" style={{ backgroundColor: primaryColor }}>{awayAbbr}</span>
              {(awayFull && awayFull !== awayAbbr) && (
                <span className="sb-city">{awayFull}</span>
              )}
            </div>
            <div className="sb-score">{scoreAway}</div>
          </div>

          <div className="sb-row-divider" />

          <div className="sb-row">
            <div className="sb-team-info">
              <span className="sb-abbr" style={{ backgroundColor: primaryColor }}>{homeAbbr}</span>
              {(homeFull && homeFull !== homeAbbr) && (
                <span className="sb-city">{homeFull}</span>
              )}
            </div>
            <div className="sb-score">{scoreHome}</div>
          </div>
        </div>

        {/* ── Right: status + inning + count + diamond ─────────────── */}
        <div className="sb-col-divider" />
        <div className="sb-side">

          {/* Status */}
          {isLive && !match.replay && (
            <div className="sb-live-row">
              <span className="sb-live-dot" />
              <span className="sb-live-text">LIVE</span>
            </div>
          )}
          {match.replay && <div className="sb-replay-text">REPLAY</div>}
          {isFinal && <div className="sb-final-text">FINAL</div>}

          {/* Inning */}
          <div className="sb-inning-row">
            <span className="sb-inn-num">{inning}</span>
            <span className="sb-inn-arrow">{isTop ? '▲' : '▼'}</span>
          </div>

          {/* B · S numbers */}
          <div className="sb-bs-nums">
            <span className="sb-bs-val ball-val">{balls}</span>
            <span className="sb-bs-sep">·</span>
            <span className="sb-bs-val strike-val">{strikes}</span>
          </div>

          {/* Outs dots (2 positions) */}
          <div className="sb-outs-dots">
            {Array.from({ length: 2 }).map((_, i) => (
              <span key={i} className={`dot ${i < outs ? 'dot-out' : 'dot-empty'}`} />
            ))}
          </div>

          {/* Base runners diamond */}
          <div className="sb-side-diamond">
            <DiamondDisplay r1={r1} r2={r2} r3={r3} />
          </div>

        </div>
      </div>

      {/* ── Bottom bar: batter (live only) ───────────────────────────── */}
      {isLive && batterName && (
        <div className="sb-bottom-bar">
          <span className="player-role">BAT</span>
          {batterNum && <span className="player-num">#{batterNum}</span>}
          <span className="player-name">{batterName}</span>
          {batterAvg && (
            <span className="player-avg">{batterAvg}</span>
          )}
        </div>
      )}

    </div>
  );
}
