/**
 * The navigation bar: brand, the backend being targeted, and the theme switch.
 *
 * Which backend to drive is the one choice that changes everything below it,
 * so it sits in the bar as tabs rather than in the form as a dropdown.
 */

import React from 'react';

import { MarkIcon } from './Icons';
import { ThemeToggle } from './ThemeToggle';

/**
 * Render the navigation bar.
 *
 * @param {Object} props Component props.
 * @param {Array<{id: string, label: string, note: string}>} props.apps Backends to offer.
 * @param {string} props.activeAppId Id of the backend being targeted.
 * @param {function(string): void} props.onSelectApp Called with the chosen backend id.
 * @param {string} props.theme Active colour scheme.
 * @param {function(): void} props.onToggleTheme Called to switch the colour scheme.
 * @returns {JSX.Element} The navigation bar.
 */
export function NavBar({ apps, activeAppId, onSelectApp, theme, onToggleTheme }) {
  return (
    <header className="nav">
      <div className="nav__brand">
        <span className="nav__mark" aria-hidden="true">
          <MarkIcon size={16} />
        </span>
        API Tester
      </div>

      <div className="nav__tabs pill-group" role="group" aria-label="Target backend">
        {apps.map((app) => (
          <button
            type="button"
            className="pill"
            key={app.id}
            aria-pressed={app.id === activeAppId}
            title={app.note}
            onClick={() => onSelectApp(app.id)}
          >
            {app.label}
          </button>
        ))}
      </div>

      <div className="nav__actions">
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>
    </header>
  );
}
