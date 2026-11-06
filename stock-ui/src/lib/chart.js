/**
 * Pure helpers for driving the chart library, kept out of the component so
 * they can be tested without a canvas.
 */

/** Fraction of the visible window added or removed by one zoom step. */
const ZOOM_STEP = 0.2;

/** Fewest bars that may stay on screen, so zooming in cannot empty the chart. */
const MIN_VISIBLE_BARS = 5;

/**
 * Normalize the chart library's time value back into a session date.
 *
 * Bars are handed to the library as `YYYY-MM-DD` strings, but a crosshair
 * event may report the time either as that string or as a business-day object,
 * depending on how the point was resolved. Both are reduced to the key the
 * bars are indexed under.
 *
 * @param {string|{year: number, month: number, day: number}|number} time Time from a chart event.
 * @returns {?string} Session date as `YYYY-MM-DD`, or null when the time is not a calendar date.
 */
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

/**
 * Compute the visible logical range after one zoom step.
 *
 * Zooming keeps the middle of the window fixed, which is what the eye expects
 * from a `+`/`−` control that is not anchored to the pointer.
 *
 * @param {{from: number, to: number}} range Currently visible logical range.
 * @param {number} factor Multiplier for the window width: below 1 zooms in.
 * @returns {{from: number, to: number}} The range to show next.
 */
export function zoomedRange(range, factor) {
  const middle = (range.from + range.to) / 2;
  const halfWidth = Math.max(((range.to - range.from) * factor) / 2, MIN_VISIBLE_BARS / 2);
  return { from: middle - halfWidth, to: middle + halfWidth };
}

/** Visible-range multiplier for one click of the zoom-in control. */
export const ZOOM_IN_FACTOR = 1 - ZOOM_STEP;

/** Visible-range multiplier for one click of the zoom-out control. */
export const ZOOM_OUT_FACTOR = 1 + ZOOM_STEP;

/**
 * Position the crosshair readout so it stays inside the chart and away from
 * the point it describes.
 *
 * @param {{x: number, y: number}} point Crosshair position within the chart.
 * @param {{width: number, height: number}} chartSize Size of the chart element.
 * @param {{width: number, height: number}} readoutSize Size of the readout card.
 * @returns {{left: number, top: number}} Offsets to place the card at.
 */
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
