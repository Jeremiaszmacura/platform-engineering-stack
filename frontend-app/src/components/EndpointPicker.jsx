/** The list of endpoints the selected backend offers. */

import React from 'react';

/** Single-choice list of the backend's endpoints. */
export function EndpointPicker({ endpoints, selectedName, onSelect }) {
  return (
    <div className="field">
      <span className="label">Endpoint</span>
      <div className="endpoints" role="group" aria-label="Endpoint">
        {endpoints.map((endpoint) => (
          <button
            type="button"
            className="endpoint"
            key={endpoint.name}
            aria-pressed={endpoint.name === selectedName}
            onClick={() => onSelect(endpoint.name)}
          >
            <span className="endpoint__method data">{endpoint.method}</span>
            <span>
              <span className="endpoint__name">{endpoint.name}</span>
              <span className="endpoint__note">{endpoint.description}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
