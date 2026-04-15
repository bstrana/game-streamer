import DiamondDisplay from './DiamondDisplay';

function teamBg(primary, secondary) {
  return `linear-gradient(135deg, ${primary || '#c0392b'}, ${secondary || '#7b241c'})`;
}

export default function Scoreboard({ gameData, match }) {
  const awayBg = teamBg(match.awayPrimaryColor, match.awaySecondaryColor);
  const homeBg = teamBg(match.homePrimaryColor, match.homeSecondaryColor);

  /* ── Pre-game (no live data) ────────────────────────────────────────── */
  if (!gameData) {
    return (
      <div className="scoreboard">
        <div className="sb-main">
          <div className="sb-teams">
            <div className="sb-row" style={{ background: awayBg }}>
              <div className="sb-team-left">
                {match.awayLogoUrl && <img className="sb-team-logo" src={match.awayLogoUrl} alt="" />}
                <div className="sb-team-info">
                  <span className="sb-abbr">{match.awayTeam || 'Away'}</span>
                </div>
              </div>
              <div className="sb-score">—</div>
            </div>
            <div className="sb-row-divider" />
            <div className="sb-row" style={{ background: homeBg }}>
              <div className="sb-team-left">
                {match.homeLogoUrl && <img className="sb-team-logo" src={match.homeLogoUrl} alt="" />}
                <div className="sb-team-info">
                  <span className="sb-abbr">{match.homeTeam || 'Home'}</span>
                </div>
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
    pitcherName, pitcherPitches,
    batterName, batterAvg,
    playDesc,
  } = gameData;

  const isFinal = status === 2;
  const isLive  = status === 1;

  return (
    <div className="scoreboard">

      {/* ── Top bar: pitcher ─────────────────────────────────────────── */}
      {(isLive || match.replay) && pitcherName && (
        <div className="sb-top-bar">
          <span className="player-role">PIT</span>
          <span className="player-name">{pitcherName}</span>
          {pitcherPitches !== null && <span className="player-stat">{pitcherPitches} P</span>}
        </div>
      )}

      {match.replay ? (
        /* ── Replay: 4-column inline layout ──────────────────────────── */
        <div className="sb-main-replay">

          {/* Col 1: Away team + score */}
          <div className="sb-replay-team" style={{ background: awayBg }}>
            {match.awayLogoUrl && <img className="sb-team-logo" src={match.awayLogoUrl} alt="" />}
            <span className="sb-abbr">{awayAbbr}</span>
            <div className="sb-replay-score">{scoreAway}</div>
          </div>

          <div className="sb-col-divider" />

          {/* Col 2: Home team + score */}
          <div className="sb-replay-team" style={{ background: homeBg }}>
            {match.homeLogoUrl && <img className="sb-team-logo" src={match.homeLogoUrl} alt="" />}
            <span className="sb-abbr">{homeAbbr}</span>
            <div className="sb-replay-score">{scoreHome}</div>
          </div>

          <div className="sb-col-divider" />

          {/* Col 3: Status / inning / B·S / outs */}
          <div className="sb-replay-status">
            <div className="sb-replay-text">REPLAY</div>
            <div className="sb-inning-row">
              <span className="sb-inn-num">{inning}</span>
              <span className="sb-inn-arrow">{isTop ? '▲' : '▼'}</span>
            </div>
            <div className="sb-bs-nums">
              <span className="sb-bs-val ball-val">{balls}</span>
              <span className="sb-bs-sep">·</span>
              <span className="sb-bs-val strike-val">{strikes}</span>
            </div>
            <div className="sb-outs-dots">
              {Array.from({ length: 2 }).map((_, i) => (
                <span key={i} className={`dot ${i < outs ? 'dot-out' : 'dot-empty'}`} />
              ))}
            </div>
          </div>

          <div className="sb-col-divider" />

          {/* Col 4: Bases diamond */}
          <div className="sb-replay-diamond">
            <DiamondDisplay r1={r1} r2={r2} r3={r3} />
          </div>

        </div>
      ) : (
        /* ── Live / Final: stacked layout ────────────────────────────── */
        <div className="sb-main">

          {/* Left: stacked team rows */}
          <div className="sb-teams">
            <div className="sb-row" style={{ background: awayBg }}>
              <div className="sb-team-left">
                {match.awayLogoUrl && <img className="sb-team-logo" src={match.awayLogoUrl} alt="" />}
                <div className="sb-team-info">
                  <span className="sb-abbr">{awayAbbr}</span>
                  {(awayFull && awayFull !== awayAbbr) && (
                    <span className="sb-city">{awayFull}</span>
                  )}
                </div>
              </div>
              <div className="sb-score">{scoreAway}</div>
            </div>

            <div className="sb-row-divider" />

            <div className="sb-row" style={{ background: homeBg }}>
              <div className="sb-team-left">
                {match.homeLogoUrl && <img className="sb-team-logo" src={match.homeLogoUrl} alt="" />}
                <div className="sb-team-info">
                  <span className="sb-abbr">{homeAbbr}</span>
                  {(homeFull && homeFull !== homeAbbr) && (
                    <span className="sb-city">{homeFull}</span>
                  )}
                </div>
              </div>
              <div className="sb-score">{scoreHome}</div>
            </div>
          </div>

          {/* Right: status + inning + count + diamond */}
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

            {/* Inning */}
            <div className="sb-inning-row">
              <span className="sb-inn-num">{inning}</span>
              <span className="sb-inn-arrow">{isTop ? '▲' : '▼'}</span>
            </div>

            {/* Count (B·S + outs) alongside diamond */}
            <div className="sb-count-diamond">
              <div className="sb-count">
                <div className="sb-bs-nums">
                  <span className="sb-bs-val ball-val">{balls}</span>
                  <span className="sb-bs-sep">·</span>
                  <span className="sb-bs-val strike-val">{strikes}</span>
                </div>
                <div className="sb-outs-dots">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <span key={i} className={`dot ${i < outs ? 'dot-out' : 'dot-empty'}`} />
                  ))}
                </div>
              </div>
              <div className="sb-side-diamond">
                <DiamondDisplay r1={r1} r2={r2} r3={r3} />
              </div>
            </div>

          </div>
        </div>
      )}

      {/* ── Bottom bar: batter ───────────────────────────────────────── */}
      {(isLive || match.replay) && batterName && (
        <div className="sb-bottom-bar">
          <div className="sb-bottom-row">
            <span className="player-role">BAT</span>
            <span className="player-name">{batterName}</span>
            {batterAvg && <span className="player-stat">{batterAvg}</span>}
          </div>
          {match.replay && playDesc && (
            <div className="sb-play-desc">{playDesc}</div>
          )}
        </div>
      )}

    </div>
  );
}
