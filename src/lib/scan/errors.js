/**
 * @typedef {'invalid-url' | 'unreachable' | 'http-error' | 'robots' | 'budget' | 'timeout' | 'llm-quota' | 'llm' | 'rate-limited' | 'turnstile' | 'internal'} ScanErrorCode
 */

/** An error with a code the UI can map to a clear message. */
export class ScanError extends Error {
  /**
   * @param {ScanErrorCode} code
   * @param {string} message  user-facing
   * @param {Record<string, unknown>} [details]
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ScanError';
    this.code = code;
    this.details = details;
  }
}
