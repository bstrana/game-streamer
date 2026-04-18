import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function IconMatches() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6"  x2="21" y2="6"/>
      <line x1="3" y1="12" x2="21" y2="12"/>
      <line x1="3" y1="18" x2="21" y2="18"/>
    </svg>
  );
}

function IconImport() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12"/>
      <path d="M7 11l5 5 5-5"/>
      <path d="M5 19h14"/>
    </svg>
  );
}

function IconYouTube() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <polygon fill="currentColor" stroke="none" points="10,8 16,12 10,16"/>
    </svg>
  );
}

const NAV = [
  { to: '/',                label: 'Matches', Icon: IconMatches,  exact: true },
  { to: '/import',          label: 'Import',  Icon: IconImport,   exact: false },
  { to: '/settings/youtube',label: 'YouTube', Icon: IconYouTube,  exact: false },
];

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const location = useLocation();

  const isActive = ({ to, exact }) =>
    exact ? location.pathname === to : location.pathname.startsWith(to);

  const userLabel = user?.preferred_username ?? user?.name ?? 'User';
  const userInitial = userLabel.charAt(0).toUpperCase();

  return (
    <div className="layout">
      <header className="layout-header">
        <div className="layout-logo">
          <img src="/baseball.svg" alt="" className="logo-img" />
          <span className="logo-text">Game Streamer</span>
        </div>

        {/* Desktop nav */}
        <nav className="layout-nav">
          {NAV.map(item => (
            <Link
              key={item.to}
              to={item.to}
              className={`nav-link ${isActive(item) ? 'active' : ''}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="layout-user">
          <span className="user-name">{userLabel}</span>
          <div className="user-avatar" title={userLabel}>{userInitial}</div>
          <button className="btn btn-outline btn-sm sign-out-btn" onClick={logout}>
            Sign Out
          </button>
        </div>
      </header>

      <main className="layout-main">{children}</main>

      {/* Mobile bottom tab bar */}
      <nav className="layout-bottom-nav">
        {NAV.map(({ to, label, Icon, exact }) => (
          <Link
            key={to}
            to={to}
            className={`bottom-nav-item ${isActive({ to, exact }) ? 'active' : ''}`}
          >
            <Icon />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
