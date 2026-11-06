import React from 'react';

/** Total, answered, failed and average time of the last run. */
export function RunStats({ summary }) {
  // Zero counts stay uncoloured.
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
