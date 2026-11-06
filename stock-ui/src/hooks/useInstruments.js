/**
 * The instrument list backing the search box.
 *
 * A failure here is deliberately not surfaced as an error banner: the list only
 * powers suggestions, and typing a ticker in full still works without it.
 */

import { useCallback, useEffect, useState } from 'react';

import { fetchInstruments } from '../api/stockApi';

/**
 * Load the instruments stock-app holds, and expose a way to load them again.
 *
 * @returns {{instruments: Array<Object>, reload: function(): void}} The list and a reload trigger.
 */
export function useInstruments() {
  const [instruments, setInstruments] = useState([]);

  const load = useCallback(async () => {
    try {
      setInstruments(await fetchInstruments());
    } catch {
      // Suggestions are a convenience; the search box works without them.
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { instruments, reload: load };
}
