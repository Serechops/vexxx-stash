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
  const { data: userData, loading: userLoading, refetch } = GQL.useCurrentUserQuery({
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

    // In setup mode (no users), treat as admin with full permissions
    if (isSetupMode) {
      return {
        user: null,
        isAdmin: true, // Treat as admin for setup purposes
        isViewer: false,
        canModify: true,
        canDelete: true,
        canManageUsers: true,
        canRunTasks: true,
        canModifySettings: true,
        loading,
        isSetupMode: true,
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
  }, [userData, countData, userLoading, countLoading, refetch]);

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
