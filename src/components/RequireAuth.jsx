import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function RequireAuth({ children, roles }) {
  const { user, token } = useAuth();
  const location = useLocation();

  // SEC-05: Treat unlinked as unauthenticated — prevents redirect loop and DB access
  if (!token || !user || user.role === 'unlinked') {
    return <Navigate to="/admin/login" replace />;
  }

  if (roles && roles.length > 0 && !roles.includes(user.role)) {
    // Authenticated but wrong role — send back to dashboard
    return <Navigate to="/admin/dashboard" replace />;
  }

  const isOnboardingRoute = location.pathname === '/admin/onboarding';
  if (user.role === 'owner' && user.restaurant?.onboarding_complete === false && !isOnboardingRoute) {
    return <Navigate to="/admin/onboarding" replace />;
  }
  if (user.role === 'owner' && user.restaurant?.onboarding_complete === true && isOnboardingRoute) {
    return <Navigate to="/admin/dashboard" replace />;
  }

  return children;
}
