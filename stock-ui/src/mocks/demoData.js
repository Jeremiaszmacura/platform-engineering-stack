/** Demo data for the parts with no backend (account, portfolio, watchlist). Nothing is fetched or stored. */

/** The signed-in identity the account chip shows. */
export const DEMO_ACCOUNT = {
  name: 'Sample User',
  role: 'Demo account',
  initials: 'SU',
};

/** Positions the portfolio view lists. Values are fixed, not marked to market. */
export const DEMO_HOLDINGS = [
  { symbol: 'AAPL', name: 'Apple Inc.', shares: 120, averageCost: 168.4, lastPrice: 212.44 },
  { symbol: 'MSFT', name: 'Microsoft Corporation', shares: 65, averageCost: 372.1, lastPrice: 431.28 },
  { symbol: 'NVDA', name: 'NVIDIA Corporation', shares: 40, averageCost: 96.75, lastPrice: 118.32 },
  { symbol: 'KO', name: 'The Coca-Cola Company', shares: 300, averageCost: 61.2, lastPrice: 58.94 },
  { symbol: 'ASML', name: 'ASML Holding N.V.', shares: 15, averageCost: 812.5, lastPrice: 745.1 },
];

/** Instruments the watchlist view follows, with a shape for their sparkline. */
export const DEMO_WATCHLIST = [
  { symbol: 'AMZN', name: 'Amazon.com, Inc.', lastPrice: 187.22, changePercent: 1.42, trend: [171, 174, 173, 179, 182, 181, 187] },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', lastPrice: 164.8, changePercent: -0.63, trend: [169, 168, 170, 167, 165, 166, 164] },
  { symbol: 'TSLA', name: 'Tesla, Inc.', lastPrice: 241.05, changePercent: 3.18, trend: [214, 219, 217, 226, 231, 236, 241] },
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.', lastPrice: 208.44, changePercent: 0.21, trend: [204, 205, 207, 206, 208, 207, 208] },
  { symbol: 'SHEL', name: 'Shell plc', lastPrice: 71.16, changePercent: -1.05, trend: [75, 74, 74, 73, 72, 72, 71] },
];
