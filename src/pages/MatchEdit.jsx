import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import Layout from '../components/Layout';
import { getMatch, createMatch, updateMatch } from '../stores/matchStore';

const EMPTY_FORM = {
  awayTeam: '',
  homeTeam: '',
  time: '',
  location: '',
  competition: '',
  gameId: '',
  awayPrimaryColor: '#c0392b',
  awaySecondaryColor: '#7b241c',
  awayLogoUrl: '',
  homePrimaryColor: '#2471a3',
  homeSecondaryColor: '#1a5276',
  homeLogoUrl: '',
  replay: false,
};

function toDatetimeLocal(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    // format as YYYY-MM-DDTHH:MM for datetime-local input
    const pad = (n) => String(n).padStart(2, '0');
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
      `T${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
  } catch {
    return '';
  }
}

export default function MatchEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id;

  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isNew) {
      getMatch(id).then(match => {
        if (!match) { navigate('/'); return; }
        setForm({
          awayTeam: match.awayTeam,
          homeTeam: match.homeTeam,
          time: toDatetimeLocal(match.time),
          location: match.location,
          competition: match.competition,
          gameId: match.gameId,
          awayPrimaryColor: match.awayPrimaryColor || match.primaryColor || '#c0392b',
          awaySecondaryColor: match.awaySecondaryColor || '#7b241c',
          awayLogoUrl: match.awayLogoUrl || '',
          homePrimaryColor: match.homePrimaryColor || '#2471a3',
          homeSecondaryColor: match.homeSecondaryColor || '#1a5276',
          homeLogoUrl: match.homeLogoUrl || '',
          replay: match.replay || false,
        });
      });
    }
  }, [id, isNew, navigate]);

  const validate = () => {
    const e = {};
    if (!form.awayTeam.trim()) e.awayTeam = 'Away team name is required.';
    if (!form.homeTeam.trim()) e.homeTeam = 'Home team name is required.';
    if (form.gameId && !/^\d+$/.test(form.gameId.trim())) {
      e.gameId = 'Game ID must be a number.';
    }
    return e;
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    const val = type === 'checkbox' ? checked : value;
    setForm((prev) => ({ ...prev, [name]: val }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: undefined }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }

    setSaving(true);
    const data = {
      ...form,
      awayTeam: form.awayTeam.trim(),
      homeTeam: form.homeTeam.trim(),
      gameId: form.gameId.trim(),
      location: form.location.trim(),
      competition: form.competition.trim(),
      time: (() => {
        if (!form.time) return '';
        const d = new Date(form.time);
        return isNaN(d.getTime()) ? '' : d.toISOString();
      })(),
    };

    if (isNew) {
      await createMatch(data);
    } else {
      await updateMatch(id, data);
    }
    navigate('/');
  };

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">{isNew ? 'New Match' : 'Edit Match'}</h1>
        <Link to="/" className="btn btn-outline">
          ← Back
        </Link>
      </div>

      <div className="form-card">
        <form onSubmit={handleSubmit} className="match-form" noValidate>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="awayTeam" className="form-label">
                Away Team <span className="required">*</span>
              </label>
              <input
                id="awayTeam"
                name="awayTeam"
                type="text"
                className={`form-input ${errors.awayTeam ? 'input-error' : ''}`}
                value={form.awayTeam}
                onChange={handleChange}
                placeholder="e.g. Japan"
                autoComplete="off"
              />
              {errors.awayTeam && (
                <p className="form-error">{errors.awayTeam}</p>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="homeTeam" className="form-label">
                Home Team <span className="required">*</span>
              </label>
              <input
                id="homeTeam"
                name="homeTeam"
                type="text"
                className={`form-input ${errors.homeTeam ? 'input-error' : ''}`}
                value={form.homeTeam}
                onChange={handleChange}
                placeholder="e.g. United States"
                autoComplete="off"
              />
              {errors.homeTeam && (
                <p className="form-error">{errors.homeTeam}</p>
              )}
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="time" className="form-label">
                Date &amp; Time
              </label>
              <input
                id="time"
                name="time"
                type="datetime-local"
                className="form-input"
                value={form.time}
                onChange={handleChange}
              />
            </div>

            <div className="form-group">
              <label htmlFor="location" className="form-label">
                Location
              </label>
              <input
                id="location"
                name="location"
                type="text"
                className="form-input"
                value={form.location}
                onChange={handleChange}
                placeholder="e.g. Tokyo Dome, Tokyo"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="competition" className="form-label">
                Competition
              </label>
              <input
                id="competition"
                name="competition"
                type="text"
                className="form-input"
                value={form.competition}
                onChange={handleChange}
                placeholder="e.g. WBSC Premier12"
                autoComplete="off"
              />
            </div>

            <div className="form-group">
              <label htmlFor="gameId" className="form-label">
                Game ID
                <span className="label-hint">(WBSC numeric ID, optional)</span>
              </label>
              <input
                id="gameId"
                name="gameId"
                type="text"
                inputMode="numeric"
                className={`form-input ${errors.gameId ? 'input-error' : ''}`}
                value={form.gameId}
                onChange={handleChange}
                placeholder="e.g. 199053"
                autoComplete="off"
              />
              {errors.gameId && (
                <p className="form-error">{errors.gameId}</p>
              )}
              <p className="form-hint">
                Used to fetch live data from game.wbsc.org. Leave blank to show
                scheduled match info on the overlay.
              </p>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Overlay Mode</label>
            <label className="form-toggle">
              <input
                type="checkbox"
                name="replay"
                checked={form.replay}
                onChange={handleChange}
              />
              <span className="toggle-label">Replay mode</span>
            </label>
            <p className="form-hint">
              Steps through every play from play 1 to the latest, one every 3 s.
              Requires a Game ID.
            </p>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Away Team Colors</label>
              <div className="form-colors-pair">
                <input
                  id="awayPrimaryColor"
                  name="awayPrimaryColor"
                  type="color"
                  className="form-input-color"
                  value={form.awayPrimaryColor}
                  onChange={handleChange}
                  title="Away primary"
                />
                <input
                  id="awaySecondaryColor"
                  name="awaySecondaryColor"
                  type="color"
                  className="form-input-color"
                  value={form.awaySecondaryColor}
                  onChange={handleChange}
                  title="Away secondary"
                />
                <div
                  className="color-gradient-preview"
                  style={{ background: `linear-gradient(135deg, ${form.awayPrimaryColor}, ${form.awaySecondaryColor})` }}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Home Team Colors</label>
              <div className="form-colors-pair">
                <input
                  id="homePrimaryColor"
                  name="homePrimaryColor"
                  type="color"
                  className="form-input-color"
                  value={form.homePrimaryColor}
                  onChange={handleChange}
                  title="Home primary"
                />
                <input
                  id="homeSecondaryColor"
                  name="homeSecondaryColor"
                  type="color"
                  className="form-input-color"
                  value={form.homeSecondaryColor}
                  onChange={handleChange}
                  title="Home secondary"
                />
                <div
                  className="color-gradient-preview"
                  style={{ background: `linear-gradient(135deg, ${form.homePrimaryColor}, ${form.homeSecondaryColor})` }}
                />
              </div>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="awayLogoUrl" className="form-label">Away Team Logo</label>
              <input
                id="awayLogoUrl"
                name="awayLogoUrl"
                type="url"
                className="form-input"
                value={form.awayLogoUrl}
                onChange={handleChange}
                placeholder="https://example.com/away-logo.png"
                autoComplete="off"
              />
            </div>
            <div className="form-group">
              <label htmlFor="homeLogoUrl" className="form-label">Home Team Logo</label>
              <input
                id="homeLogoUrl"
                name="homeLogoUrl"
                type="url"
                className="form-input"
                value={form.homeLogoUrl}
                onChange={handleChange}
                placeholder="https://example.com/home-logo.png"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="form-actions">
            <Link to="/" className="btn btn-outline">
              Cancel
            </Link>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : isNew ? 'Create Match' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
