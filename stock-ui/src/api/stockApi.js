/**
 * The only place this app talks to a backend.
 *
 * Everything else in the UI — portfolio, watchlist, the account menu — is
 * demonstration state held in the browser. Requests go to stock-app on its own
 * ingress host, cross-origin from app pages, which its Ingress allows.
 */

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

/**
 * A request to stock-app that did not succeed, carrying a message meant for
 * the reader rather than the console.
 */
export class StockApiError extends Error {
  /**
   * @param {string} message Explanation to show in the interface.
   * @param {?number} status HTTP status stock-app answered with, when it answered.
   */
  constructor(message, status = null) {
    super(message);
    this.name = 'StockApiError';
    this.status = status;
  }
}

/**
 * Translate a failed request into an error the interface can present.
 *
 * @param {Error} error Error thrown by the HTTP client.
 * @param {string} subject What was being fetched, used in the fallback message.
 * @returns {StockApiError} The error to surface.
 */
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

/**
 * List the instruments stock-app already holds locally.
 *
 * @returns {Promise<Array<Object>>} Instruments with their synced window, by symbol.
 * @throws {StockApiError} If stock-app does not answer with the list.
 */
export async function fetchInstruments() {
  try {
    const response = await axios.get(`${STOCK_API_URL}/api/v1/instruments`, { timeout: REQUEST_TIMEOUT_MS });
    return response.data;
  } catch (error) {
    throw toStockApiError(error, 'the instrument list');
  }
}

/**
 * Fetch daily bars for a symbol over an inclusive session-date window.
 *
 * A window stock-app has not synced yet reaches the market data provider, so
 * the first request for a symbol is markedly slower than the ones after it.
 *
 * @param {string} symbol Ticker symbol.
 * @param {{start: string, end: string}} window Inclusive `YYYY-MM-DD` window.
 * @returns {Promise<Object>} The price history, including the bars and their source.
 * @throws {StockApiError} If stock-app does not answer with the history.
 */
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
