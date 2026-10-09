/**
 * Report ids derive from the normalised URL and the site type the scan is
 * scored as, so a shared link stays stable across re-scans of the same site
 * as the same kind, and each live scan replaces the stored report at that
 * address. Scans of one site as different kinds keep separate reports.
 *
 * @param {string} normalisedUrl
 * @param {string} [siteTypeId]
 * @returns {Promise<string>} 16 lower-case hex characters
 */
export async function reportIdFor(normalisedUrl, siteTypeId = '') {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${normalisedUrl}\n${siteTypeId}`));
  return Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** @param {string} id */
export function isReportId(id) {
  return /^[0-9a-f]{16}$/.test(id);
}
