/**
 * What came back: one row per request, in the order they were sent.
 *
 * The row carries the response's tone on its left edge — the same coloured
 * rail stock-ui gives its crosshair readout — so a burst can be read as a
 * column of colour before any of the numbers are.
 */

import React from 'react';

import { toneOf } from '../lib/run';

/**
 * Render a response body as text.
 *
 * `/metrics` answers in Prometheus text format, not JSON; stringifying it
 * would turn the whole exposition into one escaped line.
 *
 * @param {*} data The parsed response body.
 * @returns {string} Text to show in the row.
 */
function formatBody(data) {
  return typeof data === 'string' ? data : JSON.stringify(data, null, 2);
}

/**
 * Render the results, or the state standing in for them.
 *
 * @param {Object} props Component props.
 * @param {Array<Object>} props.results Results of the last run.
 * @param {boolean} props.isRunning Whether a run is in flight.
 * @returns {JSX.Element} The list, or an empty or loading state.
 */
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
