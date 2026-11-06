/** The only module that calls a backend (stock-app); everything else is browser-side demo data. */

import axios from 'axios';

/** Base URL of stock-app. Overridable at build time for local development. */
export const STOCK_API_URL = import.meta.env.VITE_STOCK_API_URL || 'http://stock.localhost';

const REQUEST_TIMEOUT_MS = 60000;

/** How each failure stock-app can answer with is explained to the reader. */
const FAILURE_MESSAGES = {
  404: (symbol) => `No market data for ${symbol}. Check the ticker, or pick one from the list.`,
  422: () => 'That date range is not one stock-app accepts.',
  502: () => 'The market data provider did not answer. Try again in a moment.',
  503: () => 'The market data store is unreachable. Try again in a moment.',
};

/** A failed stock-app request, with a message meant for the user. */
export class StockApiError extends Error {
  /** status is stock-app's HTTP status, or null if it didn't answer. */
  constructor(message, status = null) {
    super(message);
    this.name = 'StockApiError';
    this.status = status;
  }
}

/** Turn an HTTP client error into a StockApiError for `subject`. */
function toStockApiError(error, subject) {
  const status = error.response?.status;
  if (!status) {
    return new StockApiError(`Cannot reach stock-app at ${STOCK_API_URL}. Is the cluster running?`);
  }
  const explain = FAILURE_MESSAGES[status];
  if (explain) {
    return new StockApiError(explain(subject), status);
  }
  return new StockApiError(`stock-app answered ${status} for ${subject}.`, status);
}

/** Return the instruments stock-app holds; throws StockApiError. */
export async function fetchInstruments() {
  try {
    const response = await axios.get(`${STOCK_API_URL}/api/v1/instruments`, { timeout: REQUEST_TIMEOUT_MS });
    return response.data;
  } catch (error) {
    throw toStockApiError(error, 'the instrument list');
  }
}

/** Return the price history for symbol over {start, end}; throws StockApiError. Unsynced windows are slower (provider call). */
export async function fetchPriceHistory(symbol, window) {
  try {
    const response = await axios.get(`${STOCK_API_URL}/api/v1/instruments/${encodeURIComponent(symbol)}/bars`, {
      params: { start: window.start, end: window.end },
      timeout: REQUEST_TIMEOUT_MS,
    });
    return response.data;
  } catch (error) {
    throw toStockApiError(error, symbol);
  }
}
