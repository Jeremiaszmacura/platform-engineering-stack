/**
 * The only module that makes a request.
 *
 * Backends are called cross-origin on their own ingress hosts, with CORS
 * enabled at the ingress, so the browser exercises the same path a human with
 * curl does. Any status below 600 is an answer worth reporting — this is a
 * tester, and a 500 from go-app's `/error` is the point of that endpoint.
 */

import axios from 'axios';

/** How long one request may take before it is abandoned, in milliseconds. */
const TIMEOUT_MS = 60000;

/**
 * The path a response came from, when the browser followed a redirect to it.
 *
 * A 3xx never reaches this code: XHR follows redirects internally and hands
 * back only the final response, and neither `maxRedirects` (Node-only) nor
 * fetch's manual mode (opaque cross-origin) can change that. The one trace
 * left is the URL the answer came from — when it differs from the one asked
 * for, a redirect was followed.
 *
 * @param {string} requestedUrl URL the request was sent to.
 * @param {string} [finalUrl] URL the response came from, empty when unknown.
 * @returns {?string} Path and query landed on, or null if nothing was followed.
 */
function followedPath(requestedUrl, finalUrl) {
  if (!finalUrl || finalUrl === requestedUrl) {
    return null;
  }
  const { pathname, search } = new URL(finalUrl);
  return `${pathname}${search}`;
}

/**
 * Send one GET request and record how it went.
 *
 * Never rejects: a failure is a result like any other, so a burst always
 * reports one row per request sent.
 *
 * @param {string} url Absolute URL to request.
 * @returns {Promise<Object>} Status, body, duration in ms, the clock time, and
 *   the path a redirect was followed to, if any.
 */
export async function sendRequest(url) {
  const startedAt = Date.now();

  try {
    const response = await axios.get(url, {
      timeout: TIMEOUT_MS,
      validateStatus: (status) => status < 600,
    });
    return {
      status: response.status,
      statusText: response.statusText,
      data: response.data,
      // In the browser adapter `request` is the XMLHttpRequest that ran.
      followedTo: followedPath(url, response.request?.responseURL),
      responseTime: Date.now() - startedAt,
      timestamp: new Date().toLocaleTimeString(),
    };
  } catch (error) {
    return {
      status: error.response?.status ?? 'No response',
      statusText: error.response?.statusText || error.message,
      data: error.response?.data ?? error.message,
      followedTo: null,
      responseTime: Date.now() - startedAt,
      timestamp: new Date().toLocaleTimeString(),
    };
  }
}

/**
 * Send the same request several times at once.
 *
 * Concurrency is what makes the burst visible as a spike on a dashboard.
 *
 * @param {string} url Absolute URL to request.
 * @param {number} count How many requests to send.
 * @returns {Promise<Array<Object>>} One result per request, in the order sent.
 */
export function sendBurst(url, count) {
  return Promise.all(Array.from({ length: count }, () => sendRequest(url)));
}
