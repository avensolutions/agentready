import { REPORT_VERSION } from './run.js';

/**
 * Report storage in Workers KV. One write per completed scan, keyed by the
 * report id (a hash of the normalised URL), with a TTL so the free plan's
 * storage stays bounded. The store exists for the report page: every scan
 * is live, and a new scan of the same URL replaces the stored report.
 */

export const DEFAULT_TTL_DAYS = 7;

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
 * Read the TTL from the Worker environment.
 * @param {Record<string, string | undefined>} env
 */
export function ttlDaysFromEnv(env) {
  const n = Number(env.REPORT_TTL_DAYS);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_TTL_DAYS;
}
