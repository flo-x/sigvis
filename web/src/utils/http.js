/**
 * Shared HTTP utilities used by all API service modules.
 */

/**
 * Parse a fetch Response, throwing a descriptive Error on non-2xx status.
 * @param {Response} response
 * @returns {Promise<any>}
 */
async function parseResponse(response) {
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }
  return data;
}

/**
 * fetch() wrapper that always disables the browser cache.
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<Response>}
 */
function fetchNoCache(url, options = {}) {
  return fetch(url, {
    ...options,
    cache: "no-store"
  });
}

export { parseResponse, fetchNoCache };
