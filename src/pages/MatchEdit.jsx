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
};

function toDatetimeLocal(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
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
      const match = getMatch(id);
      if (!match) {
        navigate('/');
        return;
      }
      setForm({
        awayTeam: match.awayTeam,
        homeTeam: match.homeTeam,
        time: toDatetimeLocal(match.time),
        location: match.location,
        competition: match.competition,
        gameId: match.gameId,
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
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: undefined }));
  };

  const handleSubmit = (e) => {
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
      // Convert datetime-local to ISO string
      time: form.time ? new Date(form.time).toISOString() : '',
    };

    if (isNew) {
      createMatch(data);
    } else {
      updateMatch(id, data);
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
