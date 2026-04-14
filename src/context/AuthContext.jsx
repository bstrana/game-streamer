import { createContext, useContext, useEffect, useState } from 'react';
import keycloak from '../keycloak';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [authState, setAuthState] = useState({
    initialized: false,
    authenticated: false,
    user: null,
    token: null,
  });

  useEffect(() => {
    keycloak
      .init({
        onLoad: 'login-required',
        silentCheckSsoRedirectUri: `${window.location.origin}/silent-check-sso.html`,
        pkceMethod: 'S256',
      })
      .then((authenticated) => {
        setAuthState({
          initialized: true,
          authenticated,
          user: authenticated ? keycloak.tokenParsed : null,
          token: authenticated ? keycloak.token : null,
        });

        if (authenticated) {
          // Auto-refresh token before it expires
          keycloak.onTokenExpired = () => {
            keycloak.updateToken(60).catch(() => keycloak.logout());
          };
        }
      })
      .catch(() => {
        setAuthState({
          initialized: true,
          authenticated: false,
          user: null,
          token: null,
        });
      });
  }, []);

  const logout = () => keycloak.logout({ redirectUri: window.location.origin });

  return (
    <AuthContext.Provider value={{ ...authState, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
