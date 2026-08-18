/**
 * The headline for the charted company: who it is, what it last closed at, and
 * how far it moved across the selected range.
 *
 * The range change is the number the whole filter row exists to produce, so it
 * is set at the same size as the price and carries its sign as well as its
 * colour — colour alone would not survive a monochrome screen.
 */

import React from 'react';

import { formatChange, formatPercent, formatPrice, formatSessionDate } from '../lib/format';
import { directionOf } from '../lib/series';

/**
 * Render the instrument headline.
 *
 * @param {Object} props Component props.
 * @param {Object} props.history Price history answered by stock-app.
 * @param {?Object} props.instrument Matching entry from the instrument list, when known.
 * @param {Object} props.summary Period statistics from {@link summarize}.
 * @param {Object} props.range Selected range.
 * @returns {JSX.Element} The headline.
 */
export function InstrumentHeader({ history, instrument, summary, range }) {
  const direction = directionOf(summary.change);
  return (
    <section className="instrument">
      <div>
        <h1 className="instrument__name">{instrument?.name || history.symbol}</h1>
        <div className="instrument__tags">
          <span className="instrument__ticker">{history.symbol}</span>
          {instrument?.exchange && <span className="badge">{instrument.exchange}</span>}
          {history.currency && <span className="badge">{history.currency}</span>}
          <span className="badge">{history.source === 'cache' ? 'From store' : 'From provider'}</span>
        </div>
      </div>

      <div className="instrument__quote">
        <div>
          <div className="label">Last close</div>
          <div className="instrument__price">{formatPrice(summary.lastClose, history.currency)}</div>
        </div>
        <div>
          <div className="label">Change over {range.description}</div>
          <div className={`instrument__delta ${direction}`}>
            {formatPercent(summary.changePercent)}
            <span className="instrument__delta-note">
              {formatChange(summary.change)} since {formatSessionDate(summary.firstDate)}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
