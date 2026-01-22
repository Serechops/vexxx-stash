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
  refetch: () => {},
};

const UserContext = createContext<UserContextType>(defaultContext);

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { data, loading, refetch } = GQL.useCurrentUserQuery({
    fetchPolicy: "cache-and-network",
  });

  const value = useMemo(() => {
    const user = data?.currentUser ?? null;
    const perms = user?.permissions;

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
      refetch,
    };
  }, [data, loading, refetch]);

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
