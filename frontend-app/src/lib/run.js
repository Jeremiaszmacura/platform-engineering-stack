/** Bounds on the size of a burst. One request is a probe; a hundred is a spike. */
export const MIN_REQUESTS = 1;
export const MAX_REQUESTS = 100;

/** Clamp a burst size to MIN_REQUESTS..MAX_REQUESTS. */
export function clampCount(value) {
  const count = parseInt(value, 10);
  if (Number.isNaN(count)) {
    return MIN_REQUESTS;
  }
  return Math.max(MIN_REQUESTS, Math.min(MAX_REQUESTS, count));
}

/** Return ok, redirect, client or failed (no answer counts as failed; the browser never shows a 3xx). */
export function toneOf(result) {
  if (typeof result.status !== 'number' || result.status >= 500) {
    return 'failed';
  }
  if (result.status >= 400) {
    return 'client';
  }
  // A success that arrived from somewhere other than the URL asked for.
  return result.followedTo ? 'redirect' : 'ok';
}

/** True for 2xx and 3xx. */
const isSuccessful = (result) => typeof result.status === 'number' && result.status < 400;

/** Return total, successful, failed and average response time for a run. */
export function summarize(results) {
  if (results.length === 0) {
    return { total: 0, successful: 0, failed: 0, averageResponseTime: 0 };
  }

  const successful = results.filter(isSuccessful).length;
  const totalResponseTime = results.reduce((sum, result) => sum + result.responseTime, 0);

  return {
    total: results.length,
    successful,
    failed: results.length - successful,
    averageResponseTime: Math.round(totalResponseTime / results.length),
  };
}
