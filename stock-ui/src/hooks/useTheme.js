/**
 * Colour scheme selection.
 *
 * Dark is the default because the interface is built for it; the choice is
 * kept in local storage so it survives a reload, and applied as a `data-theme`
 * attribute on the document root that every stylesheet keys off.
 */

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'stock-app:theme';

/** Colour schemes the interface can be shown in. */
export const THEMES = { dark: 'dark', light: 'light' };

/**
 * Read the stored preference, falling back to dark.
 *
 * Private-mode browsers throw on local storage access rather than returning
 * null, so a failure to read is treated as "no preference stored".
 *
 * @returns {string} The theme to start in.
 */
function readStoredTheme() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === THEMES.light ? THEMES.light : THEMES.dark;
  } catch {
    return THEMES.dark;
  }
}

/**
 * Hold the active theme, apply it to the document, and remember the choice.
 *
 * @returns {[string, function(): void]} The active theme and a function toggling it.
 */
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
