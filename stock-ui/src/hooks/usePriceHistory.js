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
 * Return {status, history, error} for symbol and rangeId; onLoaded gets each loaded history.
 *
 * A superseded request's result is ignored, so a slow old response can't overwrite a newer one.
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
    // onLoaded is left out on purpose: re-fetching when it changes would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, rangeId]);

  return state;
}
