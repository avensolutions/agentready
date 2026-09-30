/** Display formatting shared by pages. Australian English, Melbourne time. */

const TIME_ZONE = 'Australia/Melbourne';

/**
 * @param {string} iso
 * @returns {string} e.g. "30 September 2026, 6:10 pm AEST"
 */
export function formatDateTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-AU', { dateStyle: 'long', timeStyle: 'short', timeZone: TIME_ZONE }).format(date);
  } catch {
    return date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  }
}

/**
 * @param {string} iso
 * @returns {string} e.g. "30 September 2026"
 */
export function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-AU', { dateStyle: 'long', timeZone: TIME_ZONE }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** @param {number} ms */
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = ms / 1000;
  return s < 10 ? `${s.toFixed(1)} seconds` : `${Math.round(s)} seconds`;
}

/** @param {string} url */
export function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
