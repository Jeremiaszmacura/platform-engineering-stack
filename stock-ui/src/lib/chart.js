/** Pure chart helpers, testable without a canvas. */

/** Fraction of the visible window added or removed by one zoom step. */
const ZOOM_STEP = 0.2;

/** Fewest bars that may stay on screen, so zooming in cannot empty the chart. */
const MIN_VISIBLE_BARS = 5;

/** Return a chart time (string or business-day object) as YYYY-MM-DD, or null. */
export function toSessionDate(time) {
  if (typeof time === 'string') {
    return time;
  }
  if (time && typeof time === 'object' && 'year' in time) {
    const month = String(time.month).padStart(2, '0');
    const day = String(time.day).padStart(2, '0');
    return `${time.year}-${month}-${day}`;
  }
  return null;
}

/** Return the logical range after one zoom step around its middle (factor < 1 zooms in). */
export function zoomedRange(range, factor) {
  const middle = (range.from + range.to) / 2;
  const halfWidth = Math.max(((range.to - range.from) * factor) / 2, MIN_VISIBLE_BARS / 2);
  return { from: middle - halfWidth, to: middle + halfWidth };
}

/** Visible-range multiplier for one click of the zoom-in control. */
export const ZOOM_IN_FACTOR = 1 - ZOOM_STEP;

/** Visible-range multiplier for one click of the zoom-out control. */
export const ZOOM_OUT_FACTOR = 1 + ZOOM_STEP;

/** Return {left, top} for the readout, inside the chart and away from the point. */
export function readoutPosition(point, chartSize, readoutSize) {
  const margin = 16;
  const preferredLeft = point.x + margin;
  const left =
    preferredLeft + readoutSize.width > chartSize.width ? point.x - margin - readoutSize.width : preferredLeft;
  const top = point.y - readoutSize.height / 2;
  return {
    left: Math.max(margin / 2, Math.min(left, chartSize.width - readoutSize.width - margin / 2)),
    top: Math.max(margin / 2, Math.min(top, chartSize.height - readoutSize.height - margin / 2)),
  };
}
