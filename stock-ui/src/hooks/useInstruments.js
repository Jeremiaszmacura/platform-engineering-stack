import { useCallback, useEffect, useState } from 'react';

import { fetchInstruments } from '../api/stockApi';

/** Return {instruments, reload}; failures leave the list empty (it only feeds suggestions). */
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
