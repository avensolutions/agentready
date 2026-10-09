/**
 * URL validation and normalisation for scan targets and redirect hops.
 *
 * Rules (see CLAUDE.md, Security and abuse):
 * - http and https only, on their default ports, without credentials
 * - no IP literals (the URL parser folds decimal, octal and hex forms into
 *   dotted IPv4, so a single check after parsing covers them)
 * - no localhost, single-label hosts, or hostnames under internal-only
 *   suffixes
 * - re-checked after every redirect by the fetch wrapper
 *
 * Workers cannot resolve DNS, so a public hostname that points at a private
 * address cannot be detected here. fetch() from a Worker cannot reach private
 * ranges, and the global_fetch_strictly_public flag routes every request over
 * the public Internet, so the remaining exposure is a fetch that fails.
 */

const MAX_URL_LENGTH = 2048;

/** Hostnames and suffixes that are never public. */
const BLOCKED_HOSTS = new Set(['localhost', 'localhost.localdomain', 'broadcasthost', 'ip6-localhost', 'ip6-loopback']);
const BLOCKED_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.intranet',
  '.private',
  '.corp',
  '.home',
  '.lan',
  '.arpa',
  '.onion',
  '.test',
  '.example',
  '.invalid',
];

const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const HOST_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * @typedef {'length' | 'invalid' | 'scheme' | 'port' | 'credentials' | 'ip' | 'host' | 'internal'} UrlErrorCode
 */

export class UrlError extends Error {
  /**
   * @param {UrlErrorCode} code
   * @param {string} message  user-facing
   */
  constructor(code, message) {
    super(message);
    this.name = 'UrlError';
    this.code = code;
  }
}

/**
 * Parse and check a URL. Returns the parsed URL or throws UrlError.
 * @param {string} input
 * @returns {URL}
 */
export function assertSafeUrl(input) {
  if (typeof input !== 'string' || input.length > MAX_URL_LENGTH) {
    throw new UrlError('length', 'That address is too long.');
  }
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new UrlError('invalid', 'That does not look like a web address.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UrlError('scheme', 'Only http and https addresses can be checked.');
  }
  if (url.port !== '') {
    throw new UrlError('port', 'Only the default port for http or https is supported.');
  }
  if (url.username !== '' || url.password !== '') {
    throw new UrlError('credentials', 'Addresses with a username or password are not supported.');
  }
  const host = url.hostname.toLowerCase();
  if (host.startsWith('[') || IPV4_RE.test(host)) {
    throw new UrlError('ip', 'IP addresses cannot be checked. Use the site name.');
  }
  if (BLOCKED_HOSTS.has(host) || BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw new UrlError('internal', 'Local and internal addresses cannot be checked.');
  }
  const labels = host.split('.');
  if (labels.length < 2 || labels.some((label) => !HOST_LABEL_RE.test(label))) {
    throw new UrlError('host', 'That does not look like a public site name.');
  }
  if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(labels[labels.length - 1]) || /^\d+$/.test(labels[labels.length - 1])) {
    throw new UrlError('host', 'That does not look like a public site name.');
  }
  return url;
}

/**
 * Turn user input into the canonical scan target. Adds https:// when no
 * scheme is given, lower-cases the host, drops the query string and
 * fragment, and keeps the path. Throws UrlError.
 *
 * @param {string} input
 * @returns {{ url: string, origin: string, host: string, path: string }}
 */
export function normaliseTarget(input) {
  const trimmed = String(input ?? '').trim();
  if (trimmed === '') throw new UrlError('invalid', 'Enter a web address to check.');
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = assertSafeUrl(withScheme);
  url.hash = '';
  url.search = '';
  url.hostname = url.hostname.toLowerCase();
  let path = url.pathname || '/';
  // collapse duplicate slashes and a trailing slash on non-root paths
  path = path.replace(/\/{2,}/g, '/');
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  url.pathname = path;
  return { url: url.toString(), origin: url.origin, host: url.hostname, path: url.pathname };
}

/**
 * True when two URLs are on the same site for sampling purposes: the same
 * registrable host, ignoring a leading www.
 * @param {URL} a
 * @param {URL} b
 */
export function sameSite(a, b) {
  const strip = (/** @type {string} */ h) => h.toLowerCase().replace(/^www\./, '');
  return strip(a.hostname) === strip(b.hostname);
}
