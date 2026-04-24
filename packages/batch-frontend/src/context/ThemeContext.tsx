import { createContext, type ReactNode, useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_STORAGE_KEY = 'esl-batch-theme';

function getInitialTheme(): Theme {
  if (globalThis.window === undefined) return 'light';

  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'light') {
    return stored;
  }

  // Dark mode is not product-ready for the editorial Phase 7 surfaces yet.
  // Prefer a safe light default over inheriting an unusable browser/OS dark preference.
  return 'light';
}

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    // Apply theme to document
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const toggleTheme = () => {
    setThemeState('light');
  };

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme === 'dark' ? 'light' : newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
