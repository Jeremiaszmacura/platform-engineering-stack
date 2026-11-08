import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'traffic-generator:theme';

/** Colour schemes the interface can be shown in. */
export const THEMES = { dark: 'dark', light: 'light' };

/** Return the stored theme, or dark (storage access can throw in private mode). */
function readStoredTheme() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === THEMES.light ? THEMES.light : THEMES.dark;
  } catch {
    return THEMES.dark;
  }
}

/** Return [theme, toggle]; the theme is stored and set as data-theme on <html>. */
export function useTheme() {
  const [theme, setTheme] = useState(readStoredTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // A browser that refuses to store the preference still renders it.
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === THEMES.dark ? THEMES.light : THEMES.dark));
  }, []);

  return [theme, toggleTheme];
}
