/**
 * Time ranges offered by the chart filter, and their translation into the
 * session-date window stock-app expects.
 *
 * stock-app rejects a window whose end is in the future or which spans more
 * than 3650 days, and it compares against *UTC* today. Every date here is
 * therefore derived in UTC: a browser in UTC+2 just after midnight would
 * otherwise ask for a window ending "tomorrow" and get a 422 back.
 */

/** Longest window stock-app accepts, in days. Mirrors MAX_RANGE_DAYS there. */
export const MAX_RANGE_DAYS = 3650;

/**
 * Selectable ranges, shortest first. `days` is how far back from today the
 * window starts; the labels are the ones shown on the filter pills.
 */
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

/**
 * Format a Date as the ISO calendar date of its UTC instant.
 *
 * @param {Date} date Instant to format.
 * @returns {string} Date as `YYYY-MM-DD`.
 */
export function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Look up a range by its id.
 *
 * @param {string} rangeId Id of a range in {@link RANGES}.
 * @returns {{id: string, label: string, days: number, description: string}} The range.
 * @throws {Error} If no range carries that id.
 */
export function findRange(rangeId) {
  const range = RANGES.find((candidate) => candidate.id === rangeId);
  if (!range) {
    throw new Error(`unknown range: ${rangeId}`);
  }
  return range;
}

/**
 * Translate a range into the inclusive session-date window to request.
 *
 * @param {string} rangeId Id of a range in {@link RANGES}.
 * @param {Date} [now] Instant to measure back from, defaults to the current time.
 * @returns {{start: string, end: string}} Inclusive `YYYY-MM-DD` window, in UTC.
 */
export function toDateWindow(rangeId, now = new Date()) {
  const range = findRange(rangeId);
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end.getTime() - range.days * MILLISECONDS_PER_DAY);
  return { start: toIsoDate(start), end: toIsoDate(end) };
}
