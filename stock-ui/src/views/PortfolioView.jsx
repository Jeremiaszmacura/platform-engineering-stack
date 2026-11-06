/** Portfolio view built from demo data (there is no portfolio service). */

import React from 'react';

import { DEMO_HOLDINGS } from '../mocks/demoData';
import { formatPercent, formatPrice } from '../lib/format';
import { directionOf } from '../lib/series';

/** Return the holding with its market value and return. */
function valuePosition(holding) {
  const value = holding.shares * holding.lastPrice;
  const cost = holding.shares * holding.averageCost;
  return { ...holding, value, gain: value - cost, gainPercent: ((value - cost) / cost) * 100 };
}

/** Render the portfolio view. */
export function PortfolioView() {
  const positions = DEMO_HOLDINGS.map(valuePosition);
  const total = positions.reduce((sum, position) => sum + position.value, 0);
  const invested = positions.reduce((sum, position) => sum + position.shares * position.averageCost, 0);
  const totalGainPercent = ((total - invested) / invested) * 100;

  return (
    <main className="page">
      <section className="page__intro">
        <div>
          <h1 className="page__title">Portfolio</h1>
          <div className="instrument__tags">
            <span className="badge badge--demo">Demo data</span>
          </div>
        </div>
        <p className="page__lede">
          Sample positions, held in the browser. Nothing on this page is fetched, priced live or saved — only the
          Markets view talks to a backend.
        </p>
      </section>

      <div className="holdings-grid">
        <section className="card">
          <div className="card__head">
            <h2 className="card__title">Holdings</h2>
            <span className="badge">{positions.length} positions</span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Instrument</th>
                  <th scope="col">Shares</th>
                  <th scope="col">Avg cost</th>
                  <th scope="col">Last</th>
                  <th scope="col">Value</th>
                  <th scope="col">Return</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((position) => (
                  <tr key={position.symbol}>
                    <td>
                      <span className="table__symbol">{position.symbol}</span>
                      <span className="table__name">{position.name}</span>
                    </td>
                    <td>{position.shares}</td>
                    <td>{formatPrice(position.averageCost)}</td>
                    <td>{formatPrice(position.lastPrice)}</td>
                    <td>{formatPrice(position.value)}</td>
                    <td className={directionOf(position.gain)}>{formatPercent(position.gainPercent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="holdings-side">
          <section className="card headline-figure">
            <div className="label">Total value</div>
            <div className="headline-figure__value">{formatPrice(total, 'USD')}</div>
            <div className={`stat__note ${directionOf(total - invested)}`}>
              {formatPercent(totalGainPercent)} against {formatPrice(invested, 'USD')} invested
            </div>
          </section>

          <section className="card">
            <div className="card__head">
              <h2 className="card__title">Allocation</h2>
            </div>
            <div className="allocation">
              {positions.map((position) => (
                <div className="allocation__row" key={position.symbol}>
                  <div className="allocation__head">
                    <span className="data">{position.symbol}</span>
                    <span className="allocation__weight">{((position.value / total) * 100).toFixed(1)}%</span>
                  </div>
                  <div className="allocation__track">
                    <div className="allocation__fill" style={{ width: `${(position.value / total) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
