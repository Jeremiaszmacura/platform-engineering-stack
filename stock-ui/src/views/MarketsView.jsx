/**
 * The one view backed by a real service.
 *
 * It holds the two filters — chart shape and time range — turns the selected
 * symbol and range into a request to stock-app, and renders whichever of the
 * five states that request is in.
 */

import React, { useMemo, useState } from 'react';

import { CHART_TYPES, PriceChart } from '../components/PriceChart';
import { ChartToolbar } from '../components/ChartToolbar';
import { IndicatorPanels } from '../components/IndicatorPanels';
import { InstrumentHeader } from '../components/InstrumentHeader';
import { StatStrip } from '../components/StatStrip';
import { LOAD_STATUS, usePriceHistory } from '../hooks/usePriceHistory';
import { DEFAULT_RANGE_ID, findRange, toDateWindow } from '../lib/ranges';
import { formatSessionDate } from '../lib/format';
import { summarize } from '../lib/series';

/** Tickers offered on the empty state, as a way in for a first-time reader. */
const STARTER_SYMBOLS = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL'];

/**
 * Render the markets view.
 *
 * @param {Object} props Component props.
 * @param {?string} props.symbol Ticker to chart, or null when none is chosen.
 * @param {function(string): void} props.onSelectSymbol Called with a ticker to chart.
 * @param {Array<Object>} props.instruments Instruments stock-app holds.
 * @param {function(Object): void} props.onHistoryLoaded Called after a successful load.
 * @param {string} props.theme Active colour scheme.
 * @returns {JSX.Element} The view.
 */
export function MarketsView({ symbol, onSelectSymbol, instruments, onHistoryLoaded, theme }) {
  const [rangeId, setRangeId] = useState(DEFAULT_RANGE_ID);
  const [chartType, setChartType] = useState(CHART_TYPES.line);
  const [zoom, setZoom] = useState(null);

  const { status, history, error } = usePriceHistory(symbol, rangeId, onHistoryLoaded);
  const range = findRange(rangeId);
  // Held stable across renders: the chart takes the bars as an effect
  // dependency, and a fresh array each render would rebuild its series.
  const bars = useMemo(() => history?.bars ?? [], [history]);
  const summary = useMemo(() => summarize(bars), [bars]);
  const instrument = instruments.find((candidate) => candidate.symbol === history?.symbol);

  return (
    <main className="page">
      {summary ? (
        <InstrumentHeader history={history} instrument={instrument} summary={summary} range={range} />
      ) : (
        <section className="page__intro">
          <div>
            <h1 className="page__title">
              Daily bars,
              <br />
              one company at a time.
            </h1>
          </div>
          <p className="page__lede">
            Search a company above to chart its daily opens, highs, lows and closes. Prices come from stock-app, which
            answers from its own store and only calls the market data provider for a window it has never seen.
          </p>
        </section>
      )}

      {summary && <StatStrip summary={summary} currency={history.currency} range={range} />}

      <section className="card chart-card">
        <ChartToolbar
          chartType={chartType}
          onSelectChartType={setChartType}
          rangeId={rangeId}
          onSelectRange={setRangeId}
          zoom={zoom}
        />
        {bars.length > 0 ? (
          <PriceChart ref={setZoom} bars={bars} chartType={chartType} currency={history.currency} theme={theme} />
        ) : (
          <div className="chart">
            <ChartState
              status={status}
              symbol={symbol}
              error={error}
              rangeId={rangeId}
              onSelectSymbol={onSelectSymbol}
            />
          </div>
        )}
      </section>

      {summary && <IndicatorPanels symbol={history.symbol} />}
    </main>
  );
}

/**
 * Render whatever stands in for the chart when there is nothing to draw.
 *
 * @param {Object} props Component props.
 * @param {string} props.status Current load status.
 * @param {?string} props.symbol Ticker being loaded, when there is one.
 * @param {?Error} props.error Failure to explain, when the load failed.
 * @param {string} props.rangeId Selected range id.
 * @param {function(string): void} props.onSelectSymbol Called with a starter ticker.
 * @returns {JSX.Element} The state message.
 */
function ChartState({ status, symbol, error, rangeId, onSelectSymbol }) {
  if (status === LOAD_STATUS.loading) {
    const window = toDateWindow(rangeId);
    return (
      <div className="chart__state">
        <div className="spinner" />
        <p className="chart__state-body">
          Loading {symbol} from {formatSessionDate(window.start)}. A window stock-app has not synced yet is fetched from
          the provider, which takes a few seconds.
        </p>
      </div>
    );
  }

  if (status === LOAD_STATUS.failed) {
    return (
      <div className="chart__state">
        <p className="chart__state-title">Could not load {symbol}</p>
        <p className="chart__state-body">{error.message}</p>
      </div>
    );
  }

  if (status === LOAD_STATUS.loaded) {
    const window = toDateWindow(rangeId);
    return (
      <div className="chart__state">
        <p className="chart__state-title">No trading sessions in this range</p>
        <p className="chart__state-body">
          {symbol} has no bars between {formatSessionDate(window.start)} and {formatSessionDate(window.end)}. Pick a
          longer range.
        </p>
      </div>
    );
  }

  return (
    <div className="chart__state">
      <p className="chart__state-title">Search a company to chart it</p>
      <p className="chart__state-body">Use the search box above, or start with one of these.</p>
      <div className="chart__starters">
        {STARTER_SYMBOLS.map((starter) => (
          <button type="button" className="pill" key={starter} onClick={() => onSelectSymbol(starter)}>
            {starter}
          </button>
        ))}
      </div>
    </div>
  );
}
