/** Price chart and crosshair readout; the only module that uses lightweight-charts. */

import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
} from 'lightweight-charts';
import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';

import { PALETTES } from '../lib/palette';
import { ZOOM_IN_FACTOR, ZOOM_OUT_FACTOR, readoutPosition, toSessionDate, zoomedRange } from '../lib/chart';
import { formatPrice, formatSessionDate, formatVolume } from '../lib/format';
import { directionOf, indexBarsByDate, toCandlePoints, toLinePoints } from '../lib/series';

/** Chart shapes the filter offers. */
export const CHART_TYPES = { line: 'line', candles: 'candles' };

/** Fixed readout size used for positioning (avoids measuring on every pointer move). */
const READOUT_SIZE = { width: 208, height: 136 };

/** Return chart options for a theme palette. */
function chartOptions(palette) {
  const crosshairLine = {
    color: palette.border,
    style: LineStyle.Dashed,
    labelBackgroundColor: palette.accent,
  };
  return {
    layout: {
      background: { type: ColorType.Solid, color: palette.surface },
      textColor: palette.muted,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      attributionLogo: false,
    },
    grid: { vertLines: { color: palette.grid }, horzLines: { color: palette.grid } },
    rightPriceScale: { borderVisible: false },
    timeScale: { borderVisible: false, fixLeftEdge: true, fixRightEdge: true },
    crosshair: { mode: CrosshairMode.Magnet, vertLine: crosshairLine, horzLine: crosshairLine },
  };
}

/** Add a line, area or candle series for chartType, filled with bars, and return it. */
function addSeries(chart, chartType, bars, palette) {
  if (chartType === CHART_TYPES.candles) {
    const series = chart.addSeries(CandlestickSeries, {
      upColor: palette.up,
      downColor: palette.down,
      wickUpColor: palette.up,
      wickDownColor: palette.down,
      borderVisible: false,
      priceLineVisible: false,
    });
    series.setData(toCandlePoints(bars));
    return series;
  }
  const series = chart.addSeries(AreaSeries, {
    lineColor: palette.accent,
    topColor: palette.accentFill,
    bottomColor: 'rgba(0, 0, 0, 0)',
    lineWidth: 2,
    priceLineVisible: false,
  });
  series.setData(toLinePoints(bars));
  return series;
}

/** Render the chart; ref receives the zoom controls used by the toolbar. */
export const PriceChart = forwardRef(function PriceChart({ bars, chartType, currency, theme }, ref) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const [hovered, setHovered] = useState(null);

  const barsByDate = useMemo(() => indexBarsByDate(bars), [bars]);

  useEffect(() => {
    const chart = createChart(containerRef.current, { autoSize: true });
    chartRef.current = chart;
    return () => {
      chartRef.current = null;
      chart.remove();
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) {
      return undefined;
    }
    const palette = PALETTES[theme];
    chart.applyOptions(chartOptions(palette));
    const series = addSeries(chart, chartType, bars, palette);
    chart.timeScale().fitContent();

    const showReadout = (event) => {
      const bar = event.point && event.time ? barsByDate.get(toSessionDate(event.time)) : undefined;
      if (!bar) {
        setHovered(null);
        return;
      }
      const container = containerRef.current;
      const anchor = { x: event.point.x, y: series.priceToCoordinate(bar.close) ?? event.point.y };
      const size = { width: container.clientWidth, height: container.clientHeight };
      setHovered({ bar, position: readoutPosition(anchor, size, READOUT_SIZE) });
    };

    chart.subscribeCrosshairMove(showReadout);
    return () => {
      // Already disposed on unmount.
      if (!chartRef.current) {
        return;
      }
      chart.unsubscribeCrosshairMove(showReadout);
      chart.removeSeries(series);
      setHovered(null);
    };
  }, [bars, barsByDate, chartType, theme]);

  useImperativeHandle(ref, () => {
    const rescale = (factor) => {
      const timeScale = chartRef.current?.timeScale();
      const range = timeScale?.getVisibleLogicalRange();
      if (range) {
        timeScale.setVisibleLogicalRange(zoomedRange(range, factor));
      }
    };
    return {
      zoomIn: () => rescale(ZOOM_IN_FACTOR),
      zoomOut: () => rescale(ZOOM_OUT_FACTOR),
      fit: () => chartRef.current?.timeScale().fitContent(),
    };
  }, []);

  return (
    <div className="chart">
      <div className="chart__canvas" ref={containerRef} />
      {hovered && <Readout bar={hovered.bar} position={hovered.position} currency={currency} />}
    </div>
  );
});

/** Card showing the hovered session's prices. */
function Readout({ bar, position, currency }) {
  const cells = [
    ['Open', formatPrice(bar.open)],
    ['High', formatPrice(bar.high)],
    ['Low', formatPrice(bar.low)],
    ['Vol', formatVolume(bar.volume)],
  ];
  return (
    <div className="readout" style={{ left: `${position.left}px`, top: `${position.top}px` }} role="status">
      <div className="readout__date">{formatSessionDate(bar.date)}</div>
      <div className={`readout__price ${directionOf(bar.close - bar.open)}`}>{formatPrice(bar.close, currency)}</div>
      <div className="readout__grid">
        {cells.map(([key, value]) => (
          <div className="readout__cell" key={key}>
            <span className="readout__key">{key}</span>
            <span>{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
