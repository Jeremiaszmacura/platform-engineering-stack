/**
 * Matching a typed query against the instruments stock-app already holds.
 *
 * stock-app has no company-search endpoint: `/api/v1/instruments` lists what
 * has been synced into TimescaleDB, with the company name attached. So the
 * suggestions come from that list and are filtered here in the browser, while
 * a ticker nobody has loaded yet is still reachable by typing it in full — the
 * bars request fetches it from the provider and it joins the list afterwards.
 */

/**
 * Symbol alphabet stock-app accepts. Mirrors SYMBOL_PATTERN in its params
 * module: a query outside it cannot be a ticker, so it is never offered as one.
 */
const SYMBOL_PATTERN = /^[A-Za-z0-9.-]{1,16}$/;

/** How many suggestions the dropdown shows at once. */
export const MAX_SUGGESTIONS = 7;

/**
 * Report whether a query could be a ticker stock-app would accept.
 *
 * @param {string} query Raw text typed into the search box.
 * @returns {boolean} True when the query is shaped like a ticker symbol.
 */
export function isLoadableSymbol(query) {
  return SYMBOL_PATTERN.test(query.trim());
}

/**
 * Normalize typed text into the ticker stock-app is asked for.
 *
 * @param {string} query Raw text typed into the search box.
 * @returns {string} Trimmed, upper-cased symbol.
 */
export function toSymbol(query) {
  return query.trim().toUpperCase();
}

/**
 * Rank one instrument against a query. Lower sorts first; null means no match.
 *
 * Symbol matches outrank name matches, and matches at the start of either
 * outrank matches in the middle: someone typing "AA" wants AAPL before
 * Alcoa Corporation, and "app" should still find Apple Inc.
 *
 * @param {Object} instrument Instrument to score.
 * @param {string} query Lower-cased query.
 * @returns {?number} Rank of the match, or null when the instrument does not match.
 */
function rankMatch(instrument, query) {
  const symbol = instrument.symbol.toLowerCase();
  const name = (instrument.name || '').toLowerCase();
  if (symbol === query) {
    return 0;
  }
  if (symbol.startsWith(query)) {
    return 1;
  }
  if (name.startsWith(query)) {
    return 2;
  }
  if (name.includes(query)) {
    return 3;
  }
  if (symbol.includes(query)) {
    return 4;
  }
  return null;
}

/**
 * Filter and rank instruments for the search dropdown.
 *
 * @param {Array<Object>} instruments Instruments held by stock-app.
 * @param {string} query Raw text typed into the search box; blank returns the
 *   head of the list, so the dropdown is useful before anything is typed.
 * @param {number} [limit] Maximum number of suggestions to return.
 * @returns {Array<Object>} Matching instruments, best match first.
 */
export function matchInstruments(instruments, query, limit = MAX_SUGGESTIONS) {
  const normalized = query.trim().toLowerCase();
  if (normalized === '') {
    return instruments.slice(0, limit);
  }
  return instruments
    .map((instrument) => ({ instrument, rank: rankMatch(instrument, normalized) }))
    .filter((scored) => scored.rank !== null)
    .sort((left, right) => left.rank - right.rank || left.instrument.symbol.localeCompare(right.instrument.symbol))
    .slice(0, limit)
    .map((scored) => scored.instrument);
}
