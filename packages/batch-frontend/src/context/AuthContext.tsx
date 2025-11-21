import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from 'react';

import {
  getUserProfile,
  login as loginRequest,
  logoutSession,
  refreshToken as refreshTokenRequest,
  register as registerRequest,
} from '../utils/api';
import type { UserRole as ApiUserRole, RegisterRole, UserProfile } from '../utils/api';
import { setApiAuthToken } from '../utils/api-client';

export type UserRole = ApiUserRole;
export type User = Pick<UserProfile, 'id' | 'email' | 'role' | 'isActive'> &
  Partial<Pick<UserProfile, 'createdAt' | 'updatedAt'>>;

interface StoredSession {
  user: User | null;
  refreshToken: string | null;
  accessToken: string | null;
}

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

const SESSION_STORAGE_KEY = 'esl-batch-session';

function readStoredSession(): StoredSession {
  if (globalThis.window === undefined) {
    return { user: null, refreshToken: null, accessToken: null };
  }

  try {
    const serialized = globalThis.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!serialized) {
      return { user: null, refreshToken: null, accessToken: null };
    }

    const parsed = JSON.parse(serialized) as Partial<StoredSession>;
    return {
      user: parsed.user ?? null,
      refreshToken: parsed.refreshToken ?? null,
      accessToken: parsed.accessToken ?? null,
    };
  } catch (error) {
    console.warn('Failed to parse stored auth session', error);
    globalThis.localStorage.removeItem(SESSION_STORAGE_KEY);
    return { user: null, refreshToken: null, accessToken: null };
  }
}

export function AuthProvider({ children }: AuthProviderProps) {
  const initialSession = readStoredSession();
  const [user, setUser] = useState<User | null>(initialSession.user);
  const [refreshTokenValue, setRefreshTokenValue] = useState<string | null>(
    initialSession.refreshToken,
  );
  const [accessTokenValue, setAccessTokenValue] = useState<string | null>(
    initialSession.accessToken,
  );
  const [isLoading, setIsLoading] = useState(true);

  const persistSession = useCallback(
    (
      nextUser: User | null,
      options?: {
        refreshToken?: string | null;
        accessToken?: string | null;
      },
    ) => {
      const hasRefreshOverride = options?.refreshToken !== undefined;
      const hasAccessOverride = options?.accessToken !== undefined;

      const nextRefresh = hasRefreshOverride ? (options!.refreshToken ?? null) : refreshTokenValue;
      const nextAccess = hasAccessOverride ? (options!.accessToken ?? null) : accessTokenValue;

      setUser(nextUser);
      setRefreshTokenValue(nextRefresh);
      setAccessTokenValue(nextAccess);
      setApiAuthToken(nextAccess);

      if (globalThis.window === undefined) return;
      try {
        if (nextUser || nextRefresh || nextAccess) {
          const payload: StoredSession = {
            user: nextUser,
            refreshToken: nextRefresh,
            accessToken: nextAccess,
          };
          globalThis.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(payload));
        } else {
          globalThis.localStorage.removeItem(SESSION_STORAGE_KEY);
        }
      } catch (error) {
        console.warn('Failed to persist auth session', error);
      }
    },
    [refreshTokenValue, accessTokenValue],
  );

  useEffect(() => {
    setApiAuthToken(accessTokenValue);
  }, [accessTokenValue]);

  useEffect(() => {
    let isMounted = true;
    const hydrate = async () => {
      try {
        const profile = await getUserProfile();
        if (isMounted) {
          persistSession(profile);
        }
      } catch {
        if (isMounted) {
          persistSession(null, { refreshToken: null, accessToken: null });
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
      persistSession(response.user, {
        refreshToken: response.refreshToken ?? null,
        accessToken: response.accessToken ?? null,
      });
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
      persistSession(null, { refreshToken: null, accessToken: null });
    }
  }, [persistSession]);

  const refresh = useCallback(async () => {
    if (!refreshTokenValue) {
      throw new Error('No refresh token available');
    }
    const response = await refreshTokenRequest(refreshTokenValue);
    persistSession(response.user ?? user, {
      refreshToken: response.refreshToken ?? refreshTokenValue,
      accessToken: response.accessToken ?? accessTokenValue,
    });
  }, [persistSession, refreshTokenValue, user, accessTokenValue]);

  const setUserFromProfile = useCallback(
    (nextUser: User | null) => {
      persistSession(nextUser);
    },
    [persistSession],
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

export { AuthContext };
