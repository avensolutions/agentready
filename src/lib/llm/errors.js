/**
 * @typedef {'config' | 'rate-limit' | 'quota' | 'unavailable' | 'network' | 'request' | 'blocked' | 'unfinished' | 'malformed'} LlmErrorCode
 */

const RETRYABLE = new Set(['rate-limit', 'unavailable', 'network', 'malformed', 'unfinished']);

/** An error from an LLM provider, with a code the scan can act on. */
export class LlmError extends Error {
  /**
   * @param {LlmErrorCode} code
   * @param {string} message
   * @param {Record<string, unknown>} [details]
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
    this.details = details;
  }

  get retryable() {
    return RETRYABLE.has(this.code);
  }
}
