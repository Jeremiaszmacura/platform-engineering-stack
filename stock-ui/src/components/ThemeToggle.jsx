/** Control switching between the dark and light colour schemes. */

import React from 'react';

import { MoonIcon, SunIcon } from './Icons';
import { THEMES } from '../hooks/useTheme';

/** Theme switch, labelled with the theme it switches to. */
export function ThemeToggle({ theme, onToggle }) {
  const goingToLight = theme === THEMES.dark;
  return (
    <button
      type="button"
      className="icon-button"
      onClick={onToggle}
      title={goingToLight ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={goingToLight ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {goingToLight ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
