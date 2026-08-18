/**
 * The navigation bar: brand, section tabs, company search, theme switch and
 * the account chip.
 *
 * Below 960px the tabs move to their own row behind a toggle. The search box
 * never collapses into an icon — finding a company is the bar's main job.
 */

import React, { useState } from 'react';

import { AccountMenu } from './AccountMenu';
import { MarkIcon, MenuIcon } from './Icons';
import { SymbolSearch } from './SymbolSearch';
import { ThemeToggle } from './ThemeToggle';

/**
 * Render the navigation bar.
 *
 * @param {Object} props Component props.
 * @param {Array<{id: string, label: string}>} props.sections Sections to offer.
 * @param {string} props.activeSection Id of the section on screen.
 * @param {function(string): void} props.onSelectSection Called with the chosen section id.
 * @param {Array<Object>} props.instruments Instruments the search suggests from.
 * @param {function(string): void} props.onSelectSymbol Called with a chosen ticker symbol.
 * @param {string} props.theme Active colour scheme.
 * @param {function(): void} props.onToggleTheme Called to switch the colour scheme.
 * @returns {JSX.Element} The navigation bar.
 */
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
