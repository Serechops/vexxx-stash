import React from "react";
import { Redirect, Route, RouteProps } from "react-router-dom";
import { useCurrentUser } from "src/hooks/UserContext";
import { LoadingIndicator } from "./Shared/LoadingIndicator";

interface ProtectedRouteProps extends RouteProps {
  /** If true, only admins can access this route */
  adminOnly?: boolean;
  /** Custom check function - return true to allow access */
  check?: () => boolean;
  /** Where to redirect if access is denied */
  redirectTo?: string;
}

/**
 * A route wrapper that checks user permissions before rendering.
 * Redirects to home if the user doesn't have access.
 */
export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  adminOnly = false,
  check,
  redirectTo = "/",
  ...routeProps
}) => {
  const { isAdmin, loading } = useCurrentUser();

  if (loading) {
    return <LoadingIndicator />;
  }

  // Check custom permission function first
  if (check && !check()) {
    return <Redirect to={redirectTo} />;
  }

  // Check admin-only access
  if (adminOnly && !isAdmin) {
    return <Redirect to={redirectTo} />;
  }

  return <Route {...routeProps} />;
};

export default ProtectedRoute;
