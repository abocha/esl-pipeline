import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import {
  getUserProfile,
  login as loginRequest,
  register as registerRequest,
  refreshToken as refreshTokenRequest,
  logoutSession,
} from '../utils/api';
import type { RegisterRole, UserProfile, UserRole as ApiUserRole } from '../utils/api';

export type UserRole = ApiUserRole;
export type User = Pick<UserProfile, 'id' | 'email' | 'role' | 'isActive'> &
  Partial<Pick<UserProfile, 'createdAt' | 'updatedAt'>>;

interface StoredSession {
  user: User | null;
  refreshToken: string | null;
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
  if (typeof window === 'undefined') {
    return { user: null, refreshToken: null };
  }

  try {
    const serialized = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!serialized) {
      return { user: null, refreshToken: null };
    }

    const parsed = JSON.parse(serialized) as Partial<StoredSession>;
    return {
      user: parsed.user ?? null,
      refreshToken: parsed.refreshToken ?? null,
    };
  } catch (error) {
    console.warn('Failed to parse stored auth session', error);
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    return { user: null, refreshToken: null };
  }
}

export function AuthProvider({ children }: AuthProviderProps) {
  const initialSession = readStoredSession();
  const [user, setUser] = useState<User | null>(initialSession.user);
  const [refreshTokenValue, setRefreshTokenValue] = useState<string | null>(initialSession.refreshToken);
  const [isLoading, setIsLoading] = useState(true);

  const persistSession = useCallback(
    (nextUser: User | null, nextRefreshToken?: string | null) => {
      const tokenToPersist =
        typeof nextRefreshToken === 'undefined' ? refreshTokenValue : nextRefreshToken ?? null;

      setUser(nextUser);
      setRefreshTokenValue(tokenToPersist);

      if (typeof window === 'undefined') return;
      try {
        if (nextUser || tokenToPersist) {
          const payload: StoredSession = {
            user: nextUser,
            refreshToken: tokenToPersist,
          };
          window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(payload));
        } else {
          window.localStorage.removeItem(SESSION_STORAGE_KEY);
        }
      } catch (error) {
        console.warn('Failed to persist auth session', error);
      }
    },
    [refreshTokenValue]
  );

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
      persistSession(response.user, response.refreshToken ?? null);
    },
    [persistSession]
  );

  const register = useCallback(async (email: string, password: string, role: RegisterRole = 'user') => {
    const normalizedEmail = email.trim().toLowerCase();
    await registerRequest({ email: normalizedEmail, password, role });
  }, []);

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
    if (!refreshTokenValue) {
      throw new Error('No refresh token available');
    }
    const response = await refreshTokenRequest(refreshTokenValue);
    persistSession(response.user, response.refreshToken ?? refreshTokenValue);
  }, [persistSession, refreshTokenValue]);

  const setUserFromProfile = useCallback(
    (nextUser: User | null) => {
      persistSession(nextUser);
    },
    [persistSession]
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
