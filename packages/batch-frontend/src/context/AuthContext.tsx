import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';

import type { UserRole as ApiUserRole, RegisterRole, UserProfile } from '../utils/api';
import {
  login as loginRequest,
  logoutSession,
  refreshToken as refreshTokenRequest,
  register as registerRequest,
} from '../utils/api';
import { setApiAuthToken } from '../utils/api-client';

export type UserRole = ApiUserRole;
export type User = Pick<UserProfile, 'id' | 'email' | 'role' | 'isActive'> &
  Partial<Pick<UserProfile, 'createdAt' | 'updatedAt'>>;

export interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, role?: RegisterRole) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  setUserFromProfile: (nextUser: User | null) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [accessTokenValue, setAccessTokenValue] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const persistSession = useCallback((nextUser: User | null, nextAccessToken: string | null) => {
    setUser(nextUser);
    setAccessTokenValue(nextAccessToken);
    setApiAuthToken(nextAccessToken);
  }, []);

  useEffect(() => {
    setApiAuthToken(accessTokenValue);
  }, [accessTokenValue]);

  useEffect(() => {
    let isMounted = true;
    const hydrate = async () => {
      try {
        const response = await refreshTokenRequest();
        if (isMounted) {
          persistSession(response.user ?? null, response.accessToken ?? null);
        }
      } catch {
        if (isMounted) {
          persistSession(null, null);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void hydrate();
    return () => {
      isMounted = false;
    };
  }, [persistSession]);

  const login = useCallback(
    async (email: string, password: string) => {
      const normalizedEmail = email.trim().toLowerCase();
      const response = await loginRequest({ email: normalizedEmail, password });
      persistSession(response.user, response.accessToken ?? null);
    },
    [persistSession],
  );

  const register = useCallback(
    async (email: string, password: string, role: RegisterRole = 'user') => {
      const normalizedEmail = email.trim().toLowerCase();
      await registerRequest({ email: normalizedEmail, password, role });
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await logoutSession();
    } catch (error) {
      console.warn('Logout endpoint not available yet', error);
    } finally {
      persistSession(null, null);
    }
  }, [persistSession]);

  const refresh = useCallback(async () => {
    const response = await refreshTokenRequest();
    persistSession(response.user ?? user, response.accessToken ?? accessTokenValue);
  }, [persistSession, user, accessTokenValue]);

  const setUserFromProfile = useCallback(
    (nextUser: User | null) => {
      persistSession(nextUser, accessTokenValue);
    },
    [persistSession, accessTokenValue],
  );

  const value: AuthContextType = {
    user,
    isAuthenticated: !!user,
    isLoading,
    login,
    register,
    logout,
    refresh,
    setUserFromProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
