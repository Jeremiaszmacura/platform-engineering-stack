import { formatChange, formatPercent, formatPrice, formatSessionDate, formatVolume } from './format';

describe('formatPrice', () => {
  it('always shows two decimals so a column of prices lines up', () => {
    expect(formatPrice(212.4)).toBe('212.40');
  });

  it('appends the currency when the instrument reports one', () => {
    expect(formatPrice(1234.5, 'USD')).toBe('1,234.50 USD');
  });

  it('shows a dash rather than a number that is not there', () => {
    expect(formatPrice(null)).toBe('—');
  });
});

describe('formatPercent', () => {
  it('carries the sign of a gain, which colour alone would not convey', () => {
    expect(formatPercent(4.816)).toBe('+4.82%');
  });

  it('carries the sign of a loss', () => {
    expect(formatPercent(-0.5)).toBe('-0.50%');
  });

  it('shows a dash when the change could not be measured', () => {
    expect(formatPercent(null)).toBe('—');
  });
});

describe('formatChange', () => {
  it('marks a fall with a minus sign', () => {
    expect(formatChange(-3.125)).toBe('−3.13');
  });

  it('marks a rise with a plus sign', () => {
    expect(formatChange(9.77)).toBe('+9.77');
  });
});

describe('formatVolume', () => {
  it.each([
    [412, '412'],
    [41200, '41.2K'],
    [41200000, '41.2M'],
    [4120000000, '4.1B'],
  ])('abbreviates %p as %s', (value, expected) => {
    expect(formatVolume(value)).toBe(expected);
  });
});

describe('formatSessionDate', () => {
  it('renders the calendar date in UTC, so it cannot shift by a timezone', () => {
    expect(formatSessionDate('2026-07-12')).toBe('12 Jul 2026');
  });

  it('shows a dash when there is no date', () => {
    expect(formatSessionDate(null)).toBe('—');
  });
});
