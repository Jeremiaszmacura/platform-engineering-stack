/** App shell. Sections switch in place; there is no router. */

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

/** Render the app. */
export default function App() {
  const [theme, toggleTheme] = useTheme();
  const [activeSection, setActiveSection] = useState('markets');
  const [symbol, setSymbol] = useState(null);
  const { instruments, reload } = useInstruments();

  // Choosing a ticker anywhere opens the Markets view.
  const selectSymbol = useCallback((chosen) => {
    setSymbol(chosen);
    setActiveSection('markets');
  }, []);

  // A newly loaded symbol is now stored, so refresh the suggestions.
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
