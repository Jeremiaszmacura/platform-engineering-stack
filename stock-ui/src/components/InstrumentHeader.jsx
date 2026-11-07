import React from 'react';

import { formatChange, formatPercent, formatPrice, formatSessionDate } from '../lib/format';
import { directionOf } from '../lib/series';

/** Company name, last close and change over the selected range (sign shown, not only colour). */
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
