/**
 * The four figures that describe the charted period.
 *
 * All of them are measured from the bars already on screen, so nothing here
 * costs an extra request and nothing can disagree with the chart.
 */

import React from 'react';

import { formatPercent, formatPrice, formatVolume } from '../lib/format';
import { directionOf } from '../lib/series';

/**
 * Render the period statistics.
 *
 * @param {Object} props Component props.
 * @param {Object} props.summary Period statistics from {@link summarize}.
 * @param {?string} props.currency Currency the prices are quoted in.
 * @param {Object} props.range Selected range.
 * @returns {JSX.Element} The statistics row.
 */
export function StatStrip({ summary, currency, range }) {
  const stats = [
    {
      label: `${range.label} change`,
      value: formatPercent(summary.changePercent),
      note: `${summary.sessionCount} trading sessions`,
      tone: directionOf(summary.change),
    },
    { label: 'Period high', value: formatPrice(summary.periodHigh, currency), note: 'Highest price reached' },
    { label: 'Period low', value: formatPrice(summary.periodLow, currency), note: 'Lowest price reached' },
    { label: 'Average volume', value: formatVolume(summary.averageVolume), note: 'Shares traded per session' },
  ];

  return (
    <div className="stats">
      {stats.map((stat) => (
        <div className="stat" key={stat.label}>
          <div className="label">{stat.label}</div>
          <div className={`stat__value ${stat.tone || ''}`}>{stat.value}</div>
          <div className="stat__note">{stat.note}</div>
        </div>
      ))}
    </div>
  );
}
