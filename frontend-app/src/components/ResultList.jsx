import React from 'react';

import { toneOf } from '../lib/run';

/** Return the body as text; /metrics is plain text, not JSON. */
function formatBody(data) {
  return typeof data === 'string' ? data : JSON.stringify(data, null, 2);
}

/** One row per response, in send order, or an empty/loading state. */
export function ResultList({ results, isRunning }) {
  if (isRunning) {
    return (
      <div className="card state">
        <span className="spinner" />
        <p className="state__body">Waiting for the backend to answer.</p>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="card state">
        <p className="state__title">Nothing sent yet</p>
        <p className="state__body">
          Choose an endpoint on the left and send a burst. Every response lands here, and the same traffic
          shows up on the Grafana dashboards.
        </p>
      </div>
    );
  }

  return (
    <ol className="results">
      {results.map((result, index) => (
        <li className={`result result--${toneOf(result)}`} key={index}>
          <div className="result__head">
            <span className="result__index data">#{index + 1}</span>
            <span className="result__status data">
              {result.status} {result.statusText}
            </span>
            {result.followedTo && <span className="result__followed data">followed to {result.followedTo}</span>}
            <span className="result__meta data">{result.responseTime} ms</span>
            <span className="result__time data">{result.timestamp}</span>
          </div>
          <pre className="result__body">{formatBody(result.data)}</pre>
        </li>
      ))}
    </ol>
  );
}
