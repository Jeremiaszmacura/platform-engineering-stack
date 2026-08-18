import { ZOOM_IN_FACTOR, ZOOM_OUT_FACTOR, readoutPosition, toSessionDate, zoomedRange } from './chart';

describe('toSessionDate', () => {
  it('passes a date string through', () => {
    expect(toSessionDate('2026-07-12')).toBe('2026-07-12');
  });

  it('pads a business day back into the key bars are indexed under', () => {
    expect(toSessionDate({ year: 2026, month: 7, day: 2 })).toBe('2026-07-02');
  });

  it('has no session date for a time that is not a calendar date', () => {
    expect(toSessionDate(1750000000)).toBeNull();
  });
});

describe('zoomedRange', () => {
  it('narrows the window around its middle when zooming in', () => {
    expect(zoomedRange({ from: 0, to: 100 }, ZOOM_IN_FACTOR)).toEqual({ from: 10, to: 90 });
  });

  it('widens the window around its middle when zooming out', () => {
    expect(zoomedRange({ from: 0, to: 100 }, ZOOM_OUT_FACTOR)).toEqual({ from: -10, to: 110 });
  });

  it('keeps a few bars on screen however far in it is zoomed', () => {
    expect(zoomedRange({ from: 10, to: 12 }, ZOOM_IN_FACTOR)).toEqual({ from: 8.5, to: 13.5 });
  });
});

describe('readoutPosition', () => {
  const chart = { width: 800, height: 400 };
  const readout = { width: 200, height: 130 };

  it('sits to the right of the crosshair with room to spare', () => {
    expect(readoutPosition({ x: 100, y: 200 }, chart, readout)).toEqual({ left: 116, top: 135 });
  });

  it('flips to the left when it would overflow the right edge', () => {
    expect(readoutPosition({ x: 780, y: 200 }, chart, readout).left).toBe(564);
  });

  it('stays inside the top edge when the crosshair is near it', () => {
    expect(readoutPosition({ x: 100, y: 0 }, chart, readout).top).toBe(8);
  });

  it('stays inside the bottom edge when the crosshair is near it', () => {
    expect(readoutPosition({ x: 100, y: 400 }, chart, readout).top).toBe(262);
  });
});
