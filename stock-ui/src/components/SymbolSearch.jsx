/**
 * The company search that sits in the navigation bar.
 *
 * Suggestions come from the instruments stock-app already holds, matched on
 * both ticker and company name. A ticker that is not in that list is still
 * offered as its own option — loading it is what puts it there.
 */

import React, { useMemo, useRef, useState } from 'react';

import { SearchIcon } from './Icons';
import { isLoadableSymbol, matchInstruments, toSymbol } from '../lib/instruments';

/**
 * Build the option list: matching instruments first, then the typed ticker
 * itself when it is not already among them.
 *
 * @param {Array<Object>} instruments Instruments stock-app holds.
 * @param {string} query Raw text typed into the box.
 * @returns {Array<{symbol: string, name: string, meta: string, isNew: boolean}>} Options to show.
 */
function buildOptions(instruments, query) {
  const matches = matchInstruments(instruments, query).map((instrument) => ({
    symbol: instrument.symbol,
    name: instrument.name || 'Name not reported',
    meta: instrument.exchange || '',
    isNew: false,
  }));
  const typed = toSymbol(query);
  if (!isLoadableSymbol(query) || matches.some((option) => option.symbol === typed)) {
    return matches;
  }
  return [...matches, { symbol: typed, name: 'Fetch from the provider', meta: 'New', isNew: true }];
}

/**
 * Render the search box and its suggestion list.
 *
 * @param {Object} props Component props.
 * @param {Array<Object>} props.instruments Instruments to suggest from.
 * @param {function(string): void} props.onSelect Called with the chosen ticker symbol.
 * @returns {JSX.Element} The search control.
 */
export function SymbolSearch({ instruments, onSelect }) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef(null);

  const options = useMemo(() => buildOptions(instruments, query), [instruments, query]);
  const activePosition = Math.min(activeIndex, options.length - 1);
  const activeOption = options[activePosition];

  const choose = (symbol) => {
    onSelect(symbol);
    setQuery('');
    setIsOpen(false);
    setActiveIndex(0);
  };

  const handleChange = (event) => {
    setQuery(event.target.value);
    setActiveIndex(0);
    setIsOpen(true);
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      setIsOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setIsOpen(true);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((current) => (current + step + options.length) % Math.max(options.length, 1));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (isOpen && activeOption) {
        choose(activeOption.symbol);
      } else if (isLoadableSymbol(query)) {
        choose(toSymbol(query));
      }
    }
  };

  // Closing on blur has to ignore focus moving to an option inside the widget,
  // which would otherwise unmount the list before the click lands on it.
  const handleBlur = (event) => {
    if (!containerRef.current?.contains(event.relatedTarget)) {
      setIsOpen(false);
    }
  };

  return (
    <div className="search nav__search" ref={containerRef} onBlur={handleBlur}>
      <div className="search__field">
        <span className="search__icon">
          <SearchIcon />
        </span>
        <input
          className="search__input"
          type="text"
          value={query}
          placeholder="Search a company or ticker"
          aria-label="Search a company or ticker"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls="search-results"
          aria-activedescendant={isOpen && activeOption ? `search-option-${activePosition}` : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          onChange={handleChange}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
        />
      </div>

      {isOpen && (
        <ul className="search__results" id="search-results" role="listbox" aria-label="Search results">
          {options.length === 0 && (
            <li className="search__empty">
              {query.trim() === ''
                ? 'No instruments loaded yet. Type a ticker such as AAPL.'
                : `Nothing matches "${query.trim()}". Tickers use letters, digits, dots and dashes.`}
            </li>
          )}
          {options.map((option, index) => (
            // Keyboard interaction belongs to the input, which points here with
            // aria-activedescendant; the option itself must not take focus, or
            // pressing a key would leave the box it is meant to be typing in.
            /* eslint-disable-next-line jsx-a11y/click-events-have-key-events */
            <li
              key={option.symbol}
              id={`search-option-${index}`}
              className="search__option"
              role="option"
              aria-selected={option === activeOption}
              data-active={option === activeOption}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(option.symbol)}
            >
              <span className="search__symbol">{option.symbol}</span>
              <span className="search__name">{option.name}</span>
              {option.meta && (
                <span className={`search__meta badge${option.isNew ? ' badge--demo' : ''}`}>{option.meta}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
