import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { getMatches, deleteMatch, duplicateMatch, setMatchYouTubeUrl, migrateFromLocalStorage } from '../stores/matchStore';

const runtimeCfg = window.__APP_CONFIG__ || {};
const BASE_URL = runtimeCfg.appBaseUrl || import.meta.env.VITE_APP_BASE_URL || window.location.origin;

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function isToday(match) {
  return Boolean(match.time?.startsWith(todayStr()));
}

function sortMatches(all) {
  const today = todayStr();
  return [...all].sort((a, b) => {
    const aT = Boolean(a.time?.startsWith(today));
    const bT = Boolean(b.time?.startsWith(today));
    // Today's matches always first
    if (aT !== bT) return aT ? -1 : 1;
    if (!a.time && !b.time) return 0;
    if (!a.time) return 1;
    if (!b.time) return -1;
    // Today: earliest game first; future/past: soonest upcoming first (ascending)
    return a.time.localeCompare(b.time);
  });
}

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

function buildDescription(match) {
  const lines = [];
  if (match.competition)  lines.push(`Competition: ${match.competition}`);
  if (match.time)         lines.push(`Date: ${formatDateTime(match.time)}`);
  if (match.location)     lines.push(`Location: ${match.location}`);
  return lines.join('\n');
}

// ── Copy button ───────────────────────────────────────────────────────────────

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

// ── Single-match schedule modal ───────────────────────────────────────────────

function ScheduleModal({ match, onClose, onScheduled }) {
  const [title, setTitle]           = useState(`${match.awayTeam || 'Away'} vs ${match.homeTeam || 'Home'}`);
  const [scheduledTime, setTime]    = useState(toDatetimeLocal(match.time));
  const [privacy, setPrivacy]       = useState('unlisted');
  const [description, setDesc]      = useState(match.streamDescription || buildDescription(match));
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
      onScheduled(match.id, data.broadcastUrl, data.broadcastId);
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
            <p style={{ color: 'var(--success)', fontWeight: 600, marginBottom: 10 }}>✓ Broadcast scheduled!</p>
            <p style={{ marginBottom: 20, fontSize: 13, wordBreak: 'break-all' }}>
              <a href={result.broadcastUrl} target="_blank" rel="noopener noreferrer">{result.broadcastUrl}</a>
            </p>
            <button className="btn btn-primary" onClick={onClose}>Done</button>
          </div>
        ) : (
          <div className="modal-body">
            <div className="form-group" style={{ marginBottom: 14 }}>
              <label className="form-label">Title</label>
              <input className="form-input" value={title} onChange={e => setTitle(e.target.value)} />
            </div>
            <div className="form-group" style={{ marginBottom: 14 }}>
              <label className="form-label">Scheduled Start</label>
              <input className="form-input" type="datetime-local" value={scheduledTime} onChange={e => setTime(e.target.value)} />
            </div>
            <div className="form-group" style={{ marginBottom: 14 }}>
              <label className="form-label">Privacy</label>
              <select className="form-input" value={privacy} onChange={e => setPrivacy(e.target.value)}>
                <option value="unlisted">Unlisted</option>
                <option value="public">Public</option>
                <option value="private">Private</option>
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 14 }}>
              <label className="form-label">Description</label>
              <textarea className="form-input" rows={5} style={{ resize: 'vertical', fontFamily: 'var(--mono)', fontSize: 12 }} value={description} onChange={e => setDesc(e.target.value)} />
            </div>
            <div className="form-group" style={{ marginBottom: 20 }}>
              <label className="form-label">Thumbnail URL <span className="label-hint">(optional)</span></label>
              <input className="form-input" type="url" placeholder="https://…/thumbnail.jpg" value={thumbnailUrl} onChange={e => setThumbUrl(e.target.value)} />
            </div>
            {error && <p style={{ color: 'var(--danger)', marginBottom: 14, fontSize: 13 }}>{error}</p>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSchedule} disabled={loading || !scheduledTime}>
                {loading ? 'Scheduling…' : 'Schedule'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Bulk schedule modal ───────────────────────────────────────────────────────

function BulkScheduleModal({ matches, onClose, onScheduled }) {
  const [privacy, setPrivacy]   = useState('unlisted');
  const [phase, setPhase]       = useState('confirm'); // 'confirm' | 'running' | 'done'
  const [results, setResults]   = useState([]);

  const schedulable = matches.filter(m => m.time);
  const skipped     = matches.filter(m => !m.time);

  const handleScheduleAll = async () => {
    setPhase('running');
    const res = [];
    for (const match of schedulable) {
      try {
        const r = await fetch('/api/youtube/schedule', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            title:              `${match.awayTeam || 'Away'} vs ${match.homeTeam || 'Home'}`,
            scheduledStartTime: new Date(match.time).toISOString(),
            description:        match.streamDescription || buildDescription(match),
            privacy,
          }),
        });
        const data = await r.json();
        if (data.error) throw new Error(data.error);
        res.push({ match, ok: true, url: data.broadcastUrl });
        onScheduled(match.id, data.broadcastUrl, data.broadcastId);
      } catch (e) {
        res.push({ match, ok: false, error: e.message });
      }
      setResults([...res]);
    }
    setPhase('done');
  };

  const ok    = results.filter(r => r.ok).length;
  const fail  = results.filter(r => !r.ok).length;

  return (
    <div className="modal-overlay" onClick={phase === 'confirm' ? onClose : undefined}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">
            {phase === 'confirm' && `Schedule ${schedulable.length} Match${schedulable.length !== 1 ? 'es' : ''} on YouTube`}
            {phase === 'running' && 'Scheduling…'}
            {phase === 'done'    && 'Done'}
          </h2>
          {phase !== 'running' && (
            <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
          )}
        </div>

        <div className="modal-body">
          {phase === 'confirm' && (
            <>
              {skipped.length > 0 && (
                <p style={{ color: 'var(--warn)', fontSize: 13, marginBottom: 14, padding: '8px 12px', background: 'rgba(245,158,11,.08)', borderRadius: 'var(--radius)', border: '1px solid rgba(245,158,11,.2)' }}>
                  ⚠ {skipped.length} match{skipped.length !== 1 ? 'es' : ''} without a date will be skipped.
                </p>
              )}
              {schedulable.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>
                  None of the selected matches have a date set. Add a date to schedule on YouTube.
                </p>
              ) : (
                <>
                  <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {schedulable.map(m => (
                      <div key={m.id} style={{ fontSize: 13, color: 'var(--text-muted)', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ color: 'var(--text)', fontWeight: 600 }}>{m.awayTeam} vs {m.homeTeam}</span>
                        {' — '}{formatDateTime(m.time)}
                      </div>
                    ))}
                  </div>
                  <div className="form-group" style={{ marginBottom: 20 }}>
                    <label className="form-label">Privacy for all</label>
                    <select className="form-input" value={privacy} onChange={e => setPrivacy(e.target.value)}>
                      <option value="unlisted">Unlisted</option>
                      <option value="public">Public</option>
                      <option value="private">Private</option>
                    </select>
                  </div>
                </>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-outline" onClick={onClose}>Cancel</button>
                <button className="btn btn-primary" onClick={handleScheduleAll} disabled={schedulable.length === 0}>
                  Schedule {schedulable.length > 0 ? `${schedulable.length} Match${schedulable.length !== 1 ? 'es' : ''}` : ''}
                </button>
              </div>
            </>
          )}

          {(phase === 'running' || phase === 'done') && (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                {schedulable.map((match, i) => {
                  const r = results[i];
                  const pending = !r;
                  const active  = !r && i === results.length;
                  return (
                    <div key={match.id} className={`bulk-result-row ${r?.ok ? 'ok' : r ? 'fail' : active ? 'active' : 'pending'}`}>
                      <span className="bulk-result-icon">
                        {r?.ok ? '✓' : r ? '✗' : active ? '⟳' : '·'}
                      </span>
                      <span style={{ flex: 1, fontSize: 13 }}>
                        <strong>{match.awayTeam} vs {match.homeTeam}</strong>
                        {r?.ok && <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                          <a href={r.url} target="_blank" rel="noopener noreferrer">{r.url}</a>
                        </span>}
                        {r?.error && <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--danger)' }}>{r.error}</span>}
                      </span>
                    </div>
                  );
                })}
              </div>

              {phase === 'done' && (
                <>
                  <p style={{ fontSize: 13, marginBottom: 16 }}>
                    {ok > 0 && <span style={{ color: 'var(--success)' }}>✓ {ok} scheduled. </span>}
                    {fail > 0 && <span style={{ color: 'var(--danger)' }}>✗ {fail} failed.</span>}
                    {skipped.length > 0 && <span style={{ color: 'var(--text-muted)' }}> {skipped.length} skipped (no date).</span>}
                  </p>
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button className="btn btn-primary" onClick={onClose}>Done</button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Match row ─────────────────────────────────────────────────────────────────

function MatchRow({ match, onDelete, onDuplicate, onScheduleYouTube, ytConnected, selectMode, selected, onToggleSelect, broadcastStatus, onTransition, obsConnected, obsStreaming, obsLoading, onObsStart }) {
  const overlayUrl = `${BASE_URL}/overlay/${match.id}`;
  const today = isToday(match);
  const bStatus = broadcastStatus?.status;
  const bViewers = broadcastStatus?.concurrentViewers || 0;
  const bTransitioning = broadcastStatus?.transitioning;

  const STATUS_LABEL = { live: '● LIVE', testing: '● Preview', complete: 'Ended', ready: 'Scheduled', created: 'Scheduled' };
  const STATUS_CLS   = { live: 'chip-status-live', testing: 'chip-status-testing', complete: 'chip-status-complete' };

  const handleDelete = () => onDelete(match.id);

  return (
    <div className={`match-card ${today ? 'match-card-today' : ''} ${selected ? 'match-card-selected' : ''}`}>
      <div className="match-card-header">
        {selectMode && (
          <input
            type="checkbox"
            className="match-select-cb"
            checked={selected}
            onChange={() => onToggleSelect(match.id)}
            aria-label={`Select ${match.awayTeam} vs ${match.homeTeam}`}
          />
        )}
        <div className="match-teams">
          <span className="team">{match.awayTeam || 'Away'}</span>
          <span className="vs">vs</span>
          <span className="team">{match.homeTeam || 'Home'}</span>
        </div>
        <div className="match-chips">
          {today && <span className="chip chip-today">TODAY</span>}
          {match.time && <span className="chip">{formatDateTime(match.time)}</span>}
          {match.location && <span className="chip">{match.location}</span>}
          {match.gameId
            ? <span className="chip chip-id">#{match.gameId}</span>
            : <span className="chip chip-missing">No Game ID</span>}
          {match.broadcastId && (
            bStatus
              ? <>
                  <span className={`chip chip-status ${STATUS_CLS[bStatus] || ''}`}>
                    {STATUS_LABEL[bStatus] || bStatus}
                  </span>
                  {bStatus === 'live' && bViewers > 0 && (
                    <span className="chip chip-viewers">👁 {bViewers.toLocaleString()}</span>
                  )}
                </>
              : <span className="chip chip-status">⟳ Checking…</span>
          )}
        </div>
        <div className="match-actions">
          <Link to={`/match/${match.id}/edit`} className="btn btn-sm btn-outline">Edit</Link>
          <button className="btn btn-sm btn-outline" onClick={() => onDuplicate(match.id)}>Duplicate</button>
          {match.broadcastId ? (
            bTransitioning ? (
              <button className="btn btn-sm btn-outline" disabled>⟳</button>
            ) : bStatus === 'live' ? (
              <button className="btn btn-sm btn-danger" onClick={() => onTransition(match.broadcastId, 'complete')}>⏹ End</button>
            ) : ['created', 'ready', 'testing'].includes(bStatus) ? (
              <button className="btn btn-sm btn-live" onClick={() => onTransition(match.broadcastId, 'live')}>● Go Live</button>
            ) : null
          ) : (
            <button
              className="btn btn-sm btn-outline"
              onClick={() => onScheduleYouTube(match)}
              title={ytConnected ? 'Schedule on YouTube' : 'Connect YouTube in settings first'}
            >
              ▶ YouTube
            </button>
          )}
          {match.broadcastId && obsConnected && !obsStreaming && (
            <button
              className="btn btn-sm btn-live"
              disabled={obsLoading}
              onClick={() => onObsStart(match.broadcastId)}
              title="Start OBS stream for this broadcast"
            >
              ▶ Stream
            </button>
          )}
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

// ── Dashboard ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const navigate = useNavigate();
  const [matches, setMatches]           = useState([]);
  const [ytConnected, setYtConnected]   = useState(false);
  const [schedulingMatch, setScheduling]     = useState(null);
  const [selectMode, setSelectMode]          = useState(false);
  const [selectedIds, setSelectedIds]        = useState(new Set());
  const [bulkModal, setBulkModal]            = useState(false);
  const [broadcastStatuses, setBroadcastStatuses] = useState({});
  const [obsStatus, setObsStatus]   = useState(null);
  const [obsLoading, setObsLoading] = useState(false);
  const obsSecretRef  = useRef('');
  const obsAbortRef   = useRef(null);
  const refreshingRef = useRef(false);

  const BROADCAST_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

  const refresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    try {
      const all = await getMatches();
      const sorted = sortMatches(all);
      setMatches(sorted);
      const bids = sorted
        .filter(m => m.broadcastId && BROADCAST_ID_RE.test(m.broadcastId))
        .map(m => m.broadcastId);
      if (!bids.length) return;
      const r = await fetch(`/api/youtube/broadcast-status?ids=${bids.join(',')}`);
      if (r.ok) {
        const d = await r.json();
        setBroadcastStatuses(d.statuses || {});
      }
    } catch {} finally {
      refreshingRef.current = false;
    }
  }, []);

  useEffect(() => {
    migrateFromLocalStorage().then(n => { if (n > 0) refresh(); });
    refresh();
    fetch('/api/youtube/status')
      .then(r => r.json())
      .then(d => setYtConnected(!!d.connected))
      .catch(() => {});
    fetch('/api/obs/secret')
      .then(r => r.json())
      .then(d => { obsSecretRef.current = d.secret || ''; })
      .catch(() => {});
    const interval = setInterval(refresh, 30_000);

    const fetchObs = async () => {
      if (obsAbortRef.current) obsAbortRef.current.abort();
      obsAbortRef.current = new AbortController();
      try {
        const r = await fetch('/api/obs/status', { signal: obsAbortRef.current.signal });
        if (r.ok) setObsStatus(await r.json());
      } catch (e) {
        if (e.name !== 'AbortError') { /* network error, ignore */ }
      }
    };
    fetchObs();
    const obsInterval = setInterval(fetchObs, 5_000);

    return () => {
      clearInterval(interval);
      clearInterval(obsInterval);
      if (obsAbortRef.current) obsAbortRef.current.abort();
    };
  }, [refresh]);

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const handleDelete = async (id) => {
    const match = matches.find(m => m.id === id);
    if (!match) return;
    const label = `"${match.awayTeam} vs ${match.homeTeam}"`;
    if (!window.confirm(`Delete ${label}?`)) return;
    if (match.broadcastId) {
      const alsoYT = window.confirm(
        `This match has a scheduled YouTube broadcast.\nAlso delete it from YouTube?\n\nOK = delete from YouTube too\nCancel = keep the YouTube broadcast`
      );
      if (alsoYT) {
        try {
          await fetch('/api/youtube/broadcast', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ broadcastId: match.broadcastId }),
          });
        } catch {}
      }
    }
    await deleteMatch(id);
    setSelectedIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    refresh();
  };

  const handleDuplicate = async (id) => {
    await duplicateMatch(id);
    refresh();
  };

  const handleScheduleYouTube = (match) => {
    if (!ytConnected) { navigate('/settings/youtube'); return; }
    setScheduling(match);
  };

  const handleScheduled = async (id, url, broadcastId) => {
    await setMatchYouTubeUrl(id, url, broadcastId);
    refresh();
  };

  const handleObsCommand = async (command, broadcastId) => {
    setObsLoading(true);
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (obsSecretRef.current) headers['Authorization'] = `Bearer ${obsSecretRef.current}`;
      await fetch('/api/obs/command', {
        method: 'POST',
        headers,
        body: JSON.stringify({ command, ...(broadcastId ? { broadcastId } : {}) }),
      });
    } catch {}
    setObsLoading(false);
  };

  const handleTransition = async (broadcastId, newStatus) => {
    setBroadcastStatuses(prev => ({
      ...prev,
      [broadcastId]: { ...prev[broadcastId], transitioning: true },
    }));
    try {
      const r = await fetch('/api/youtube/transition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ broadcastId, status: newStatus }),
      });
      const d = await r.json();
      if (d.ok) {
        setBroadcastStatuses(prev => ({
          ...prev,
          [broadcastId]: { status: d.status, concurrentViewers: prev[broadcastId]?.concurrentViewers || 0 },
        }));
      } else {
        alert(`Transition failed: ${d.error}`);
        setBroadcastStatuses(prev => ({
          ...prev,
          [broadcastId]: { ...prev[broadcastId], transitioning: false },
        }));
      }
    } catch (e) {
      alert(`Error: ${e.message}`);
      setBroadcastStatuses(prev => ({
        ...prev,
        [broadcastId]: { ...prev[broadcastId], transitioning: false },
      }));
    }
  };

  const handleToggleSelect = (id) => {
    setSelectedIds(prev => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  };

  const selectedMatches = matches.filter(m => selectedIds.has(m.id));

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">Matches</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {matches.length > 0 && (
            <button
              className={`btn btn-sm ${selectMode ? 'btn-outline' : 'btn-ghost'}`}
              onClick={selectMode ? exitSelectMode : () => setSelectMode(true)}
            >
              {selectMode ? 'Cancel' : 'Select'}
            </button>
          )}
          <Link to="/match/new" className="btn btn-primary">+ New Match</Link>
        </div>
      </div>

      {obsStatus && (
        <div className={`obs-bar ${obsStatus.connected ? (obsStatus.streaming ? 'obs-bar-live' : 'obs-bar-connected') : 'obs-bar-offline'}`}>
          <span className="obs-dot" />
          <span className="obs-bar-label">OBS</span>
          {obsStatus.connected ? (
            <>
              <span className="obs-bar-scene">{obsStatus.scene || '—'}</span>
              <span className={`obs-bar-state ${obsStatus.streaming ? 'obs-state-live' : ''}`}>
                {obsStatus.streaming ? '● Streaming' : obsStatus.recording ? '● Recording' : 'Idle'}
              </span>
            </>
          ) : (
            <span className="obs-bar-state">Not connected — open OBS with the script loaded</span>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {obsStatus.connected && obsStatus.streaming && (
              <button className="btn btn-sm btn-danger" disabled={obsLoading} onClick={() => handleObsCommand('stop_streaming')}>
                ⏹ Stop Stream
              </button>
            )}
          </div>
        </div>
      )}

      {matches.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">⚾</div>
          <h2>No matches yet</h2>
          <p>Create your first match to get started.</p>
          <Link to="/match/new" className="btn btn-primary">Create Match</Link>
        </div>
      ) : (
        <div className="match-list">
          {matches.map(m => (
            <MatchRow
              key={m.id}
              match={m}
              onDelete={handleDelete}
              onDuplicate={handleDuplicate}
              onScheduleYouTube={handleScheduleYouTube}
              ytConnected={ytConnected}
              selectMode={selectMode}
              selected={selectedIds.has(m.id)}
              onToggleSelect={handleToggleSelect}
              broadcastStatus={m.broadcastId ? (broadcastStatuses[m.broadcastId] || null) : null}
              onTransition={handleTransition}
              obsConnected={obsStatus?.connected || false}
              obsStreaming={obsStatus?.streaming || false}
              obsLoading={obsLoading}
              onObsStart={(broadcastId) => handleObsCommand('start_streaming', broadcastId)}
            />
          ))}
        </div>
      )}

      {/* Bulk action bar */}
      {selectMode && (
        <div className="bulk-bar">
          <label className="bulk-bar-check">
            <input
              type="checkbox"
              checked={selectedIds.size === matches.length && matches.length > 0}
              onChange={() => {
                if (selectedIds.size === matches.length) {
                  setSelectedIds(new Set());
                } else {
                  setSelectedIds(new Set(matches.map(m => m.id)));
                }
              }}
            />
            {selectedIds.size > 0 ? `${selectedIds.size} selected` : 'Select all'}
          </label>
          <button
            className="btn btn-sm"
            style={{ background: '#ff0000', color: '#fff', border: 'none', marginLeft: 'auto' }}
            disabled={selectedIds.size === 0 || !ytConnected}
            title={ytConnected ? undefined : 'Connect YouTube first'}
            onClick={() => setBulkModal(true)}
          >
            ▶ Schedule on YouTube
          </button>
          {!ytConnected && (
            <button className="btn btn-sm btn-outline" style={{ color: '#fff', borderColor: 'rgba(255,255,255,.3)' }} onClick={() => navigate('/settings/youtube')}>
              Connect YT
            </button>
          )}
        </div>
      )}

      {schedulingMatch && (
        <ScheduleModal
          match={schedulingMatch}
          onClose={() => setScheduling(null)}
          onScheduled={(id, url) => { handleScheduled(id, url); setScheduling(null); }}
        />
      )}

      {bulkModal && (
        <BulkScheduleModal
          matches={selectedMatches}
          onClose={() => { setBulkModal(false); exitSelectMode(); refresh(); }}
          onScheduled={handleScheduled}
        />
      )}
    </Layout>
  );
}
