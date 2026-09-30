import { describe, expect, it } from 'vitest';
import { evaluateAgent, groupFor, isPathAllowed, parseRobots } from '../src/lib/collectors/robots.js';

const SAMPLE = `
# comment
User-agent: *
Disallow: /admin/
Disallow: /search
Allow: /search/help
Sitemap: https://example.com/sitemap.xml

User-agent: GPTBot
User-agent: CCBot
Disallow: /

User-agent: ClaudeBot
Disallow:

User-agent: Bytespider
Disallow: /private/*
Disallow: /*.pdf$
Crawl-delay: 10
Sitemap: https://example.com/news-sitemap.xml
`;

describe('parseRobots', () => {
  it('groups user agents with their rules and collects sitemaps', () => {
    const parsed = parseRobots(SAMPLE);
    expect(parsed.groups.length).toBe(4);
    expect(parsed.groups[0]).toEqual({ agents: ['*'], allow: ['/search/help'], disallow: ['/admin/', '/search'], crawlDelay: null });
    expect(parsed.groups[1].agents).toEqual(['gptbot', 'ccbot']);
    expect(parsed.groups[2]).toEqual({ agents: ['claudebot'], allow: [], disallow: [], crawlDelay: null });
    expect(parsed.groups[3].crawlDelay).toBe(10);
    expect(parsed.sitemaps).toEqual(['https://example.com/sitemap.xml', 'https://example.com/news-sitemap.xml']);
  });

  it('tolerates junk lines and CRLF', () => {
    const parsed = parseRobots('User-agent: *\r\nnonsense\r\nDisallow: /x\r\n');
    expect(parsed.groups[0].disallow).toEqual(['/x']);
  });
});

describe('groupFor', () => {
  const parsed = parseRobots(SAMPLE);

  it('prefers the most specific token and falls back to the wildcard', () => {
    expect(groupFor(parsed, 'GPTBot').matched).toBe('gptbot');
    expect(groupFor(parsed, 'PerplexityBot').matched).toBe('*');
    expect(groupFor(parsed, 'Bytespider/1.0').matched).toBe('bytespider');
  });

  it('returns no group when there is no wildcard either', () => {
    expect(groupFor(parseRobots('User-agent: Foo\nDisallow: /'), 'Bar')).toEqual({ group: null, matched: null });
  });
});

describe('isPathAllowed', () => {
  it('applies longest-match with allow winning ties, wildcards and anchors', () => {
    const { group } = groupFor(parseRobots(SAMPLE), 'anything');
    expect(isPathAllowed(group, '/')).toBe(true);
    expect(isPathAllowed(group, '/admin/users')).toBe(false);
    expect(isPathAllowed(group, '/search')).toBe(false);
    expect(isPathAllowed(group, '/search/help/x')).toBe(true);
    const bytes = groupFor(parseRobots(SAMPLE), 'Bytespider').group;
    expect(isPathAllowed(bytes, '/private/a/b')).toBe(false);
    expect(isPathAllowed(bytes, '/docs/file.pdf')).toBe(false);
    expect(isPathAllowed(bytes, '/docs/file.pdf.html')).toBe(true);
    expect(isPathAllowed(null, '/anything')).toBe(true);
  });
});

describe('evaluateAgent', () => {
  it('summarises access for training and user agents', () => {
    const parsed = parseRobots(SAMPLE);
    expect(evaluateAgent(parsed, 'GPTBot')).toMatchObject({ matched: 'gptbot', allowedRoot: false, allowedPath: false, disallow: ['/'] });
    expect(evaluateAgent(parsed, 'ClaudeBot')).toMatchObject({ matched: 'claudebot', allowedRoot: true, allowedPath: true });
    expect(evaluateAgent(parsed, 'agentready', '/admin/')).toMatchObject({ matched: '*', allowedRoot: true, allowedPath: false });
    expect(evaluateAgent({ groups: [] }, 'agentready')).toMatchObject({ matched: null, allowedRoot: true, allowedPath: true });
  });
});
