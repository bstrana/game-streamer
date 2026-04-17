import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { getMatches, deleteMatch, duplicateMatch, setMatchYouTubeUrl, migrateFromLocalStorage } from '../stores/matchStore';

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

function toDatetimeLocal(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch {
    return iso.slice(0, 16);
  }
}

function CopyButton({ text, label = 'Copy' }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button className="btn btn-ghost btn-sm" onClick={copy} title="Copy link">
      {copied ? '✓ Copied' : label}
    </button>
  );
}

function buildDescription(match) {
  const lines = [];
  if (match.competition)  lines.push(`Competition: ${match.competition}`);
  if (match.time)         lines.push(`Date: ${formatDateTime(match.time)}`);
  if (match.location)     lines.push(`Location: ${match.location}`);
  if (match.gameId)       lines.push(`Game ID: #${match.gameId}`);
  if (match.awayLogoUrl)  lines.push(`Away logo: ${match.awayLogoUrl}`);
  if (match.homeLogoUrl)  lines.push(`Home logo: ${match.homeLogoUrl}`);
  return lines.join('\n');
}

function ScheduleModal({ match, onClose, onScheduled }) {
  const [title, setTitle]           = useState(`${match.awayTeam || 'Away'} vs ${match.homeTeam || 'Home'}`);
  const [scheduledTime, setTime]    = useState(toDatetimeLocal(match.time));
  const [privacy, setPrivacy]       = useState('unlisted');
  const [description, setDesc]      = useState(buildDescription(match));
  const [thumbnailUrl, setThumbUrl] = useState('');
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [result, setResult]         = useState(null);

  const handleSchedule = async () => {
    setLoading(true);
    setError('');
    try {
      const iso = new Date(scheduledTime).toISOString();
      const res = await fetch('/api/youtube/schedule', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          title,
          scheduledStartTime: iso,
          description,
          privacy,
          thumbnailUrl: thumbnailUrl.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResult(data);
      onScheduled(match.id, data.broadcastUrl);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Schedule on YouTube</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        {result ? (
          <div className="modal-body">
            <p style={{ color: 'var(--success)', fontWeight: 600, marginBottom: 10 }}>
              ✓ Broadcast scheduled!
            </p>
            <p style={{ marginBottom: 20, fontSize: 13, wordBreak: 'break-all' }}>
              <a href={result.broadcastUrl} target="_blank" rel="noopener noreferrer">
                {result.broadcastUrl}
              </a>
            </p>
            <button className="btn btn-primary" onClick={onClose}>Done</button>
          </div>
        ) : (
          <div className="modal-body">
            <div className="form-group" style={{ marginBottom: 14 }}>
              <label className="form-label">Title</label>
              <input
                className="form-input"
                value={title}
                onChange={e => setTitle(e.target.value)}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 14 }}>
              <label className="form-label">Scheduled Start</label>
              <input
                className="form-input"
                type="datetime-local"
                value={scheduledTime}
                onChange={e => setTime(e.target.value)}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 14 }}>
              <label className="form-label">Privacy</label>
              <select
                className="form-input"
                value={privacy}
                onChange={e => setPrivacy(e.target.value)}
              >
                <option value="unlisted">Unlisted</option>
                <option value="public">Public</option>
                <option value="private">Private</option>
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 14 }}>
              <label className="form-label">Description</label>
              <textarea
                className="form-input"
                rows={5}
                style={{ resize: 'vertical', fontFamily: 'var(--mono)', fontSize: 12 }}
                value={description}
                onChange={e => setDesc(e.target.value)}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 20 }}>
              <label className="form-label">Thumbnail URL <span className="label-hint">(optional)</span></label>
              <input
                className="form-input"
                type="url"
                placeholder="https://…/thumbnail.jpg"
                value={thumbnailUrl}
                onChange={e => setThumbUrl(e.target.value)}
              />
            </div>
            {error && (
              <p style={{ color: 'var(--danger)', marginBottom: 14, fontSize: 13 }}>{error}</p>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline" onClick={onClose}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleSchedule}
                disabled={loading || !scheduledTime}
              >
                {loading ? 'Scheduling…' : 'Schedule'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MatchRow({ match, onDelete, onDuplicate, onScheduleYouTube, ytConnected }) {
  const overlayUrl = `${BASE_URL}/overlay/${match.id}`;

  const handleDelete = () => {
    if (window.confirm(`Delete "${match.awayTeam} vs ${match.homeTeam}"?`)) {
      onDelete(match.id);
    }
  };

  return (
    <div className="match-card">
      <div className="match-card-header">
        <div className="match-teams">
          <span className="team">{match.awayTeam || 'Away'}</span>
          <span className="vs">vs</span>
          <span className="team">{match.homeTeam || 'Home'}</span>
        </div>
        <div className="match-chips">
          {match.time && <span className="chip">{formatDateTime(match.time)}</span>}
          {match.location && <span className="chip">{match.location}</span>}
          {match.gameId
            ? <span className="chip chip-id">#{match.gameId}</span>
            : <span className="chip chip-missing">No Game ID</span>}
        </div>
        <div className="match-actions">
          <Link to={`/match/${match.id}/edit`} className="btn btn-sm btn-outline">Edit</Link>
          <button className="btn btn-sm btn-outline" onClick={() => onDuplicate(match.id)}>Duplicate</button>
          <button
            className="btn btn-sm btn-outline"
            onClick={() => onScheduleYouTube(match)}
            title={ytConnected ? 'Schedule on YouTube' : 'Connect YouTube in settings first'}
          >
            ▶ YouTube
          </button>
          <button className="btn btn-sm btn-danger" onClick={handleDelete}>Delete</button>
        </div>
      </div>

      <div className="match-overlay-row">
        <span className="overlay-label">OBS URL</span>
        <code className="overlay-url">{overlayUrl}</code>
        <CopyButton text={overlayUrl} />
        <a href={overlayUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">Preview</a>
      </div>

      {match.youtubeUrl && (
        <div className="match-overlay-row">
          <span className="overlay-label" style={{ color: '#ff4444' }}>YouTube</span>
          <code className="overlay-url">{match.youtubeUrl}</code>
          <CopyButton text={match.youtubeUrl} />
          <a href={match.youtubeUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">Open</a>
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [matches, setMatches]           = useState([]);
  const [ytConnected, setYtConnected]   = useState(false);
  const [schedulingMatch, setScheduling] = useState(null);

  const reload = async () => {
    const all = await getMatches();
    all.sort((a, b) => {
      if (!a.time && !b.time) return 0;
      if (!a.time) return 1;
      if (!b.time) return -1;
      return b.time.localeCompare(a.time);
    });
    setMatches(all);
  };

  useEffect(() => {
    migrateFromLocalStorage().then(n => { if (n > 0) reload(); });
    reload();
    fetch('/api/youtube/status')
      .then(r => r.json())
      .then(d => setYtConnected(!!d.connected))
      .catch(() => {});
  }, []);

  const handleDelete = async (id) => {
    await deleteMatch(id);
    reload();
  };

  const handleDuplicate = async (id) => {
    await duplicateMatch(id);
    reload();
  };

  const handleScheduleYouTube = (match) => {
    if (!ytConnected) {
      navigate('/settings/youtube');
      return;
    }
    setScheduling(match);
  };

  const handleScheduled = async (id, url) => {
    await setMatchYouTubeUrl(id, url);
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
            <MatchRow
              key={m.id}
              match={m}
              onDelete={handleDelete}
              onDuplicate={handleDuplicate}
              onScheduleYouTube={handleScheduleYouTube}
              ytConnected={ytConnected}
            />
          ))}
        </div>
      )}

      {schedulingMatch && (
        <ScheduleModal
          match={schedulingMatch}
          onClose={() => setScheduling(null)}
          onScheduled={(id, url) => {
            handleScheduled(id, url);
            setScheduling(null);
          }}
        />
      )}
    </Layout>
  );
}
