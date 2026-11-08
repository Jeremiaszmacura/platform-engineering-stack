/** Backends and their endpoints. */

/** Return the date `days` ago as YYYY-MM-DD. */
const isoDaysAgo = (days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

/** A past 30-day window: never in the future and always holds trading sessions. */
export const DEFAULT_RANGE = { start: isoDaysAgo(37), end: isoDaysAgo(7) };

/** Backends the tool can target, in the order the navigation offers them. */
export const APPS = [
  { id: 'stock-app', label: 'Stock App', note: 'FastAPI + TimescaleDB', baseUrl: 'http://stock.localhost' },
];

/** Endpoints offered per backend, keyed by app id. */
export const ENDPOINTS = {
  'stock-app': [
    { path: '/', name: 'Home', method: 'GET', description: 'Identify the service' },
    { path: '/health', name: 'Health check', method: 'GET', description: 'Database reachability' },
    { path: '/metrics', name: 'Metrics', method: 'GET', description: 'Prometheus metrics' },
    {
      path: '/api/v1/instruments',
      name: 'List instruments',
      method: 'GET',
      description: 'Symbols held locally, with their synced window',
    },
    {
      path: '/api/v1/instruments/:symbol/bars',
      name: 'Get bars',
      method: 'GET',
      description: 'Daily OHLCV bars, from cache or the provider',
      needsSymbol: true,
      needsRange: true,
    },
    {
      path: '/api/v1/instruments/:symbol/summary',
      name: 'Get summary',
      method: 'GET',
      description: 'Period high, low, first and last close',
      needsSymbol: true,
      needsRange: true,
    },
  ],
};

/** Return the backend with this id. */
export function appById(appId) {
  return APPS.find((app) => app.id === appId);
}

/** Return the endpoint path with its symbol and start/end filled in, if it needs them. */
export function resolvePath(endpoint, params) {
  const path = endpoint.needsSymbol
    ? endpoint.path.replace(':symbol', encodeURIComponent(params.symbol))
    : endpoint.path;

  if (!endpoint.needsRange) {
    return path;
  }
  return `${path}?start=${encodeURIComponent(params.start)}&end=${encodeURIComponent(params.end)}`;
}

/** Return the absolute URL a run will call. */
export function buildUrl(app, endpoint, params) {
  return `${app.baseUrl}${resolvePath(endpoint, params)}`;
}
