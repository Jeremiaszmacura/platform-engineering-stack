/** A shape-only trend line, small enough to sit inside a table row. */

import React from 'react';

/**
 * Project values onto the points of a polyline filling the given box.
 *
 * A flat series has no range to scale against, so it is drawn along the middle
 * rather than dividing by zero.
 *
 * @param {Array<number>} values Series to draw, oldest first.
 * @param {number} width Width of the box, in user units.
 * @param {number} height Height of the box, in user units.
 * @returns {string} Points attribute for an SVG polyline.
 */
export function toPolylinePoints(values, width, height) {
  const highest = Math.max(...values);
  const lowest = Math.min(...values);
  const span = highest - lowest;
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  return values
    .map((value, index) => {
      const y = span === 0 ? height / 2 : height - ((value - lowest) / span) * height;
      return `${(index * step).toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

/**
 * Render a sparkline for a series of values.
 *
 * @param {Object} props Component props.
 * @param {Array<number>} props.values Series to draw, oldest first.
 * @param {string} props.tone Direction class colouring the line.
 * @returns {JSX.Element} The sparkline.
 */
export function Sparkline({ values, tone }) {
  const width = 76;
  const height = 26;
  const inset = 2;
  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
      <polyline
        points={toPolylinePoints(values, width - inset * 2, height - inset * 2)}
        transform={`translate(${inset} ${inset})`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={tone}
      />
    </svg>
  );
}
