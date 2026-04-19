import { useState, useEffect } from 'react';
import Layout from '../components/Layout';

export default function YouTubeSettings() {
  const [status, setStatus]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [obsSecret, setObsSecret]   = useState('');
  const [obsCopied, setObsCopied]   = useState(false);

  const fetchStatus = async () => {
    try {
      const res  = await fetch('/api/youtube/status');
      const data = await res.json();
      setStatus(data);
    } catch {
      setStatus({ connected: false });
    }
  };

  useEffect(() => {
    fetchStatus();
    fetch('/api/obs/secret')
      .then(r => r.json())
      .then(d => setObsSecret(d.secret || ''))
      .catch(() => {});
  }, []);

  const copyObsSecret = () => {
    navigator.clipboard.writeText(obsSecret).then(() => {
      setObsCopied(true);
      setTimeout(() => setObsCopied(false), 2000);
    });
  };

  const handleConnect = async () => {
    setLoading(true);
    setError('');
    try {
      const res  = await fetch('/api/youtube/auth-url');
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      window.location.href = data.url;
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect YouTube? Existing scheduled broadcasts will not be deleted.')) return;
    setLoading(true);
    setError('');
    try {
      await fetch('/api/youtube/disconnect', { method: 'DELETE' });
      await fetchStatus();
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">YouTube Settings</h1>
      </div>

      <div className="form-card" style={{ maxWidth: 560 }}>
        {status === null ? (
          <p style={{ color: 'var(--text-muted)' }}>Checking connection…</p>

        ) : status.connected ? (
          <div>
            <p style={{ color: 'var(--success)', fontWeight: 600, marginBottom: 12 }}>
              ✓ YouTube account connected
            </p>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 20, lineHeight: 1.6 }}>
              Scheduling broadcasts will use the persistent stream key configured in your YouTube Studio.
              Each scheduled game uses approximately 101 quota units (limit: 10,000/day).
            </p>
            <button className="btn btn-danger" onClick={handleDisconnect} disabled={loading}>
              {loading ? 'Disconnecting…' : 'Disconnect YouTube'}
            </button>
          </div>

        ) : (
          <div>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 16, lineHeight: 1.6 }}>
              Connect your Google account to schedule YouTube live streams directly from match cards.
            </p>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20, lineHeight: 1.6 }}>
              Prerequisites: a Google Cloud project with <strong>YouTube Data API v3</strong> enabled and an
              OAuth 2.0 client ID configured with redirect URI{' '}
              <code style={{ background: 'var(--bg)', padding: '1px 5px', borderRadius: 4, fontSize: 12 }}>
                {window.location.origin}/youtube/callback
              </code>
              . Set <code style={{ background: 'var(--bg)', padding: '1px 5px', borderRadius: 4, fontSize: 12 }}>GOOGLE_CLIENT_ID</code> and{' '}
              <code style={{ background: 'var(--bg)', padding: '1px 5px', borderRadius: 4, fontSize: 12 }}>GOOGLE_CLIENT_SECRET</code> in the app environment.
            </p>
            <button className="btn btn-primary" onClick={handleConnect} disabled={loading}>
              {loading ? 'Redirecting…' : 'Connect YouTube'}
            </button>
          </div>
        )}

        {error && (
          <p style={{ color: 'var(--danger)', marginTop: 16, fontSize: 13 }}>{error}</p>
        )}
      </div>

      <div className="form-card" style={{ maxWidth: 560, marginTop: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>OBS Script Setup</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 16, lineHeight: 1.6 }}>
          Copy this secret into the <strong>API Secret</strong> field of the OBS Lua script
          (Scripts panel → Game Streamer). The script uses it to authenticate its heartbeat
          and receive stream commands.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <code style={{
            flex: 1, background: 'var(--bg)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', padding: '8px 12px', fontSize: 13,
            fontFamily: 'var(--mono)', wordBreak: 'break-all',
          }}>
            {obsSecret || '—'}
          </code>
          <button
            className="btn btn-outline btn-sm"
            onClick={copyObsSecret}
            disabled={!obsSecret}
            style={{ whiteSpace: 'nowrap' }}
          >
            {obsCopied ? '✓ Copied' : 'Copy'}
          </button>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 10, lineHeight: 1.5 }}>
          This secret is auto-generated and stored on the server. Restarting the app will
          keep the same secret. If compromised, delete <code>/app/data/obs-secret.txt</code> and restart.
        </p>
      </div>
    </Layout>
  );
}
