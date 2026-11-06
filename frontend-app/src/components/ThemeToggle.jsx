/** Control switching between the dark and light colour schemes. */

import React from 'react';

import { MoonIcon, SunIcon } from './Icons';
import { THEMES } from '../hooks/useTheme';

/**
 * Render the theme switch, labelled with the theme it switches *to*.
 *
 * @param {Object} props Component props.
 * @param {string} props.theme Currently active theme.
 * @param {function(): void} props.onToggle Called when the control is used.
 * @returns {JSX.Element} The control.
 */
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
