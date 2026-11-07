import { directionOf, indexBarsByDate, summarize, toCandlePoints, toLinePoints } from './series';

const bar = (date, open, high, low, close, volume) => ({
  date,
  open,
  high,
  low,
  close,
  adjClose: close,
  volume,
});

const BARS = [
  bar('2026-07-01', 100, 104, 99, 102, 1000),
  bar('2026-07-02', 102, 110, 101, 108, 3000),
  bar('2026-07-03', 108, 109, 96, 99, 2000),
];

describe('toLinePoints', () => {
  it('charts the closing price of each session', () => {
    expect(toLinePoints(BARS)).toEqual([
      { time: '2026-07-01', value: 102 },
      { time: '2026-07-02', value: 108 },
      { time: '2026-07-03', value: 99 },
    ]);
  });
});

describe('toCandlePoints', () => {
  it('keeps the four prices a candle is drawn from and drops the rest', () => {
    expect(toCandlePoints(BARS)[1]).toEqual({ time: '2026-07-02', open: 102, high: 110, low: 101, close: 108 });
  });
});

describe('indexBarsByDate', () => {
  it('makes a whole bar reachable from its session date', () => {
    expect(indexBarsByDate(BARS).get('2026-07-03').volume).toBe(2000);
  });
});

describe('summarize', () => {
  it('measures the change close to close across the bars returned', () => {
    const summary = summarize(BARS);
    expect(summary.firstClose).toBe(102);
    expect(summary.lastClose).toBe(99);
    expect(summary.change).toBe(-3);
    expect(summary.changePercent).toBeCloseTo(-2.941, 3);
  });

  it('takes the extremes from the session highs and lows, not the closes', () => {
    const summary = summarize(BARS);
    expect(summary.periodHigh).toBe(110);
    expect(summary.periodLow).toBe(96);
  });

  it('averages the traded volume and counts the sessions', () => {
    const summary = summarize(BARS);
    expect(summary.averageVolume).toBe(2000);
    expect(summary.sessionCount).toBe(3);
  });

  it('reports no percentage rather than infinity when the period opens at zero', () => {
    expect(summarize([bar('2026-07-01', 0, 0, 0, 0, 0), bar('2026-07-02', 0, 1, 0, 1, 5)]).changePercent).toBeNull();
  });

  it('has nothing to summarize for a period without sessions', () => {
    expect(summarize([])).toBeNull();
  });
});

describe('directionOf', () => {
  it.each([
    [1.5, 'up'],
    [-0.2, 'down'],
    [0, 'flat'],
    [null, 'flat'],
    [undefined, 'flat'],
  ])('classifies %p as %s', (change, expected) => {
    expect(directionOf(change)).toBe(expected);
  });
});
