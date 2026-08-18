/** The list of endpoints the selected backend offers. */

import React from 'react';

/**
 * Render the endpoints as a single-choice list.
 *
 * The path is not repeated on each row — the resolved URL under the form is
 * what actually gets called, and one of the two would always be the stale one.
 *
 * @param {Object} props Component props.
 * @param {Array<Object>} props.endpoints Endpoints to offer.
 * @param {string} props.selectedName Name of the chosen endpoint.
 * @param {function(string): void} props.onSelect Called with the chosen endpoint's name.
 * @returns {JSX.Element} The picker.
 */
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
