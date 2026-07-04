import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  FRONTEND_SANDBOX_ACCESS_TOKEN,
  getFrontendSandboxUser,
  isFrontendSandboxEnabled,
} from '../dev/frontend-sandbox';
import type { UserRole as ApiUserRole, RegisterRole, UserProfile } from '../utils/api';
import {
  login as loginRequest,
  logoutSession,
  refreshToken as refreshTokenRequest,
  register as registerRequest,
} from '../utils/api';
import { setApiAuthRefreshHandler, setApiAuthToken } from '../utils/api-client';

export type UserRole = ApiUserRole;
export type User = Pick<UserProfile, 'id' | 'email' | 'role' | 'isActive'> &
  Partial<Pick<UserProfile, 'createdAt' | 'updatedAt'>>;
type AuthRefreshResponse = Awaited<ReturnType<typeof refreshTokenRequest>>;

let pendingAuthRefresh: Promise<AuthRefreshResponse> | null = null;

function refreshSessionOnce(): Promise<AuthRefreshResponse> {
  pendingAuthRefresh ??= refreshTokenRequest().finally(() => {
    pendingAuthRefresh = null;
  });
  return pendingAuthRefresh;
}

export interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    password: string,
    role?: RegisterRole,
    inviteToken?: string,
  ) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  setUserFromProfile: (nextUser: User | null) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  if (isFrontendSandboxEnabled()) {
    return <SandboxAuthProvider>{children}</SandboxAuthProvider>;
  }
  return <BackendAuthProvider>{children}</BackendAuthProvider>;
}

function SandboxAuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(() => getFrontendSandboxUser());

  useEffect(() => {
    setApiAuthToken(FRONTEND_SANDBOX_ACCESS_TOKEN);
    setApiAuthRefreshHandler(async () => ({ accessToken: FRONTEND_SANDBOX_ACCESS_TOKEN }));

    return () => {
      setApiAuthRefreshHandler(null);
      setApiAuthToken(null);
    };
  }, []);

  const login = useCallback(async () => {
    setUser(getFrontendSandboxUser());
  }, []);

  const register = useCallback(async () => undefined, []);

  const logout = useCallback(async () => {
    setUser(null);
    setApiAuthToken(null);
  }, []);

  const refresh = useCallback(async () => {
    setUser((currentUser) => currentUser ?? getFrontendSandboxUser());
    setApiAuthToken(FRONTEND_SANDBOX_ACCESS_TOKEN);
  }, []);

  const setUserFromProfile = useCallback((nextUser: User | null) => {
    setUser(nextUser);
  }, []);

  const value: AuthContextType = {
    user,
    isAuthenticated: !!user,
    isLoading: false,
    login,
    register,
    logout,
    refresh,
    setUserFromProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function BackendAuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [accessTokenValue, setAccessTokenValue] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const sessionGenerationRef = useRef(0);

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
    const generation = sessionGenerationRef.current;
    const hydrate = async () => {
      try {
        const response = await refreshSessionOnce();
        if (isMounted && sessionGenerationRef.current === generation) {
          persistSession(response.user ?? null, response.accessToken ?? null);
        }
      } catch {
        if (isMounted && sessionGenerationRef.current === generation) {
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
      sessionGenerationRef.current += 1;
      const normalizedEmail = email.trim().toLowerCase();
      const response = await loginRequest({ email: normalizedEmail, password });
      sessionGenerationRef.current += 1;
      persistSession(response.user, response.accessToken ?? null);
    },
    [persistSession],
  );

  const register = useCallback(
    async (email: string, password: string, role: RegisterRole = 'user', inviteToken?: string) => {
      const normalizedEmail = email.trim().toLowerCase();
      await registerRequest({ email: normalizedEmail, password, role, inviteToken });
    },
    [],
  );

  const logout = useCallback(async () => {
    sessionGenerationRef.current += 1;
    try {
      await logoutSession();
    } catch (error) {
      console.warn('Logout endpoint not available yet', error);
    } finally {
      persistSession(null, null);
    }
  }, [persistSession]);

  const refresh = useCallback(async () => {
    const generation = sessionGenerationRef.current;
    const response = await refreshSessionOnce();
    if (sessionGenerationRef.current === generation) {
      persistSession(response.user ?? user, response.accessToken ?? accessTokenValue);
    }
  }, [persistSession, user, accessTokenValue]);

  useEffect(() => {
    setApiAuthRefreshHandler(async () => {
      const generation = sessionGenerationRef.current;
      const response = await refreshSessionOnce();
      if (sessionGenerationRef.current === generation) {
        persistSession(response.user ?? user, response.accessToken ?? accessTokenValue);
      }
      return { accessToken: response.accessToken ?? null };
    });

    return () => {
      setApiAuthRefreshHandler(null);
    };
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
