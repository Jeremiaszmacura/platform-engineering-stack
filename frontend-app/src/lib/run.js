/**
 * A run: how many requests it may send, and how its results are read.
 *
 * Everything here is a pure function of the results already collected, so the
 * figures on screen can never disagree with the list under them.
 */

/** Bounds on the size of a burst. One request is a probe; a hundred is a spike. */
export const MIN_REQUESTS = 1;
export const MAX_REQUESTS = 100;

/**
 * Hold a requested burst size inside the allowed bounds.
 *
 * @param {string|number} value Whatever the number field currently holds.
 * @returns {number} A burst size between {@link MIN_REQUESTS} and {@link MAX_REQUESTS}.
 */
export function clampCount(value) {
  const count = parseInt(value, 10);
  if (Number.isNaN(count)) {
    return MIN_REQUESTS;
  }
  return Math.max(MIN_REQUESTS, Math.min(MAX_REQUESTS, count));
}

/**
 * Classify a response by the colour it should be read in.
 *
 * A request that never got an answer is grouped with the server errors: in
 * both cases the backend failed to produce one. There is no case for a 3xx
 * status, because a browser never delivers one — it follows the redirect and
 * reports where it landed, which is what `followedTo` records.
 *
 * @param {Object} result One result from a run.
 * @returns {string} One of `ok`, `redirect`, `client`, `failed`.
 */
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

/**
 * Whether a response counts as a success for the run statistics.
 *
 * @param {Object} result One result from a run.
 * @returns {boolean} True for 2xx and 3xx responses.
 */
const isSuccessful = (result) => typeof result.status === 'number' && result.status < 400;

/**
 * Describe a run in the four figures shown above the results.
 *
 * @param {Array<Object>} results Results collected so far.
 * @returns {{total: number, successful: number, failed: number, averageResponseTime: number}} The figures.
 */
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
