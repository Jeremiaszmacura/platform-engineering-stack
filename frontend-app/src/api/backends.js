/** Sends the requests. Any status below 600 is a result to show (go-app's /error is meant to 500). */

import axios from 'axios';

/** How long one request may take before it is abandoned, in milliseconds. */
const TIMEOUT_MS = 60000;

/** Return the path a followed redirect landed on, or null (the browser hides the 3xx itself). */
function followedPath(requestedUrl, finalUrl) {
  if (!finalUrl || finalUrl === requestedUrl) {
    return null;
  }
  const { pathname, search } = new URL(finalUrl);
  return `${pathname}${search}`;
}

/** Send one GET and return its status, body, duration and redirect target; never rejects. */
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

/** Send `count` identical requests concurrently; resolve to one result per request. */
export function sendBurst(url, count) {
  return Promise.all(Array.from({ length: count }, () => sendRequest(url)));
}
