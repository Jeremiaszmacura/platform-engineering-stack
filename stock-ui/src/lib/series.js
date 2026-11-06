/**
 * Turning stock-app's OHLCV bars into what the chart and the statistics row
 * need. Everything here is a pure function over the bar array, so the numbers
 * on screen can be tested without a browser or a running cluster.
 */

/**
 * Map bars onto the point series a line chart draws, keyed on the closing price.
 *
 * @param {Array<Object>} bars Bars in ascending session-date order.
 * @returns {Array<{time: string, value: number}>} Points for a line/area series.
 */
export function toLinePoints(bars) {
  return bars.map((bar) => ({ time: bar.date, value: bar.close }));
}

/**
 * Map bars onto the candle series a candlestick chart draws.
 *
 * @param {Array<Object>} bars Bars in ascending session-date order.
 * @returns {Array<{time: string, open: number, high: number, low: number, close: number}>}
 *   Candles for a candlestick series.
 */
export function toCandlePoints(bars) {
  return bars.map((bar) => ({
    time: bar.date,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
  }));
}

/**
 * Index bars by session date so the crosshair can read a whole bar back from
 * the date it is hovering, whichever series type is drawn.
 *
 * @param {Array<Object>} bars Bars to index.
 * @returns {Map<string, Object>} Bars keyed by their `YYYY-MM-DD` session date.
 */
export function indexBarsByDate(bars) {
  return new Map(bars.map((bar) => [bar.date, bar]));
}

/**
 * Summarize a period the way the header and the statistics row present it.
 *
 * The change is measured close-to-close across the bars actually returned, so
 * it always describes the line that is drawn rather than the dates that were
 * requested — a range starting on a weekend begins at the first session in it.
 *
 * @param {Array<Object>} bars Bars in ascending session-date order.
 * @returns {?Object} Period statistics, or null when the period holds no bars.
 */
export function summarize(bars) {
  if (bars.length === 0) {
    return null;
  }
  const first = bars[0];
  const last = bars[bars.length - 1];
  const change = last.close - first.close;
  return {
    firstDate: first.date,
    lastDate: last.date,
    firstClose: first.close,
    lastClose: last.close,
    change,
    // A zero opening close would make the percentage meaningless rather than
    // infinite, so it is reported as absent and the UI shows a dash.
    changePercent: first.close === 0 ? null : (change / first.close) * 100,
    periodHigh: bars.reduce((high, bar) => Math.max(high, bar.high), first.high),
    periodLow: bars.reduce((low, bar) => Math.min(low, bar.low), first.low),
    averageVolume: bars.reduce((total, bar) => total + bar.volume, 0) / bars.length,
    sessionCount: bars.length,
  };
}

/**
 * Classify a change for colouring: gains, losses and flat read differently.
 *
 * @param {?number} change Signed change, or null when it could not be measured.
 * @returns {'up'|'down'|'flat'} Direction of the change.
 */
export function directionOf(change) {
  if (change === null || change === undefined || change === 0) {
    return 'flat';
  }
  return change > 0 ? 'up' : 'down';
}
