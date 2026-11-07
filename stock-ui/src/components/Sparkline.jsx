/** A shape-only trend line, small enough to sit inside a table row. */

import React from 'react';

/** Return SVG polyline points for values in a width x height box (a flat series is drawn mid-height). */
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

/** Render a sparkline coloured by tone. */
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
