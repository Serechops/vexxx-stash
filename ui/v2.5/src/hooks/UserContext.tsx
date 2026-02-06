import React, { createContext, useContext, useMemo } from "react";
import * as GQL from "src/core/generated-graphql";

interface UserContextType {
  user: GQL.CurrentUserDataFragment | null;
  isAdmin: boolean;
  isViewer: boolean;
  canModify: boolean;
  canDelete: boolean;
  canManageUsers: boolean;
  canRunTasks: boolean;
  canModifySettings: boolean;
  loading: boolean;
  /** True when no users exist in the system (first-time setup mode) */
  isSetupMode: boolean;
  refetch: () => void;
}

const defaultContext: UserContextType = {
  user: null,
  isAdmin: false,
  isViewer: false,
  canModify: false,
  canDelete: false,
  canManageUsers: false,
  canRunTasks: false,
  canModifySettings: false,
  loading: true,
  isSetupMode: false,
  refetch: () => {},
};

const UserContext = createContext<UserContextType>(defaultContext);

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { data: userData, loading: userLoading, error: userError, refetch } = GQL.useCurrentUserQuery({
    fetchPolicy: "cache-and-network",
  });

  // Also check user count to detect setup mode (no users exist)
  const { data: countData, loading: countLoading } = GQL.useUserCountQuery({
    fetchPolicy: "cache-and-network",
  });

  const value = useMemo(() => {
    const user = userData?.currentUser ?? null;
    const perms = user?.permissions;
    const userCount = countData?.userCount?.count ?? -1; // -1 means unknown/loading
    const loading = userLoading || countLoading;

    // Setup mode: no users exist yet, grant full admin access for initial setup
    const isSetupMode = userCount === 0;

    // No-auth mode: authentication is not configured (no credentials/API key),
    // but users may still exist in the database (admin cannot self-delete).
    // Detected when the currentUser query succeeds (no 401 error) but returns
    // null, and users exist. When auth IS required and the user isn't logged in,
    // the backend returns 401 which causes an Apollo network error.
    const isNoAuthMode = !loading && !isSetupMode && user === null && !userError && userCount > 0;

    // In setup mode (no users) or no-auth mode (auth disabled),
    // treat as admin with full permissions
    if (isSetupMode || isNoAuthMode) {
      return {
        user: null,
        isAdmin: true, // Treat as admin for setup/no-auth purposes
        isViewer: false,
        canModify: true,
        canDelete: true,
        canManageUsers: true,
        canRunTasks: true,
        canModifySettings: true,
        loading,
        isSetupMode,
        refetch,
      };
    }

    // Normal mode: use actual user permissions
    return {
      user,
      isAdmin: user?.role === GQL.UserRole.Admin,
      isViewer: user?.role === GQL.UserRole.Viewer,
      canModify: perms?.can_modify ?? true, // Default true for backward compatibility
      canDelete: perms?.can_delete ?? true,
      canManageUsers: perms?.can_manage_users ?? false,
      canRunTasks: perms?.can_run_tasks ?? true,
      canModifySettings: perms?.can_modify_settings ?? true,
      loading,
      isSetupMode: false,
      refetch,
    };
  }, [userData, countData, userLoading, countLoading, userError, refetch]);

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
};

export const useCurrentUser = () => useContext(UserContext);

// Hook to check if multi-user mode is enabled
export const useMultiUserEnabled = () => {
  const { data, loading } = GQL.useUserCountQuery({
    fetchPolicy: "cache-first",
  });

  return {
    enabled: (data?.userCount?.count ?? 0) > 0,
    loading,
  };
};
