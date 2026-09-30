/**
 * Report ids derive from the normalised URL, so the cache lookup for a
 * repeat scan is a single KV read and a shared link stays stable across
 * re-scans of the same site.
 *
 * @param {string} normalisedUrl
 * @returns {Promise<string>} 16 lower-case hex characters
 */
export async function reportIdFor(normalisedUrl) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalisedUrl));
  return Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** @param {string} id */
export function isReportId(id) {
  return /^[0-9a-f]{16}$/.test(id);
}
