/** Placeholder analysis panels: no indicators are calculated yet, so they render as empty slots. */

import React from 'react';

/** Indicator slots reserved in each panel, in the order they are shown. */
export const INDICATOR_PANELS = [
  {
    id: 'technical',
    title: 'Price and chart analysis',
    caption: 'Measured from the bars in the selected range.',
    indicators: ['SMA 20', 'SMA 50', 'RSI 14', 'MACD', 'ATR 14', 'Volatility'],
  },
  {
    id: 'fundamental',
    title: 'Fundamental analysis',
    caption: 'Reported per company, independent of the selected range.',
    indicators: ['Market cap', 'P/E ratio', 'EPS', 'Dividend yield', 'Beta', 'Free float'],
  },
];

/** Render the placeholder panels for symbol. */
export function IndicatorPanels({ symbol }) {
  return (
    <div className="analysis-grid">
      {INDICATOR_PANELS.map((panel) => (
        <section className="card" key={panel.id} aria-label={`${panel.title} for ${symbol}`}>
          <div className="card__head">
            <h2 className="card__title">{panel.title}</h2>
            <span className="badge">Not calculated yet</span>
          </div>
          <div className="indicators">
            {panel.indicators.map((indicator) => (
              <div className="indicator" key={indicator}>
                <div className="label">{indicator}</div>
                <div className="indicator__value">—</div>
              </div>
            ))}
          </div>
          <p className="panel-note">{panel.caption} Reserved slots — no values are computed for them yet.</p>
        </section>
      ))}
    </div>
  );
}
