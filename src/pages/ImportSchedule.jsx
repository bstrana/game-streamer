import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { createMatch } from '../stores/matchStore';

function buildTeamMap(data) {
  const map = {};
  // Top-level teams first
  (data.teams || []).forEach(t => { map[t.id] = t; });
  // League teams fill in any missing (e.g. Confederation Cup teams)
  (data.leagues || []).forEach(l => {
    (l.teams || []).forEach(t => { if (!map[t.id]) map[t.id] = t; });
  });
  return map;
}

function buildLeagueMap(data) {
  const map = {};
  (data.leagues || []).forEach(l => { map[l.id] = l; });
  return map;
}

function teamLabel(team) {
  if (!team) return '?';
  return team.name || team.abbreviation || '?';
}

export default function ImportSchedule() {
  const navigate = useNavigate();
  const [jsonText, setJsonText]     = useState('');
  const [parsed, setParsed]         = useState(null);
  const [parseError, setParseError] = useState('');
  const [filterType, setFilterType] = useState('location');
  const [filterValue, setFilterValue] = useState('');
  const [selected, setSelected]     = useState(new Set());
  const [importing, setImporting]   = useState(false);

  const handleParse = () => {
    try {
      const data = JSON.parse(jsonText);
      if (!Array.isArray(data.games)) throw new Error('Missing "games" array');
      setParsed(data);
      setParseError('');
      setFilterType('location');
      setFilterValue('');
      setSelected(new Set());
    } catch (e) {
      setParseError(e.message);
      setParsed(null);
    }
  };

  const teamMap  = useMemo(() => parsed ? buildTeamMap(parsed)  : {}, [parsed]);
  const leagueMap = useMemo(() => parsed ? buildLeagueMap(parsed) : {}, [parsed]);

  const locations = useMemo(() => {
    if (!parsed) return [];
    return [...new Set(parsed.games.map(g => g.location).filter(Boolean))].sort();
  }, [parsed]);

  const homeTeams = useMemo(() => {
    if (!parsed) return [];
    const ids = [...new Set(parsed.games.map(g => g.homeTeamId))];
    return ids
      .map(id => teamMap[id])
      .filter(t => t && !t.id.startsWith('__tbd'))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [parsed, teamMap]);

  const filteredGames = useMemo(() => {
    if (!parsed || !filterValue) return [];
    return parsed.games.filter(g => {
      if (g.status !== 'scheduled') return false;
      if (g.awayTeamId?.startsWith('__tbd') || g.homeTeamId?.startsWith('__tbd')) return false;
      if (filterType === 'location') return g.location === filterValue;
      if (filterType === 'team')     return g.homeTeamId === filterValue;
      return false;
    }).sort((a, b) => {
      const da = `${a.date}T${a.time || '00:00'}`;
      const db = `${b.date}T${b.time || '00:00'}`;
      return da.localeCompare(db);
    });
  }, [parsed, filterType, filterValue]);

  const toggleAll = () => {
    if (selected.size === filteredGames.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredGames.map(g => g.id)));
    }
  };

  const toggleOne = (id) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const handleImport = async () => {
    setImporting(true);
    for (const gameId of selected) {
      const game = filteredGames.find(g => g.id === gameId);
      if (!game) continue;
      const away   = teamMap[game.awayTeamId];
      const home   = teamMap[game.homeTeamId];
      const league = game.leagueIds?.[0] ? leagueMap[game.leagueIds[0]] : null;

      await createMatch({
        awayTeam:           teamLabel(away),
        homeTeam:           teamLabel(home),
        awayLogoUrl:        away?.logoUrl        || '',
        homeLogoUrl:        home?.logoUrl        || '',
        awayPrimaryColor:   away?.primaryColor   || '#808080',
        awaySecondaryColor: away?.secondaryColor || '#606060',
        homePrimaryColor:   home?.primaryColor   || '#808080',
        homeSecondaryColor: home?.secondaryColor || '#606060',
        time:               game.date && game.time ? `${game.date}T${game.time}:00` : '',
        location:           game.location  || '',
        competition:        league?.shortName || league?.name || '',
        gameId:             '',
        streamUrl:          game.streamUrl  || '',
      });
    }
    navigate('/');
  };

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">Import from Schedule</h1>
      </div>

      {/* Step 1: paste JSON */}
      <div className="form-card" style={{ marginBottom: 16 }}>
        <div className="form-group" style={{ marginBottom: 12 }}>
          <label className="form-label">Schedule JSON</label>
          <textarea
            className="form-input"
            rows={6}
            style={{ fontFamily: 'var(--mono)', fontSize: 12, resize: 'vertical' }}
            placeholder="Paste schedule JSON here…"
            value={jsonText}
            onChange={e => setJsonText(e.target.value)}
          />
        </div>
        <button className="btn btn-primary" onClick={handleParse} disabled={!jsonText.trim()}>
          Parse
        </button>
        {parseError && (
          <p style={{ color: 'var(--danger)', marginTop: 10, fontSize: 13 }}>{parseError}</p>
        )}
        {parsed && (
          <p style={{ color: 'var(--success)', marginTop: 10, fontSize: 13 }}>
            ✓ {parsed.games.length} games · {Object.keys(teamMap).length} teams · {Object.keys(leagueMap).length} leagues
          </p>
        )}
      </div>

      {/* Step 2: filter */}
      {parsed && (
        <div className="form-card" style={{ marginBottom: 16 }}>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Filter by</label>
              <select
                className="form-input"
                value={filterType}
                onChange={e => { setFilterType(e.target.value); setFilterValue(''); setSelected(new Set()); }}
              >
                <option value="location">Location</option>
                <option value="team">Home Team</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">{filterType === 'location' ? 'Location' : 'Home Team'}</label>
              <select
                className="form-input"
                value={filterValue}
                onChange={e => { setFilterValue(e.target.value); setSelected(new Set()); }}
              >
                <option value="">— select —</option>
                {filterType === 'location'
                  ? locations.map(l => <option key={l} value={l}>{l}</option>)
                  : homeTeams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)
                }
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: game list */}
      {filteredGames.length > 0 && (
        <div className="form-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {filteredGames.length} scheduled game{filteredGames.length !== 1 ? 's' : ''} found
            </span>
            <button className="btn btn-sm btn-ghost" onClick={toggleAll}>
              {selected.size === filteredGames.length ? 'Deselect All' : 'Select All'}
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 16 }}>
            {filteredGames.map(game => {
              const away   = teamMap[game.awayTeamId];
              const home   = teamMap[game.homeTeamId];
              const league = game.leagueIds?.[0] ? leagueMap[game.leagueIds[0]] : null;
              const checked = selected.has(game.id);

              return (
                <label
                  key={game.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '9px 12px',
                    background: checked ? 'rgba(59,130,246,0.07)' : 'var(--bg)',
                    border: `1px solid ${checked ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: 'var(--radius)',
                    cursor: 'pointer',
                    transition: 'border-color .12s, background .12s',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleOne(game.id)}
                    style={{ accentColor: 'var(--accent)', width: 15, height: 15, flexShrink: 0 }}
                  />
                  {/* Team color dots */}
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: away?.primaryColor || '#666', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>
                      {teamLabel(away)}
                      <span style={{ color: 'var(--text-muted)', fontWeight: 400, margin: '0 6px' }}>@</span>
                      {teamLabel(home)}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                      {game.date} {game.time}
                      {game.location && ` · ${game.location}`}
                      {game.gameNumber && <span style={{ fontFamily: 'var(--mono)', marginLeft: 6, color: 'var(--success)' }}>#{game.gameNumber}</span>}
                      {league && <span style={{ marginLeft: 6 }}>· {league.shortName || league.name}</span>}
                    </div>
                  </div>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: home?.primaryColor || '#666', flexShrink: 0 }} />
                </label>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: 14 }}>
            <button className="btn btn-outline" onClick={() => navigate('/')}>Cancel</button>
            <button
              className="btn btn-primary"
              onClick={handleImport}
              disabled={selected.size === 0 || importing}
            >
              {importing
                ? 'Importing…'
                : `Import ${selected.size > 0 ? `${selected.size} Match${selected.size !== 1 ? 'es' : ''}` : ''}`}
            </button>
          </div>
        </div>
      )}

      {parsed && filterValue && filteredGames.length === 0 && (
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 48 }}>
          No scheduled games found for this selection.
        </p>
      )}
    </Layout>
  );
}
