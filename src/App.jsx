import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import keycloak from './keycloak';
import Dashboard from './pages/Dashboard';
import MatchEdit from './pages/MatchEdit';
import Overlay from './pages/Overlay';
import OverlayDirect from './pages/OverlayDirect';

function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="spinner" />
      <p>Connecting to authentication…</p>
    </div>
  );
}

/**
 * Guards protected routes — waits for Keycloak to initialise.
 * The overlay route (/overlay/*) is intentionally outside this guard.
 */
function ProtectedLayout() {
  const { initialized, authenticated } = useAuth();

  if (!initialized) return <LoadingScreen />;
  if (!authenticated) {
    keycloak.login({ redirectUri: window.location.href });
    return <LoadingScreen />;
  }

  return <Outlet />;
}

function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        {/* ── Public: OBS overlay (no auth required) ── */}
        <Route path="/overlay/game/:gameId" element={<OverlayDirect />} />
        <Route path="/overlay/:matchId" element={<Overlay />} />

        {/* ── Protected: management UI ── */}
        <Route element={<ProtectedLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/match/new" element={<MatchEdit />} />
          <Route path="/match/:id/edit" element={<MatchEdit />} />
        </Route>

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
