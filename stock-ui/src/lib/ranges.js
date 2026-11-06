/** Chart ranges and their start/end dates, computed in UTC like stock-app's checks. */

/** Longest window stock-app accepts, in days. Mirrors MAX_RANGE_DAYS there. */
export const MAX_RANGE_DAYS = 3650;

/** Ranges, shortest first; `days` is how far back the window starts. */
export const RANGES = [
  { id: '1W', label: '1W', days: 7, description: 'one week' },
  { id: '1M', label: '1M', days: 30, description: 'one month' },
  { id: '3M', label: '3M', days: 90, description: 'three months' },
  { id: '6M', label: '6M', days: 182, description: 'six months' },
  { id: '1Y', label: '1Y', days: 365, description: 'one year' },
  { id: '5Y', label: '5Y', days: 1825, description: 'five years' },
];

/** Range selected on first load. */
export const DEFAULT_RANGE_ID = '1M';

const MILLISECONDS_PER_DAY = 86400000;

/** Return the UTC date of `date` as YYYY-MM-DD. */
export function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

/** Return the range with this id; throws if unknown. */
export function findRange(rangeId) {
  const range = RANGES.find((candidate) => candidate.id === rangeId);
  if (!range) {
    throw new Error(`unknown range: ${rangeId}`);
  }
  return range;
}

/** Return the {start, end} window (UTC, inclusive) for a range id. */
export function toDateWindow(rangeId, now = new Date()) {
  const range = findRange(rangeId);
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end.getTime() - range.days * MILLISECONDS_PER_DAY);
  return { start: toIsoDate(start), end: toIsoDate(end) };
}
