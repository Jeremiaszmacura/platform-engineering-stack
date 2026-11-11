import React from 'react';

import { MarkIcon } from './Icons';
import { ThemeToggle } from './ThemeToggle';

/** Navigation bar: brand, backend tabs and theme switch. */
export function NavBar({ apps, activeAppId, onSelectApp, theme, onToggleTheme }) {
  return (
    <header className="nav">
      <div className="nav__brand">
        <span className="nav__mark" aria-hidden="true">
          <MarkIcon size={16} />
        </span>
        Traffic Generator
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
