/** Watchlist built from demo data; choosing a row opens it in Markets. */

import React from 'react';

import { DEMO_WATCHLIST } from '../mocks/demoData';
import { Sparkline } from '../components/Sparkline';
import { formatPercent, formatPrice } from '../lib/format';
import { directionOf } from '../lib/series';

/** Render the watchlist; onSelectSymbol receives the chosen ticker. */
export function WatchlistView({ onSelectSymbol }) {
  return (
    <main className="page">
      <section className="page__intro">
        <div>
          <h1 className="page__title">Watchlist</h1>
          <div className="instrument__tags">
            <span className="badge badge--demo">Demo data</span>
          </div>
        </div>
        <p className="page__lede">
          Sample quotes, held in the browser. Choosing a row charts that ticker in Markets, which is where the real
          prices come from.
        </p>
      </section>

      <section className="card">
        <div className="card__head">
          <h2 className="card__title">Following</h2>
          <span className="badge">{DEMO_WATCHLIST.length} instruments</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Instrument</th>
                <th scope="col">Last</th>
                <th scope="col">Change</th>
                <th scope="col">Trend</th>
                <th scope="col">
                  <span className="sr-only">Chart</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {DEMO_WATCHLIST.map((entry) => {
                const tone = directionOf(entry.changePercent);
                return (
                  <tr key={entry.symbol}>
                    <td>
                      <span className="table__symbol">{entry.symbol}</span>
                      <span className="table__name">{entry.name}</span>
                    </td>
                    <td>{formatPrice(entry.lastPrice)}</td>
                    <td className={tone}>{formatPercent(entry.changePercent)}</td>
                    <td>
                      <Sparkline values={entry.trend} tone={tone} />
                    </td>
                    <td>
                      <button type="button" className="pill" onClick={() => onSelectSymbol(entry.symbol)}>
                        Chart it
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
