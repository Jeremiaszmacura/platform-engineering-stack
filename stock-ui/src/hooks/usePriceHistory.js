/**
 * Loading the bars for the selected symbol and range.
 *
 * Switching range while a slow first fetch is still running would otherwise
 * let the older response overwrite the newer one, so each run marks itself
 * stale on cleanup and a stale run drops its result.
 */

import { useEffect, useState } from 'react';

import { fetchPriceHistory } from '../api/stockApi';
import { toDateWindow } from '../lib/ranges';

/** States a load can be in, mirrored by what the chart area renders. */
export const LOAD_STATUS = {
  idle: 'idle',
  loading: 'loading',
  loaded: 'loaded',
  failed: 'failed',
};

const IDLE_STATE = { status: LOAD_STATUS.idle, history: null, error: null };

/**
 * Fetch daily bars whenever the symbol or the range changes.
 *
 * @param {?string} symbol Ticker to chart, or null when nothing is selected.
 * @param {string} rangeId Id of the selected range.
 * @param {function(Object): void} [onLoaded] Called with the history after a
 *   successful load, so a caller can react to a newly synced symbol.
 * @returns {{status: string, history: ?Object, error: ?Error}} The current load state.
 */
export function usePriceHistory(symbol, rangeId, onLoaded) {
  const [state, setState] = useState(IDLE_STATE);

  useEffect(() => {
    if (!symbol) {
      setState(IDLE_STATE);
      return undefined;
    }

    let stale = false;
    setState({ status: LOAD_STATUS.loading, history: null, error: null });

    fetchPriceHistory(symbol, toDateWindow(rangeId))
      .then((history) => {
        if (stale) {
          return;
        }
        setState({ status: LOAD_STATUS.loaded, history, error: null });
        if (onLoaded) {
          onLoaded(history);
        }
      })
      .catch((error) => {
        if (!stale) {
          setState({ status: LOAD_STATUS.failed, history: null, error });
        }
      });

    return () => {
      stale = true;
    };
    // onLoaded is intentionally not a dependency: it only reports a completed
    // load, and re-running the fetch when the caller re-creates it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, rangeId]);

  return state;
}
