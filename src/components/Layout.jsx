import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const location = useLocation();

  return (
    <div className="layout">
      <header className="layout-header">
        <div className="layout-logo">
          <span className="logo-icon">⚾</span>
          <span className="logo-text">Game Streamer</span>
        </div>
        <nav className="layout-nav">
          <Link
            to="/"
            className={`nav-link ${location.pathname === '/' ? 'active' : ''}`}
          >
            Matches
          </Link>
        </nav>
        <div className="layout-user">
          <span className="user-name">
            {user?.preferred_username ?? user?.name ?? 'User'}
          </span>
          <button className="btn btn-outline btn-sm" onClick={logout}>
            Sign Out
          </button>
        </div>
      </header>
      <main className="layout-main">{children}</main>
    </div>
  );
}
