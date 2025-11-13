import React from 'react';
import { useAuth } from '../context/AuthContext';
import type { UserRole } from '../context/AuthContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole?: UserRole;
  fallbackPath?: string;
}

export function ProtectedRoute({
  children,
  requiredRole,
}: ProtectedRouteProps) {
  const { isAuthenticated, user, isLoading } = useAuth();

  // Show loading spinner while checking authentication
  if (isLoading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '200px',
        fontSize: '16px',
        color: '#666',
      }}>
        Loading...
      </div>
    );
  }

  // Show access denied if not authenticated
  if (!isAuthenticated) {
    return (
      <div style={{
        padding: '20px',
        textAlign: 'center',
        color: '#d32f2f',
        backgroundColor: '#ffebee',
        border: '1px solid #ffcdd2',
        borderRadius: '8px',
        margin: '20px',
      }}>
        <h3>Authentication Required</h3>
        <p>You must be logged in to access this feature.</p>
        <p>Please use the login form above to authenticate.</p>
      </div>
    );
  }

  // Check role-based access if required
  if (requiredRole && user) {
    const roleHierarchy: Record<UserRole, number> = {
      viewer: 1,
      user: 2,
      admin: 3,
    };

    const userRoleLevel = roleHierarchy[user.role] || 0;
    const requiredRoleLevel = roleHierarchy[requiredRole] || 0;

    if (userRoleLevel < requiredRoleLevel) {
      return (
        <div style={{
          padding: '20px',
          textAlign: 'center',
          color: '#d32f2f',
          backgroundColor: '#ffebee',
          border: '1px solid #ffcdd2',
          borderRadius: '8px',
          margin: '20px',
        }}>
          <h3>Access Denied</h3>
          <p>You don't have permission to access this feature.</p>
          <p>Required role: {requiredRole}</p>
          <p>Your role: {user.role}</p>
        </div>
      );
    }
  }

  return <>{children}</>;
}