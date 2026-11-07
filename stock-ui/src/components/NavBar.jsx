import React, { useState } from 'react';

import { AccountMenu } from './AccountMenu';
import { MarkIcon, MenuIcon } from './Icons';
import { SymbolSearch } from './SymbolSearch';
import { ThemeToggle } from './ThemeToggle';

/** Navigation bar: brand, section tabs, search, theme switch and account chip (tabs collapse below 960px). */
export function NavBar({
  sections,
  activeSection,
  onSelectSection,
  instruments,
  onSelectSymbol,
  theme,
  onToggleTheme,
}) {
  const [areTabsOpen, setAreTabsOpen] = useState(false);

  const selectSection = (id) => {
    onSelectSection(id);
    setAreTabsOpen(false);
  };

  return (
    <header className="nav">
      <div className="nav__brand">
        <span className="nav__mark" aria-hidden="true">
          <MarkIcon size={16} />
        </span>
        Stock App
      </div>

      <nav className="nav__tabs pill-group" aria-label="Sections" hidden={!areTabsOpen}>
        {sections.map((section) => (
          <button
            type="button"
            className="pill"
            key={section.id}
            aria-current={section.id === activeSection ? 'page' : undefined}
            onClick={() => selectSection(section.id)}
          >
            {section.label}
          </button>
        ))}
      </nav>

      <SymbolSearch instruments={instruments} onSelect={onSelectSymbol} />

      <div className="nav__actions">
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        <AccountMenu />
        <button
          type="button"
          className="icon-button nav__drawer-toggle"
          aria-expanded={areTabsOpen}
          aria-label="Show sections"
          onClick={() => setAreTabsOpen((open) => !open)}
        >
          <MenuIcon />
        </button>
      </div>
    </header>
  );
}
