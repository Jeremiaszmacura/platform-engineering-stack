/**
 * The backends this tool can drive, and the endpoints it offers for each.
 *
 * stock-app is a real data service, so its endpoints are the ones worth
 * driving: repeating a window shows the cache-aside path in Grafana, and a
 * window it has never synced shows the provider path.
 */

/**
 * Format the date a given number of days before now as YYYY-MM-DD.
 *
 * @param {number} days How far back to go.
 * @returns {string} An ISO session date.
 */
const isoDaysAgo = (days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

/**
 * A closed window a week in the past: never future-dated, so stock-app accepts
 * it, and long enough to hold trading sessions on any exchange calendar.
 */
export const DEFAULT_RANGE = { start: isoDaysAgo(37), end: isoDaysAgo(7) };

/** Backends the tool can target, in the order the navigation offers them. */
export const APPS = [
  { id: 'stock-app', label: 'Stock App', note: 'FastAPI + TimescaleDB', baseUrl: 'http://stock.localhost' },
  { id: 'go-app', label: 'Go App', note: 'Gin', baseUrl: 'http://go.localhost' },
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
  'go-app': [
    { path: '/', name: 'Home', method: 'GET', description: 'Get welcome message' },
    { path: '/health', name: 'Health check', method: 'GET', description: 'Check app health' },
    { path: '/error', name: 'Error', method: 'GET', description: 'Simulate a server error (500)' },
    { path: '/redirect', name: 'Redirect', method: 'GET', description: 'Redirect to health' },
    { path: '/metrics', name: 'Metrics', method: 'GET', description: 'Prometheus metrics' },
  ],
};

/**
 * Find a backend by id.
 *
 * @param {string} appId Id of the backend.
 * @returns {Object} The backend.
 */
export function appById(appId) {
  return APPS.find((app) => app.id === appId);
}

/**
 * Fill in the symbol and the session-date window the endpoint asks for.
 *
 * Endpoints that need neither are returned unchanged.
 *
 * @param {Object} endpoint The chosen endpoint.
 * @param {{symbol: string, start: string, end: string}} params Values for its placeholders.
 * @returns {string} The path to request.
 */
export function resolvePath(endpoint, params) {
  const path = endpoint.needsSymbol
    ? endpoint.path.replace(':symbol', encodeURIComponent(params.symbol))
    : endpoint.path;

  if (!endpoint.needsRange) {
    return path;
  }
  return `${path}?start=${encodeURIComponent(params.start)}&end=${encodeURIComponent(params.end)}`;
}

/**
 * Build the absolute URL a run will call.
 *
 * @param {Object} app The targeted backend.
 * @param {Object} endpoint The chosen endpoint.
 * @param {{symbol: string, start: string, end: string}} params Values for its placeholders.
 * @returns {string} The URL to request.
 */
export function buildUrl(app, endpoint, params) {
  return `${app.baseUrl}${resolvePath(endpoint, params)}`;
}
