import React from 'react';

import { EndpointPicker } from './EndpointPicker';
import { MAX_REQUESTS, MIN_REQUESTS, clampCount } from '../lib/run';

/** Request form: endpoint, its parameters, request count and the resulting URL. */
export function RequestForm({
  app,
  endpoints,
  endpoint,
  onSelectEndpoint,
  params,
  onChangeParam,
  targetUrl,
  isRunning,
  hasResults,
  onRun,
  onClear,
}) {
  const handleSubmit = (event) => {
    event.preventDefault();
    onRun();
  };

  return (
    <form className="card" onSubmit={handleSubmit}>
      <div className="card__head">
        <h2 className="card__title">Request</h2>
        <span className="badge">{app.note}</span>
      </div>

      <div className="card__body">
        <EndpointPicker endpoints={endpoints} selectedName={endpoint.name} onSelect={onSelectEndpoint} />

        {endpoint.needsSymbol && (
          <label className="field">
            <span className="label">Ticker symbol</span>
            <input
              type="text"
              className="field__control data"
              value={params.symbol}
              maxLength="16"
              onChange={(event) => onChangeParam('symbol', event.target.value.toUpperCase())}
            />
            <span className="field__note">Letters, digits, dot and dash, e.g. AAPL</span>
          </label>
        )}

        {endpoint.needsRange && (
          <div className="field">
            <span className="label">Session date range</span>
            <div className="field__row">
              <input
                type="date"
                className="field__control data"
                aria-label="First session date"
                value={params.start}
                onChange={(event) => onChangeParam('start', event.target.value)}
              />
              <input
                type="date"
                className="field__control data"
                aria-label="Last session date"
                value={params.end}
                onChange={(event) => onChangeParam('end', event.target.value)}
              />
            </div>
            <span className="field__note">
              Inclusive, both required, not in the future. Repeating a window is a cache hit.
            </span>
          </div>
        )}

        <label className="field">
          <span className="label">Requests</span>
          <input
            type="number"
            className="field__control data"
            value={params.count}
            min={MIN_REQUESTS}
            max={MAX_REQUESTS}
            onChange={(event) => onChangeParam('count', clampCount(event.target.value))}
          />
          <span className="field__note">
            Sent concurrently, so the burst shows up as a spike on a Grafana dashboard.
          </span>
        </label>

        <div className="target">
          <span className="label">Target</span>
          <p className="target__url data">{targetUrl}</p>
        </div>

        <div className="run">
          <button type="submit" className="button button--primary" disabled={isRunning}>
            {isRunning ? (
              <>
                <span className="spinner" />
                Sending
              </>
            ) : (
              `Send ${params.count} request${params.count > 1 ? 's' : ''}`
            )}
          </button>

          {hasResults && (
            <button type="button" className="button button--ghost" onClick={onClear}>
              Clear
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
