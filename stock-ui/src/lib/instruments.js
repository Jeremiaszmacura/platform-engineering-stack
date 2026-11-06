/** Search over the instruments stock-app holds (it has no search endpoint). */

/** Same as stock-app's SYMBOL_PATTERN. */
const SYMBOL_PATTERN = /^[A-Za-z0-9.-]{1,16}$/;

/** How many suggestions the dropdown shows at once. */
export const MAX_SUGGESTIONS = 7;

/** True if query looks like a ticker stock-app accepts. */
export function isLoadableSymbol(query) {
  return SYMBOL_PATTERN.test(query.trim());
}

/** Return query trimmed and upper-cased. */
export function toSymbol(query) {
  return query.trim().toUpperCase();
}

/** Return a match rank (lower is better) or null: symbol before name, prefix before substring. */
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

/** Return up to `limit` instruments matching query, best first (a blank query returns the first ones). */
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
