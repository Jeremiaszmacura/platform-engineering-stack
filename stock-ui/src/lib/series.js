/** Pure transforms from stock-app bars to chart series and period statistics. */

/** Return line/area points from closing prices. */
export function toLinePoints(bars) {
  return bars.map((bar) => ({ time: bar.date, value: bar.close }));
}

/** Return candlestick points. */
export function toCandlePoints(bars) {
  return bars.map((bar) => ({
    time: bar.date,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
  }));
}

/** Return bars keyed by session date, for the crosshair readout. */
export function indexBarsByDate(bars) {
  return new Map(bars.map((bar) => [bar.date, bar]));
}

/** Return period statistics (close-to-close change over the returned bars), or null if there are none. */
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
    // A zero first close makes the percentage meaningless.
    changePercent: first.close === 0 ? null : (change / first.close) * 100,
    periodHigh: bars.reduce((high, bar) => Math.max(high, bar.high), first.high),
    periodLow: bars.reduce((low, bar) => Math.min(low, bar.low), first.low),
    averageVolume: bars.reduce((total, bar) => total + bar.volume, 0) / bars.length,
    sessionCount: bars.length,
  };
}

/** Return 'up', 'down' or 'flat' for a change. */
export function directionOf(change) {
  if (change === null || change === undefined || change === 0) {
    return 'flat';
  }
  return change > 0 ? 'up' : 'down';
}
