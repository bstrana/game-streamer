import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import { getMatches, deleteMatch, duplicateMatch } from '../stores/matchStore';

const runtimeCfg = window.__APP_CONFIG__ || {};
const BASE_URL = runtimeCfg.appBaseUrl || import.meta.env.VITE_APP_BASE_URL || window.location.origin;

function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button className="btn btn-ghost btn-sm" onClick={copy} title="Copy link">
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  );
}

function MatchRow({ match, onDelete, onDuplicate }) {
  const overlayUrl = `${BASE_URL}/overlay/${match.id}`;

  const handleDelete = () => {
    if (window.confirm(`Delete match "${match.awayTeam} vs ${match.homeTeam}"?`)) {
      onDelete(match.id);
    }
  };

  return (
    <div className="match-card">
      <div className="match-card-header">
        <div className="match-teams">
          <span className="team away">{match.awayTeam || 'Away Team'}</span>
          <span className="vs">vs</span>
          <span className="team home">{match.homeTeam || 'Home Team'}</span>
        </div>
        <div className="match-actions">
          <Link to={`/match/${match.id}/edit`} className="btn btn-sm btn-outline">
            Edit
          </Link>
          <button className="btn btn-sm btn-outline" onClick={() => onDuplicate(match.id)}>
            Duplicate
          </button>
          <button className="btn btn-sm btn-danger" onClick={handleDelete}>
            Delete
          </button>
        </div>
      </div>

      <div className="match-meta">
        <span className="meta-item">
          <span className="meta-label">Competition</span>
          <span className="meta-value">{match.competition || '—'}</span>
        </span>
        <span className="meta-item">
          <span className="meta-label">Location</span>
          <span className="meta-value">{match.location || '—'}</span>
        </span>
        <span className="meta-item">
          <span className="meta-label">Time</span>
          <span className="meta-value">{formatDateTime(match.time)}</span>
        </span>
        <span className="meta-item">
          <span className="meta-label">Game ID</span>
          <span className={`meta-value ${match.gameId ? 'game-id-set' : 'game-id-missing'}`}>
            {match.gameId || 'Not set'}
          </span>
        </span>
      </div>

      <div className="match-overlay-section">
        <div className="overlay-url-row">
          <span className="overlay-label">OBS Browser Source URL:</span>
          <div className="overlay-url-group">
            <code className="overlay-url">{overlayUrl}</code>
            <CopyButton text={overlayUrl} />
            <a
              href={overlayUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost btn-sm"
            >
              Preview
            </a>
          </div>
        </div>
        {!match.gameId && (
          <p className="overlay-note">
            ⚠ No Game ID set — overlay will show scheduled match info only.
          </p>
        )}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [matches, setMatches] = useState([]);

  const reload = () => {
    const all = getMatches();
    all.sort((a, b) => {
      if (!a.time && !b.time) return 0;
      if (!a.time) return 1;
      if (!b.time) return -1;
      return b.time.localeCompare(a.time);
    });
    setMatches(all);
  };

  useEffect(() => {
    reload();
  }, []);

  const handleDelete = (id) => {
    deleteMatch(id);
    reload();
  };

  const handleDuplicate = (id) => {
    duplicateMatch(id);
    reload();
  };

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">Matches</h1>
        <Link to="/match/new" className="btn btn-primary">
          + New Match
        </Link>
      </div>

      {matches.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">⚾</div>
          <h2>No matches yet</h2>
          <p>Create your first match to get started.</p>
          <Link to="/match/new" className="btn btn-primary">
            Create Match
          </Link>
        </div>
      ) : (
        <div className="match-list">
          {matches.map((m) => (
            <MatchRow key={m.id} match={m} onDelete={handleDelete} onDuplicate={handleDuplicate} />
          ))}
        </div>
      )}
    </Layout>
  );
}
