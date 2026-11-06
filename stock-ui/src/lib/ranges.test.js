import { MAX_RANGE_DAYS, RANGES, DEFAULT_RANGE_ID, findRange, toDateWindow } from './ranges';

describe('toDateWindow', () => {
  it('ends today and starts the range length before it', () => {
    expect(toDateWindow('1M', new Date('2026-08-01T09:15:00Z'))).toEqual({ start: '2026-07-02', end: '2026-08-01' });
  });

  it('derives both dates in UTC, so a late local evening cannot ask for tomorrow', () => {
    expect(toDateWindow('1W', new Date('2026-08-01T23:59:59Z'))).toEqual({ start: '2026-07-25', end: '2026-08-01' });
  });

  it('crosses a year boundary correctly', () => {
    expect(toDateWindow('1Y', new Date('2026-01-15T00:00:00Z'))).toEqual({ start: '2025-01-15', end: '2026-01-15' });
  });
});

describe('findRange', () => {
  it('returns the range carrying the id', () => {
    expect(findRange(DEFAULT_RANGE_ID).days).toBe(30);
  });

  it('rejects an unknown id rather than returning undefined', () => {
    expect(() => findRange('10Y')).toThrow('unknown range: 10Y');
  });
});

describe('RANGES', () => {
  it('stays inside the window length stock-app accepts', () => {
    RANGES.forEach((range) => expect(range.days).toBeLessThanOrEqual(MAX_RANGE_DAYS));
  });

  it('offers the default range', () => {
    expect(RANGES.map((range) => range.id)).toContain(DEFAULT_RANGE_ID);
  });
});
