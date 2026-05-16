import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function RequireAuth({ children, roles }) {
  const { user, token } = useAuth();

  // SEC-05: Treat unlinked as unauthenticated — prevents redirect loop and DB access
  if (!token || !user || user.role === 'unlinked') {
    return <Navigate to="/admin/login" replace />;
  }

  if (roles && roles.length > 0 && !roles.includes(user.role)) {
    // Authenticated but wrong role — send back to dashboard
    return <Navigate to="/admin/dashboard" replace />;
  }

  return children;
}
