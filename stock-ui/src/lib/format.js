/**
 * Display formatting for prices, percentages, volumes and session dates.
 *
 * Centralized so a price reads the same in the header, the statistics row and
 * the crosshair readout, and so every number that is compared vertically is
 * rendered with the same number of decimals.
 */

const PLACEHOLDER = '—';

/**
 * Format a price, with the instrument's currency when one is known.
 *
 * @param {?number} value Price to format.
 * @param {?string} [currency] ISO currency code reported by stock-app.
 * @returns {string} Formatted price, or a dash when there is no value.
 */
export function formatPrice(value, currency = null) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return PLACEHOLDER;
  }
  const amount = value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${amount} ${currency}` : amount;
}

/**
 * Format a signed percentage, always carrying its sign so gains and losses are
 * distinguishable without relying on colour alone.
 *
 * @param {?number} value Percentage to format.
 * @returns {string} Formatted percentage, or a dash when there is no value.
 */
export function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return PLACEHOLDER;
  }
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

/**
 * Format a signed absolute change.
 *
 * @param {?number} value Change to format.
 * @returns {string} Formatted change, or a dash when there is no value.
 */
export function formatChange(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return PLACEHOLDER;
  }
  return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}`;
}

/**
 * Abbreviate a traded volume, which routinely runs to nine figures.
 *
 * @param {?number} value Volume to format.
 * @returns {string} Volume with a magnitude suffix, or a dash when absent.
 */
export function formatVolume(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return PLACEHOLDER;
  }
  const units = [
    { limit: 1e9, suffix: 'B' },
    { limit: 1e6, suffix: 'M' },
    { limit: 1e3, suffix: 'K' },
  ];
  const unit = units.find((candidate) => Math.abs(value) >= candidate.limit);
  if (!unit) {
    return Math.round(value).toString();
  }
  return `${(value / unit.limit).toFixed(1)}${unit.suffix}`;
}

/**
 * Format a session date for reading, e.g. `12 Jul 2026`.
 *
 * The date is rendered in UTC: it is a calendar date in the exchange's own
 * calendar, not an instant, and must not shift by timezone.
 *
 * @param {?string} isoDate Session date as `YYYY-MM-DD`.
 * @returns {string} Human-readable date, or a dash when absent.
 */
export function formatSessionDate(isoDate) {
  if (!isoDate) {
    return PLACEHOLDER;
  }
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
