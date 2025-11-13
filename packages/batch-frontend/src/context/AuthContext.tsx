import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import Cookies from 'js-cookie';
import axios from 'axios';

// Define user types matching backend
export type UserRole = 'admin' | 'user' | 'viewer';

export interface User {
  id: string;
  email: string;
  role: UserRole;
  isActive: boolean;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, role?: UserRole) => Promise<void>;
  logout: () => void;
  refreshTokens: () => Promise<void>;
  updateUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

const ACCESS_TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';
const USER_KEY = 'user';

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Initialize authentication state from cookies
  useEffect(() => {
    const initializeAuth = () => {
      try {
        const accessToken = Cookies.get(ACCESS_TOKEN_KEY);
        const userData = Cookies.get(USER_KEY);

        if (accessToken && userData) {
          const parsedUser = JSON.parse(userData);
          setUser(parsedUser);
        }
      } catch (error) {
        console.error('Failed to initialize auth from cookies:', error);
        // Clear invalid cookies
        Cookies.remove(ACCESS_TOKEN_KEY, { path: '/' });
        Cookies.remove(REFRESH_TOKEN_KEY, { path: '/' });
        Cookies.remove(USER_KEY, { path: '/' });
      } finally {
        setIsLoading(false);
      }
    };

    initializeAuth();
  }, []);

  const login = async (email: string, password: string): Promise<void> => {
    try {
      setIsLoading(true);

      const response = await axios.post('/api/auth/login', {
        email: email.toLowerCase(),
        password,
      });

      const { user: userData, accessToken, refreshToken } = response.data;

      // Store tokens in httpOnly cookies (set by server)
      // Note: Frontend receives tokens but doesn't store them directly
      // Server sets httpOnly cookies

      // Store user data in memory and localStorage as backup
      setUser(userData);
      localStorage.setItem(USER_KEY, JSON.stringify(userData));

      setIsLoading(false);
    } catch (error: any) {
      setIsLoading(false);
      throw new Error(error.response?.data?.message || 'Login failed');
    }
  };

  const register = async (email: string, password: string, role: UserRole = 'user'): Promise<void> => {
    try {
      setIsLoading(true);

      const response = await axios.post('/api/auth/register', {
        email: email.toLowerCase(),
        password,
        role,
      });

      // Registration successful - user needs to login
      setIsLoading(false);
    } catch (error: any) {
      setIsLoading(false);
      throw new Error(error.response?.data?.message || 'Registration failed');
    }
  };

  const logout = () => {
    // Clear all auth data
    setUser(null);
    Cookies.remove(ACCESS_TOKEN_KEY, { path: '/' });
    Cookies.remove(REFRESH_TOKEN_KEY, { path: '/' });
    localStorage.removeItem(USER_KEY);
  };

  const refreshTokens = async (): Promise<void> => {
    try {
      const refreshToken = Cookies.get(REFRESH_TOKEN_KEY);

      if (!refreshToken) {
        throw new Error('No refresh token available');
      }

      const response = await axios.post('/api/auth/refresh', {
        refreshToken,
      });

      // Server will set new httpOnly cookies
      // Update user data if provided
      if (response.data.user) {
        setUser(response.data.user);
        localStorage.setItem(USER_KEY, JSON.stringify(response.data.user));
      }
    } catch (error: any) {
      // Token refresh failed - logout user
      logout();
      throw new Error('Session expired. Please login again.');
    }
  };

  const updateUser = (updatedUser: User) => {
    setUser(updatedUser);
    localStorage.setItem(USER_KEY, JSON.stringify(updatedUser));
  };

  const value: AuthContextType = {
    user,
    isAuthenticated: !!user,
    isLoading,
    login,
    register,
    logout,
    refreshTokens,
    updateUser,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export { AuthContext };