import DiamondDisplay from './DiamondDisplay';

const STATUS_LABEL = {
  0: 'Pre-Game',
  1: 'Live',
  2: 'Final',
  3: 'Postponed',
};

function CountDots({ filled, total, activeClass }) {
  return (
    <div className="count-dots">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={`dot ${i < filled ? activeClass : 'dot-empty'}`}
        />
      ))}
    </div>
  );
}

function InningScoreTable({ innScore, awayAbbr, homeAbbr, inning }) {
  if (!innScore || innScore.length === 0) return null;
  return (
    <div className="inning-table-wrap">
      <table className="inning-table">
        <thead>
          <tr>
            <th className="inn-team-col" />
            {innScore.map((inn) => (
              <th key={inn.inning} className={inn.inning === inning ? 'inn-current' : ''}>
                {inn.inning}
              </th>
            ))}
            <th className="inn-total">R</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="inn-team-col">{awayAbbr}</td>
            {innScore.map((inn) => (
              <td key={inn.inning} className={inn.inning === inning ? 'inn-current' : ''}>
                {inn.away}
              </td>
            ))}
            <td className="inn-total">
              {innScore.reduce((s, i) => s + (Number(i.away) || 0), 0)}
            </td>
          </tr>
          <tr>
            <td className="inn-team-col">{homeAbbr}</td>
            {innScore.map((inn) => (
              <td key={inn.inning} className={inn.inning === inning ? 'inn-current' : ''}>
                {inn.home}
              </td>
            ))}
            <td className="inn-total">
              {innScore.reduce((s, i) => s + (Number(i.home) || 0), 0)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default function Scoreboard({ gameData, match }) {
  if (!gameData) {
    // Show pre-game static display using match info
    return (
      <div className="scoreboard scoreboard-pregame">
        <div className="sb-competition">{match.competition || 'Baseball'}</div>
        <div className="sb-teams-row">
          <div className="sb-team away">
            <div className="sb-team-name">{match.awayTeam || 'Away'}</div>
            <div className="sb-score">—</div>
          </div>
          <div className="sb-middle">
            <div className="sb-inning-label">Scheduled</div>
            {match.time && !isNaN(new Date(match.time).getTime()) && (
              <div className="sb-game-time">
                {new Intl.DateTimeFormat(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }).format(new Date(match.time))}
              </div>
            )}
            {match.location && (
              <div className="sb-location">{match.location}</div>
            )}
          </div>
          <div className="sb-team home">
            <div className="sb-team-name">{match.homeTeam || 'Home'}</div>
            <div className="sb-score">—</div>
          </div>
        </div>
      </div>
    );
  }

  const {
    awayAbbr, homeAbbr, awayFull, homeFull,
    scoreAway, scoreHome,
    status, inning, isTop,
    balls, strikes, outs,
    r1, r2, r3,
    pitcherName, pitcherNum,
    batterName, batterNum,
    innScore,
  } = gameData;

  const isFinal = status === 2;
  const isLive  = status === 1;
  const halfInning = isTop ? 'Top' : 'Bot';

  return (
    <div className="scoreboard">
      {/* Top bar: competition + status */}
      <div className="sb-topbar">
        <span className="sb-competition">{match.competition || 'Baseball'}</span>
        <span className={`sb-status status-${status}`}>{STATUS_LABEL[status] ?? 'Unknown'}</span>
      </div>

      {/* Main score row */}
      <div className="sb-teams-row">
        <div className="sb-team away">
          <div className="sb-team-abbr">{awayAbbr}</div>
          <div className="sb-team-name">{awayFull || match.awayTeam}</div>
          <div className="sb-score">{scoreAway}</div>
        </div>

        <div className="sb-middle">
          {!isFinal && (
            <div className="sb-inning">
              <span className="sb-half">{halfInning}</span>
              <span className="sb-inning-num">{inning}</span>
            </div>
          )}
          {isFinal && <div className="sb-final-label">FINAL</div>}
        </div>

        <div className="sb-team home">
          <div className="sb-team-abbr">{homeAbbr}</div>
          <div className="sb-team-name">{homeFull || match.homeTeam}</div>
          <div className="sb-score">{scoreHome}</div>
        </div>
      </div>

      {/* Inning score table */}
      {innScore.length > 0 && (
        <InningScoreTable
          innScore={innScore}
          awayAbbr={awayAbbr}
          homeAbbr={homeAbbr}
          inning={inning}
        />
      )}

      {/* Live game state: count + diamond + players */}
      {isLive && (
        <div className="sb-game-state">
          {/* Count panel */}
          <div className="sb-count-panel">
            <div className="sb-count-item">
              <span className="count-label">B</span>
              <CountDots filled={balls}   total={4} activeClass="dot-ball" />
            </div>
            <div className="sb-count-item">
              <span className="count-label">S</span>
              <CountDots filled={strikes} total={3} activeClass="dot-strike" />
            </div>
            <div className="sb-count-item">
              <span className="count-label">O</span>
              <CountDots filled={outs}    total={3} activeClass="dot-out" />
            </div>
          </div>

          {/* Diamond */}
          <div className="sb-diamond">
            <DiamondDisplay r1={r1} r2={r2} r3={r3} />
          </div>

          {/* Players */}
          <div className="sb-players">
            {batterName && (
              <div className="sb-player">
                <span className="player-role">Batter</span>
                <span className="player-num">#{batterNum}</span>
                <span className="player-name">{batterName}</span>
              </div>
            )}
            {pitcherName && (
              <div className="sb-player">
                <span className="player-role">Pitcher</span>
                <span className="player-num">#{pitcherNum}</span>
                <span className="player-name">{pitcherName}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
