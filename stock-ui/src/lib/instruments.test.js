import { isLoadableSymbol, matchInstruments, toSymbol } from './instruments';

const INSTRUMENTS = [
  { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NMS' },
  { symbol: 'ALC', name: 'Alcon Inc.', exchange: 'NYQ' },
  { symbol: 'MSFT', name: 'Microsoft Corporation', exchange: 'NMS' },
  { symbol: 'BRK-B', name: 'Berkshire Hathaway Inc.', exchange: 'NYQ' },
  { symbol: 'CRM', name: 'Salesforce, Inc.', exchange: 'NYQ' },
];

const symbolsFor = (query) => matchInstruments(INSTRUMENTS, query).map((instrument) => instrument.symbol);

describe('matchInstruments', () => {
  it('ranks an exact ticker above everything else', () => {
    expect(symbolsFor('alc')[0]).toBe('ALC');
  });

  it('ranks ticker prefixes above the companies that only match by name', () => {
    expect(symbolsFor('a').slice(0, 2)).toEqual(['AAPL', 'ALC']);
  });

  it('finds a company by its name', () => {
    expect(symbolsFor('microsoft')).toEqual(['MSFT']);
  });

  it('matches a name in the middle, so "force" finds Salesforce', () => {
    expect(symbolsFor('force')).toEqual(['CRM']);
  });

  it('ignores case and surrounding blanks', () => {
    expect(symbolsFor('  BeRkShIrE ')).toEqual(['BRK-B']);
  });

  it('offers the head of the list before anything is typed', () => {
    expect(matchInstruments(INSTRUMENTS, '', 2)).toHaveLength(2);
  });

  it('matches nothing when nothing matches', () => {
    expect(symbolsFor('zzz')).toEqual([]);
  });

  it('never returns more than the limit', () => {
    expect(matchInstruments(INSTRUMENTS, 'a', 1)).toHaveLength(1);
  });
});

describe('isLoadableSymbol', () => {
  it.each(['AAPL', 'brk-b', 'BRK.B', 'A', '0700.HK'])('accepts %s', (query) => {
    expect(isLoadableSymbol(query)).toBe(true);
  });

  it.each(['', '   ', 'apple inc', 'AAPL!', 'ABCDEFGHIJKLMNOPQ'])('rejects %p', (query) => {
    expect(isLoadableSymbol(query)).toBe(false);
  });
});

describe('toSymbol', () => {
  it('upper-cases and trims what was typed', () => {
    expect(toSymbol('  aapl ')).toBe('AAPL');
  });
});
