import React, { createContext, useContext, useState } from 'react';

const AuthContext = createContext(null);

/**
 * Decodes a JWT payload without verifying the signature.
 * Used only to check the `exp` claim for UI gating — real
 * verification always happens server-side.
 */
function decodeJwtPayload(token) {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(atob(payload));
  } catch {
    return null;
  }
}

function isTokenExpired(token) {
  const decoded = decodeJwtPayload(token);
  if (!decoded?.exp) return true;
  return Date.now() >= decoded.exp * 1000;
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => {
    const stored = localStorage.getItem('mv_admin_token');
    if (!stored || isTokenExpired(stored)) {
      // Clear stale tokens immediately on load — prevents flash of protected content
      localStorage.removeItem('mv_admin_token');
      localStorage.removeItem('mv_admin_user');
      return null;
    }
    return stored;
  });

  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('mv_admin_token');
    if (!stored || isTokenExpired(stored)) return null;
    return JSON.parse(localStorage.getItem('mv_admin_user') || 'null');
  });

  const login = (newToken, newUser) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem('mv_admin_token', newToken);
    localStorage.setItem('mv_admin_user', JSON.stringify(newUser));
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('mv_admin_token');
    localStorage.removeItem('mv_admin_user');
  };

  return (
    <AuthContext.Provider value={{ token, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
