import { useState, useEffect, useRef } from 'react';
import Layout from '../components/Layout';

// obs-websocket v5 auth: SHA-256(SHA-256(password + salt) + challenge), base64-encoded
async function sha256b64(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
async function buildAuth(password, salt, challenge) {
  return sha256b64(await sha256b64(password + salt) + challenge);
}

let _reqSeq = 0;
const nextId = () => String(++_reqSeq);

// EventSubscriptions bitmask: General(1) | Scenes(4) | Outputs(64)
const EVT_MASK = 1 | 4 | 64;

const fmt = {
  fps:  v => (typeof v === 'number' ? v.toFixed(1) : '–'),
  ms:   v => (typeof v === 'number' ? v.toFixed(1) : '–'),
  pct:  v => (typeof v === 'number' ? v.toFixed(1) + '%' : '–'),
  mb:   v => (typeof v === 'number' ? Math.round(v) + ' MB' : '–'),
  time: v => (typeof v === 'string' ? v.split('.')[0] : ''),
};

export default function OBSRemote() {
  const [host, setHost]         = useState(() => localStorage.getItem('obs-ws-host') ?? 'localhost');
  const [port, setPort]         = useState(() => localStorage.getItem('obs-ws-port') ?? '4455');
  const [password, setPassword] = useState(() => localStorage.getItem('obs-ws-pass') ?? '');
  const [secure, setSecure]     = useState(() => localStorage.getItem('obs-ws-secure') === 'true');

  const [connState, setConnState] = useState('idle'); // idle | connecting | connected | error
  const [obsVersion, setObsVersion] = useState('');
  const [connError, setConnError]   = useState('');

  const [streaming,   setStreaming]   = useState(false);
  const [recording,   setRecording]   = useState(false);
  const [streamTime,  setStreamTime]  = useState('');
  const [recordTime,  setRecordTime]  = useState('');
  const [scenes,      setScenes]      = useState([]);
  const [currentScene, setCurrentScene] = useState('');
  const [stats,       setStats]       = useState(null);
  const [streamBusy,  setStreamBusy]  = useState(false);
  const [recordBusy,  setRecordBusy]  = useState(false);

  const wsRef      = useRef(null);
  const pendingRef = useRef({});
  const pollRef    = useRef(null);
  const sendRef    = useRef(null); // set on each connect, stable across re-renders

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (wsRef.current)   wsRef.current.close();
  }, []);

  function stopPoll() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  function makeSend(sock) {
    return (requestType, requestData) => new Promise((resolve, reject) => {
      if (!sock || sock.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected')); return;
      }
      const id = nextId();
      const timer = setTimeout(() => {
        delete pendingRef.current[id];
        reject(new Error('Request timed out'));
      }, 8000);
      pendingRef.current[id] = {
        resolve: d => { clearTimeout(timer); resolve(d); },
        reject:  e => { clearTimeout(timer); reject(e); },
      };
      sock.send(JSON.stringify({
        op: 6,
        d: { requestType, requestId: id, ...(requestData != null && { requestData }) },
      }));
    });
  }

  function connect() {
    // Validate host and port before opening a socket
    const trimHost = host.trim();
    const portNum  = parseInt(port, 10);
    if (!trimHost || /[^a-zA-Z0-9.\-_[\]:]/.test(trimHost)) {
      setConnError('Invalid host. Use a hostname or IP address (e.g. localhost, 192.168.1.5).');
      return;
    }
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      setConnError('Invalid port. Must be a number between 1 and 65535.');
      return;
    }

    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    stopPoll();
    setConnState('connecting');
    setConnError('');
    setObsVersion('');
    setStats(null);
    setScenes([]);
    setCurrentScene('');
    setStreaming(false);
    setRecording(false);
    setStreamTime('');
    setRecordTime('');

    try {
      localStorage.setItem('obs-ws-host', trimHost);
      localStorage.setItem('obs-ws-port', String(portNum));
      localStorage.setItem('obs-ws-secure', String(secure));
      password ? localStorage.setItem('obs-ws-pass', password) : localStorage.removeItem('obs-ws-pass');
    } catch {}

    const proto = secure ? 'wss' : 'ws';
    const sock = new WebSocket(`${proto}://${trimHost}:${portNum}`);
    wsRef.current = sock;
    const send = makeSend(sock);
    sendRef.current = send;

    async function onIdentified() {
      setConnState('connected');
      setConnError('');
      try {
        const [ss, rs, sl] = await Promise.all([
          send('GetStreamStatus'),
          send('GetRecordStatus'),
          send('GetSceneList'),
        ]);
        setStreaming(ss.outputActive);
        setRecording(rs.outputActive);
        if (ss.outputActive) setStreamTime(fmt.time(ss.outputTimecode));
        if (rs.outputActive) setRecordTime(fmt.time(rs.outputTimecode));
        // OBS returns scenes index-0 = bottom; reverse for top-down display
        setScenes([...(sl.scenes || [])].reverse());
        setCurrentScene(sl.currentProgramSceneName || '');
      } catch {}

      pollRef.current = setInterval(async () => {
        const s = await send('GetStats').catch(() => null);
        if (s) setStats(s);
      }, 3000);
    }

    sock.onmessage = async (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }
      const { op, d } = msg;

      if (op === 0) { // Hello — server auth challenge
        setObsVersion(d.obsWebSocketVersion || '');
        const identData = { rpcVersion: 1, eventSubscriptions: EVT_MASK };
        if (d.authentication) {
          if (!password) {
            setConnState('error');
            setConnError('OBS requires a WebSocket password. Enter it and reconnect.');
            sock.close();
            return;
          }
          identData.authentication = await buildAuth(
            password, d.authentication.salt, d.authentication.challenge,
          );
        }
        sock.send(JSON.stringify({ op: 1, d: identData }));

      } else if (op === 2) { // Identified — auth accepted
        await onIdentified();

      } else if (op === 5) { // Event
        const { eventType, eventData: ed } = d;
        if (eventType === 'StreamStateChanged') {
          setStreaming(ed.outputActive);
          if (!ed.outputActive) setStreamTime('');
          setStreamBusy(false);
        }
        if (eventType === 'RecordStateChanged') {
          setRecording(ed.outputActive);
          if (!ed.outputActive) setRecordTime('');
          setRecordBusy(false);
        }
        if (eventType === 'CurrentProgramSceneChanged') setCurrentScene(ed.sceneName);
        if (eventType === 'SceneListChanged') setScenes([...(ed.scenes || [])].reverse());

      } else if (op === 7) { // RequestResponse
        const p = pendingRef.current[d.requestId];
        if (p) {
          delete pendingRef.current[d.requestId];
          d.requestStatus.result
            ? p.resolve(d.responseData || {})
            : p.reject(new Error(d.requestStatus.comment || `Error code ${d.requestStatus.code}`));
        }
      }
    };

    sock.onerror = () => {
      setConnState('error');
      const url = `${proto}://${trimHost}:${portNum}`;
      const hint = secure
        ? 'For wss:// enable "Enable TLS" in OBS → Tools → WebSocket Server Settings and trust the certificate.'
        : 'If the app is on HTTPS, the browser blocks ws:// — enable TLS in OBS and switch to wss://.';
      setConnError(`Could not connect to ${url}. Make sure OBS is running and WebSocket server is enabled (Tools → WebSocket Server Settings). ${hint}`);
      stopPoll();
    };

    sock.onclose = () => {
      stopPoll();
      if (wsRef.current === sock) {
        wsRef.current = null;
        sendRef.current = null;
        setConnState(prev => prev === 'connected' ? 'idle' : prev);
        setStats(null);
      }
    };
  }

  function disconnect() {
    stopPoll();
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    sendRef.current = null;
    setConnState('idle');
    setObsVersion('');
    setStats(null);
    setScenes([]);
    setCurrentScene('');
    setStreaming(false);
    setRecording(false);
    setStreamTime('');
    setRecordTime('');
  }

  async function handleStreamToggle() {
    const send = sendRef.current;
    if (!send) return;
    setStreamBusy(true);
    try {
      await send(streaming ? 'StopStream' : 'StartStream');
    } catch (e) {
      setConnError(e.message);
      setStreamBusy(false);
    }
  }

  async function handleRecordToggle() {
    const send = sendRef.current;
    if (!send) return;
    setRecordBusy(true);
    try {
      await send(recording ? 'StopRecord' : 'StartRecord');
    } catch (e) {
      setConnError(e.message);
      setRecordBusy(false);
    }
  }

  async function handleSceneSwitch(sceneName) {
    const send = sendRef.current;
    if (!send || sceneName === currentScene) return;
    setCurrentScene(sceneName); // optimistic
    try { await send('SetCurrentProgramScene', { sceneName }); } catch {}
  }

  const connected = connState === 'connected';

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">OBS Remote</h1>
      </div>

      {/* ── Connection settings ── */}
      <div className="form-card" style={{ maxWidth: 700, marginBottom: 16 }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-muted)', marginBottom: 14 }}>
          WebSocket Connection
        </h2>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '0 0 auto' }}>
            <label className="form-label">Protocol</label>
            <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
              {['ws', 'wss'].map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setSecure(p === 'wss')}
                  disabled={connected || connState === 'connecting'}
                  style={{
                    padding: '7px 14px',
                    fontSize: 13,
                    fontWeight: 600,
                    fontFamily: 'var(--mono)',
                    border: 'none',
                    cursor: connected || connState === 'connecting' ? 'not-allowed' : 'pointer',
                    background: (p === 'wss') === secure ? 'var(--accent)' : 'var(--bg)',
                    color:      (p === 'wss') === secure ? '#fff' : 'var(--text-muted)',
                    transition: 'background .12s, color .12s',
                  }}
                >
                  {p}://
                </button>
              ))}
            </div>
          </div>
          <div style={{ flex: '2 1 140px' }}>
            <label className="form-label">Host</label>
            <input
              className="form-input"
              value={host}
              onChange={e => setHost(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !connected && connect()}
              disabled={connected || connState === 'connecting'}
              placeholder="localhost"
            />
          </div>
          <div style={{ flex: '1 1 75px' }}>
            <label className="form-label">Port</label>
            <input
              className="form-input"
              value={port}
              onChange={e => setPort(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !connected && connect()}
              disabled={connected || connState === 'connecting'}
              placeholder="4455"
            />
          </div>
          <div style={{ flex: '2 1 140px' }}>
            <label className="form-label">Password</label>
            <input
              className="form-input"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !connected && connect()}
              disabled={connected || connState === 'connecting'}
              placeholder="leave blank if none"
            />
          </div>
          <div style={{ paddingBottom: 1 }}>
            {connected ? (
              <button className="btn btn-outline" onClick={disconnect}>Disconnect</button>
            ) : (
              <button className="btn btn-primary" onClick={connect} disabled={connState === 'connecting'}>
                {connState === 'connecting' ? 'Connecting…' : 'Connect'}
              </button>
            )}
          </div>
        </div>
        {!secure && window.location.protocol === 'https:' && (
          <p style={{ color: 'var(--warn)', fontSize: 12, marginTop: 10, lineHeight: 1.5 }}>
            <strong>Note:</strong> This page is served over HTTPS, so browsers will block <code>ws://</code> connections (mixed content).
            Switch to <strong>wss://</strong> and enable TLS in OBS: <em>Tools → WebSocket Server Settings → Enable TLS</em>.
          </p>
        )}
        {connError && (
          <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 12, lineHeight: 1.6 }}>{connError}</p>
        )}
      </div>

      {/* ── Connected controls ── */}
      {connected && (
        <>
          {/* Status strip */}
          <div
            className={`obs-bar ${streaming ? 'obs-bar-live' : 'obs-bar-connected'}`}
            style={{ maxWidth: 700, marginBottom: 14 }}
          >
            <span className="obs-dot" />
            <span style={{ fontWeight: 600, fontSize: 13 }}>OBS {obsVersion}</span>
            {stats && (
              <>
                <span style={{ color: 'var(--border)' }}>·</span>
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{fmt.fps(stats.activeFps)} fps</span>
                {stats.renderSkippedFrames > 0 && (
                  <>
                    <span style={{ color: 'var(--border)' }}>·</span>
                    <span style={{ color: 'var(--warn)', fontSize: 12 }}>
                      {stats.renderSkippedFrames} frame{stats.renderSkippedFrames !== 1 ? 's' : ''} dropped
                    </span>
                  </>
                )}
              </>
            )}
          </div>

          {/* Stream + Record cards */}
          <div className="obs-remote-row" style={{ maxWidth: 700, marginBottom: 14 }}>
            <div className="form-card obs-control-card">
              <div className="obs-control-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    className="obs-dot"
                    style={{
                      background: streaming ? 'var(--danger)' : 'var(--text-muted)',
                      animation: streaming ? 'pulse-live 2s ease-in-out infinite' : 'none',
                    }}
                  />
                  <span style={{ fontWeight: 700, fontSize: 13, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                    Stream
                  </span>
                  {streaming && streamTime && (
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--danger)' }}>{streamTime}</span>
                  )}
                </div>
                <button
                  className={`btn btn-sm ${streaming ? 'btn-danger' : 'btn-primary'}`}
                  onClick={handleStreamToggle}
                  disabled={streamBusy}
                >
                  {streamBusy ? '…' : streaming ? 'Stop' : 'Go Live'}
                </button>
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>
                {streaming ? 'Streaming to configured output' : 'Not streaming'}
              </p>
            </div>

            <div className="form-card obs-control-card">
              <div className="obs-control-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    className="obs-dot"
                    style={{
                      background: recording ? 'var(--danger)' : 'var(--text-muted)',
                      animation: recording ? 'pulse-live 2s ease-in-out infinite' : 'none',
                    }}
                  />
                  <span style={{ fontWeight: 700, fontSize: 13, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                    Record
                  </span>
                  {recording && recordTime && (
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--danger)' }}>{recordTime}</span>
                  )}
                </div>
                <button
                  className={`btn btn-sm ${recording ? 'btn-danger' : 'btn-outline'}`}
                  onClick={handleRecordToggle}
                  disabled={recordBusy}
                >
                  {recordBusy ? '…' : recording ? 'Stop' : 'Record'}
                </button>
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>
                {recording ? 'Recording in progress' : 'Not recording'}
              </p>
            </div>
          </div>

          {/* Scene switcher */}
          {scenes.length > 0 && (
            <div className="form-card" style={{ maxWidth: 700, marginBottom: 14 }}>
              <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-muted)', marginBottom: 14 }}>
                Scenes
              </h2>
              <div className="obs-scenes-grid">
                {scenes.map(sc => (
                  <button
                    key={sc.sceneUuid ?? sc.sceneName}
                    className={`obs-scene-btn ${currentScene === sc.sceneName ? 'obs-scene-btn-active' : ''}`}
                    onClick={() => handleSceneSwitch(sc.sceneName)}
                  >
                    {sc.sceneName}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Performance stats */}
          {stats && (
            <div className="form-card" style={{ maxWidth: 700 }}>
              <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-muted)', marginBottom: 16 }}>
                Performance
              </h2>
              <div className="obs-stats-row">
                <div className="obs-stat-item">
                  <div className="obs-stat-value">{fmt.fps(stats.activeFps)}</div>
                  <div className="obs-stat-label">FPS</div>
                </div>
                <div className="obs-stat-item">
                  <div
                    className="obs-stat-value"
                    style={{ color: stats.renderSkippedFrames > 0 ? 'var(--warn)' : 'var(--success)' }}
                  >
                    {stats.renderSkippedFrames ?? 0}
                  </div>
                  <div className="obs-stat-label">Dropped</div>
                </div>
                <div className="obs-stat-item">
                  <div className="obs-stat-value">{fmt.ms(stats.averageFrameRenderTime)}<span style={{ fontSize: 12, fontWeight: 400 }}> ms</span></div>
                  <div className="obs-stat-label">Render Lag</div>
                </div>
                <div className="obs-stat-item">
                  <div className="obs-stat-value">{fmt.pct(stats.cpuUsage)}</div>
                  <div className="obs-stat-label">CPU</div>
                </div>
                <div className="obs-stat-item">
                  <div className="obs-stat-value">{fmt.mb(stats.memoryUsage)}</div>
                  <div className="obs-stat-label">Memory</div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Idle hint */}
      {connState === 'idle' && (
        <p style={{ color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.7, maxWidth: 560 }}>
          Connect to control OBS streaming, recording, and scenes remotely via the obs-websocket protocol.
          Enable the server in OBS under <strong style={{ color: 'var(--text)' }}>Tools → WebSocket Server Settings</strong>.
        </p>
      )}
    </Layout>
  );
}
