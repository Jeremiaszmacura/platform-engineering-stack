/**
 * The four figures that describe the last run.
 *
 * All of them are measured from the results already on screen, so nothing here
 * costs an extra request and nothing can disagree with the list below it.
 */

import React from 'react';

/**
 * Render the run statistics.
 *
 * @param {Object} props Component props.
 * @param {{total: number, successful: number, failed: number, averageResponseTime: number}} props.summary
 *   Figures from {@link summarize}.
 * @returns {JSX.Element} The statistics row.
 */
export function RunStats({ summary }) {
  // A count of zero is not worth colouring: green on "0 answered" and red on
  // "0 failed" both say the opposite of what the figure means.
  const stats = [
    { label: 'Requests', value: summary.total, note: 'Sent in this run' },
    {
      label: 'Answered',
      value: summary.successful,
      note: '2xx and 3xx responses',
      tone: summary.successful > 0 ? 'up' : '',
    },
    {
      label: 'Failed',
      value: summary.failed,
      note: '4xx, 5xx, or no response',
      tone: summary.failed > 0 ? 'down' : '',
    },
    { label: 'Average time', value: `${summary.averageResponseTime} ms`, note: 'Round trip per request' },
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
