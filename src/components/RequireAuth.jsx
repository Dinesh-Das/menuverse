import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function RequireAuth({ children, roles }) {
  const { user, token } = useAuth();

  if (!token || !user) {
    return <Navigate to="/admin/login" replace />;
  }

  if (roles && roles.length > 0 && !roles.includes(user.role)) {
    // If the user does not have the required role, redirect them or show an error
    return <Navigate to="/admin/dashboard" replace />;
  }

  return children;
}
