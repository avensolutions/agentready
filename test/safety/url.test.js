import { describe, expect, it } from 'vitest';
import { UrlError, assertSafeUrl, normaliseTarget, sameSite } from '../../src/lib/safety/url.js';

/** @param {string} input */
function codeOf(input) {
  try {
    assertSafeUrl(input);
  } catch (err) {
    if (err instanceof UrlError) return err.code;
    throw err;
  }
  return 'ok';
}

describe('assertSafeUrl', () => {
  it('accepts public http and https addresses', () => {
    expect(codeOf('https://example.com/')).toBe('ok');
    expect(codeOf('http://www.example.com.au/path?q=1#x')).toBe('ok');
    expect(codeOf('https://sub.domain.example.org:443/')).toBe('ok');
    expect(codeOf('https://xn--bcher-kva.de/')).toBe('ok');
    expect(codeOf('https://b\u00fccher.de/')).toBe('ok');
  });

  it('rejects other schemes', () => {
    expect(codeOf('ftp://example.com/')).toBe('scheme');
    expect(codeOf('file:///etc/passwd')).toBe('scheme');
    expect(codeOf('javascript:alert(1)')).toBe('scheme');
    expect(codeOf('data:text/html,hi')).toBe('scheme');
  });

  it('rejects non-default ports and credentials', () => {
    expect(codeOf('https://example.com:8443/')).toBe('port');
    expect(codeOf('http://example.com:443/')).toBe('port');
    expect(codeOf('https://user:pass@example.com/')).toBe('credentials');
    expect(codeOf('https://user@example.com/')).toBe('credentials');
  });

  it('rejects IP literals in every spelling the URL parser accepts', () => {
    expect(codeOf('http://127.0.0.1/')).toBe('ip');
    expect(codeOf('http://10.0.0.1/')).toBe('ip');
    expect(codeOf('http://169.254.169.254/latest/meta-data/')).toBe('ip');
    expect(codeOf('http://2130706433/')).toBe('ip');
    expect(codeOf('http://0x7f000001/')).toBe('ip');
    expect(codeOf('http://127.1/')).toBe('ip');
    expect(codeOf('http://0177.0.0.1/')).toBe('ip');
    expect(codeOf('http://[::1]/')).toBe('ip');
    expect(codeOf('http://[fd00::1]/')).toBe('ip');
    expect(codeOf('http://[::ffff:127.0.0.1]/')).toBe('ip');
  });

  it('rejects localhost, single-label and internal hostnames', () => {
    expect(codeOf('http://localhost/')).toBe('internal');
    expect(codeOf('http://LOCALHOST:80/')).toBe('internal');
    expect(codeOf('http://app.localhost/')).toBe('internal');
    expect(codeOf('http://printer.local/')).toBe('internal');
    expect(codeOf('http://metadata.internal/')).toBe('internal');
    expect(codeOf('http://intranet/')).toBe('host');
    expect(codeOf('http://example.onion/')).toBe('internal');
    expect(codeOf('http://foo.test/')).toBe('internal');
  });

  it('rejects malformed hosts and over-long input', () => {
    expect(codeOf('not a url')).toBe('invalid');
    expect(codeOf('https://')).toBe('invalid');
    expect(codeOf('https://exa_mple.com/')).toBe('host');
    expect(codeOf('https://-example.com/')).toBe('host');
    // a final numeric label is parsed as an IPv4 address and fails to parse
    expect(codeOf('https://example.123/')).toBe('invalid');
    expect(codeOf(`https://example.com/${'a'.repeat(2100)}`)).toBe('length');
  });
});

describe('normaliseTarget', () => {
  it('adds https when no scheme is given', () => {
    expect(normaliseTarget('example.com')).toEqual({ url: 'https://example.com/', origin: 'https://example.com', host: 'example.com', path: '/' });
    expect(normaliseTarget('  www.Example.com/About/  ').url).toBe('https://www.example.com/About');
  });

  it('keeps http when given, drops query and fragment, tidies the path', () => {
    expect(normaliseTarget('http://example.com/a//b/?utm=1#top').url).toBe('http://example.com/a/b');
    expect(normaliseTarget('https://example.com?x=1').url).toBe('https://example.com/');
  });

  it('rejects empty input and unsafe addresses with a user-facing message', () => {
    expect(() => normaliseTarget('')).toThrow('Enter a web address');
    expect(() => normaliseTarget('127.0.0.1')).toThrow(UrlError);
    expect(() => normaliseTarget('localhost:4321')).toThrow(UrlError);
    expect(() => normaliseTarget('ftp://example.com')).toThrow('Only http and https');
  });
});

describe('sameSite', () => {
  it('ignores a leading www and case', () => {
    expect(sameSite(new URL('https://www.Example.com/'), new URL('https://example.com/x'))).toBe(true);
    expect(sameSite(new URL('https://blog.example.com/'), new URL('https://example.com/'))).toBe(false);
  });
});
