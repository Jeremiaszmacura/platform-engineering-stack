/**
 * The price chart, and the readout that follows the crosshair.
 *
 * This is the only module that touches the charting library. It owns a canvas
 * the React tree does not manage, so every subscription and series it creates
 * is torn down again by the effect that created it.
 */

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

/**
 * Size the readout is assumed to have while it is being positioned.
 *
 * Measuring the card would mean rendering it once to learn its size and again
 * to place it, on every pointer move. Its content is fixed, so a constant is
 * both stable and cheaper.
 */
const READOUT_SIZE = { width: 208, height: 136 };

/**
 * Build the chart-wide options for a theme.
 *
 * @param {Object} palette Colours for the active theme.
 * @returns {Object} Options to apply to the chart.
 */
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

/**
 * Add the series for the selected chart shape and fill it with the bars.
 *
 * @param {Object} chart Chart to add the series to.
 * @param {string} chartType One of {@link CHART_TYPES}.
 * @param {Array<Object>} bars Bars in ascending session-date order.
 * @param {Object} palette Colours for the active theme.
 * @returns {Object} The created series.
 */
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

/**
 * Render the chart and its crosshair readout.
 *
 * @param {Object} props Component props.
 * @param {Array<Object>} props.bars Bars in ascending session-date order.
 * @param {string} props.chartType One of {@link CHART_TYPES}.
 * @param {?string} props.currency Currency the prices are quoted in.
 * @param {string} props.theme Active colour scheme.
 * @param {React.Ref} ref Receives the zoom controls the toolbar drives.
 * @returns {JSX.Element} The chart.
 */
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
      // On unmount the effect above has already disposed the chart, and the
      // series and subscription went with it; touching them would throw.
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

/**
 * The card that reads out the hovered session.
 *
 * @param {Object} props Component props.
 * @param {Object} props.bar Bar under the crosshair.
 * @param {{left: number, top: number}} props.position Where to place the card.
 * @param {?string} props.currency Currency the prices are quoted in.
 * @returns {JSX.Element} The readout.
 */
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
