/** Shared number and date formatting. */

const PLACEHOLDER = '—';

/** Format a price, with its currency if known; dash if missing. */
export function formatPrice(value, currency = null) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return PLACEHOLDER;
  }
  const amount = value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${amount} ${currency}` : amount;
}

/** Format a percentage with its sign; dash if missing. */
export function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return PLACEHOLDER;
  }
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

/** Format a signed change; dash if missing. */
export function formatChange(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return PLACEHOLDER;
  }
  return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}`;
}

/** Abbreviate a volume (e.g. 49.1M); dash if missing. */
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

/** Format YYYY-MM-DD as e.g. "12 Jul 2026", in UTC so it never shifts a day. */
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
