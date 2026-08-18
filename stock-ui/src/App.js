/**
 * The application shell: navigation bar, the section on screen, and the state
 * the sections share.
 *
 * Sections are switched in place rather than routed. There is one page here,
 * no deep links to keep, and a router would be a dependency and a rewrite rule
 * in the serving NGINX for no gain.
 */

import React, { useCallback, useState } from 'react';

import { MarketsView } from './views/MarketsView';
import { NavBar } from './components/NavBar';
import { PortfolioView } from './views/PortfolioView';
import { STOCK_API_URL } from './api/stockApi';
import { WatchlistView } from './views/WatchlistView';
import { useInstruments } from './hooks/useInstruments';
import { useTheme } from './hooks/useTheme';

/** Sections offered in the navigation bar, in order. */
const SECTIONS = [
  { id: 'markets', label: 'Markets' },
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'watchlist', label: 'Watchlist' },
];

/**
 * Render the application.
 *
 * @returns {JSX.Element} The app.
 */
export default function App() {
  const [theme, toggleTheme] = useTheme();
  const [activeSection, setActiveSection] = useState('markets');
  const [symbol, setSymbol] = useState(null);
  const { instruments, reload } = useInstruments();

  // Charting a ticker is the point of every list in this app, so choosing one
  // anywhere also brings the view that can show it.
  const selectSymbol = useCallback((chosen) => {
    setSymbol(chosen);
    setActiveSection('markets');
  }, []);

  // A symbol nobody had loaded before is in stock-app's store once its bars
  // arrive, so the suggestions are refreshed to include it.
  const handleHistoryLoaded = useCallback(
    (history) => {
      if (history.source === 'provider') {
        reload();
      }
    },
    [reload]
  );

  return (
    <div className="shell">
      <NavBar
        sections={SECTIONS}
        activeSection={activeSection}
        onSelectSection={setActiveSection}
        instruments={instruments}
        onSelectSymbol={selectSymbol}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      {activeSection === 'markets' && (
        <MarketsView
          symbol={symbol}
          onSelectSymbol={selectSymbol}
          instruments={instruments}
          onHistoryLoaded={handleHistoryLoaded}
          theme={theme}
        />
      )}
      {activeSection === 'portfolio' && <PortfolioView />}
      {activeSection === 'watchlist' && <WatchlistView onSelectSymbol={selectSymbol} />}

      <p className="footnote">
        Prices from stock-app at {STOCK_API_URL}. Portfolio, watchlist and account are demonstration only.
      </p>
    </div>
  );
}
