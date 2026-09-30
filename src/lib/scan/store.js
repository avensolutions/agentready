import { REPORT_VERSION } from './run.js';

/**
 * Report storage in Workers KV. One write per completed scan, keyed by the
 * report id (a hash of the normalised URL), with a TTL so the free plan's
 * storage stays bounded. A stored report is served for a repeat scan of the
 * same URL while it is fresh: inside the TTL, scored against the current
 * rubric, and in the current report format.
 */

export const DEFAULT_TTL_DAYS = 7;
const DAY_MS = 86_400_000;

/**
 * @typedef {import('./run.js').Report & { id: string }} StoredReport
 */

/**
 * @param {KVNamespace} kv
 * @param {{ ttlDays?: number }} [options]
 */
export function createReportStore(kv, { ttlDays = DEFAULT_TTL_DAYS } = {}) {
  const ttl = Math.max(1, Math.floor(ttlDays));
  return {
    ttlDays: ttl,
    /**
     * @param {string} id
     * @returns {Promise<StoredReport | null>}
     */
    async get(id) {
      const value = await kv.get(id, 'json');
      return value && typeof value === 'object' && 'dimensions' in value ? /** @type {StoredReport} */ (value) : null;
    },
    /** @param {StoredReport} report */
    async put(report) {
      await kv.put(report.id, JSON.stringify(report), { expirationTtl: ttl * 86_400 });
    },
  };
}

/**
 * Whether a stored report can stand in for a new scan.
 * @param {StoredReport | null} report
 * @param {Object} options
 * @param {string} options.rubricHash  hash of the rubric in use now
 * @param {number} options.ttlDays
 * @param {Date} [options.now]
 */
export function isFresh(report, { rubricHash, ttlDays, now = new Date() }) {
  if (!report) return false;
  if (report.version !== REPORT_VERSION) return false;
  if (report.rubricHash !== rubricHash) return false;
  const scanned = Date.parse(report.scannedAt);
  if (!Number.isFinite(scanned)) return false;
  const age = now.getTime() - scanned;
  return age >= 0 && age < ttlDays * DAY_MS;
}

/**
 * Read the TTL from the Worker environment.
 * @param {Record<string, string | undefined>} env
 */
export function ttlDaysFromEnv(env) {
  const n = Number(env.REPORT_TTL_DAYS);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_TTL_DAYS;
}
