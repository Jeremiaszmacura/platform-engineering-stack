/** Filters above the chart: what shape to draw, and over how long. */

import React from 'react';

import { CHART_TYPES } from './PriceChart';
import { FitIcon, MinusIcon, PlusIcon } from './Icons';
import { RANGES } from '../lib/ranges';

const CHART_TYPE_LABELS = [
  { id: CHART_TYPES.line, label: 'Line' },
  { id: CHART_TYPES.candles, label: 'Candles' },
];

/** Chart type and range filters, plus zoom controls (zoom is null until the chart exists). */
export function ChartToolbar({ chartType, onSelectChartType, rangeId, onSelectRange, zoom }) {
  return (
    <div className="toolbar">
      <div className="pill-group" role="group" aria-label="Chart type">
        {CHART_TYPE_LABELS.map((type) => (
          <button
            type="button"
            className="pill"
            key={type.id}
            aria-pressed={type.id === chartType}
            onClick={() => onSelectChartType(type.id)}
          >
            {type.label}
          </button>
        ))}
      </div>

      <div className="pill-group" role="group" aria-label="Time range">
        {RANGES.map((range) => (
          <button
            type="button"
            className="pill"
            key={range.id}
            aria-pressed={range.id === rangeId}
            aria-label={`Last ${range.description}`}
            onClick={() => onSelectRange(range.id)}
          >
            {range.label}
          </button>
        ))}
      </div>

      <div className="toolbar__zoom">
        <button type="button" className="icon-button" aria-label="Zoom out" disabled={!zoom} onClick={zoom?.zoomOut}>
          <MinusIcon />
        </button>
        <button type="button" className="icon-button" aria-label="Zoom in" disabled={!zoom} onClick={zoom?.zoomIn}>
          <PlusIcon />
        </button>
        <button type="button" className="icon-button" aria-label="Fit the range" disabled={!zoom} onClick={zoom?.fit}>
          <FitIcon />
        </button>
      </div>
    </div>
  );
}
