import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function YouTubeCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState('');

  useEffect(() => {
    const params   = new URLSearchParams(window.location.search);
    const code     = params.get('code');
    const errParam = params.get('error');

    if (errParam) {
      setError(`Google authorization failed: ${errParam}`);
      return;
    }
    if (!code) {
      setError('No authorization code received.');
      return;
    }

    fetch('/api/youtube/callback', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ code }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        navigate('/settings/youtube', { replace: true });
      })
      .catch(e => setError(e.message));
  }, []);

  if (error) {
    return (
      <div style={{ padding: 60, textAlign: 'center' }}>
        <p style={{ color: 'var(--danger)', marginBottom: 20, fontSize: 15 }}>{error}</p>
        <a href="/settings/youtube" className="btn btn-outline">Back to YouTube Settings</a>
      </div>
    );
  }

  return (
    <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)' }}>
      <div className="spinner" style={{ margin: '0 auto 16px' }} />
      Completing YouTube authorization…
    </div>
  );
}
