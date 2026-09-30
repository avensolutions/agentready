import { truncate } from './text.js';

/**
 * robots.txt parsing and evaluation. Follows the common interpretation used
 * by Google and others: groups of user-agent lines share rules, the most
 * specific matching token wins, longest path rule wins with allow beating
 * disallow on a tie.
 */

/** AI user agents the rubric asks about, grouped by purpose. */
export const AI_AGENTS = Object.freeze({
  training: ['GPTBot', 'Google-Extended', 'CCBot', 'anthropic-ai', 'Applebot-Extended', 'Bytespider', 'meta-externalagent', 'cohere-ai', 'Amazonbot'],
  user: ['ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'PerplexityBot', 'Perplexity-User', 'DuckAssistBot', 'Meta-ExternalFetcher', 'MistralAI-User'],
});

/** The user agent token axcheck itself honours. */
export const SELF_AGENT = 'axcheck';

/**
 * @typedef {Object} RobotsGroup
 * @property {string[]} agents  lower-case tokens
 * @property {string[]} allow
 * @property {string[]} disallow
 * @property {number | null} crawlDelay
 */

/**
 * @param {string} text
 * @returns {{ groups: RobotsGroup[], sitemaps: string[] }}
 */
export function parseRobots(text) {
  /** @type {RobotsGroup[]} */
  const groups = [];
  /** @type {string[]} */
  const sitemaps = [];
  /** @type {RobotsGroup | null} */
  let current = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (line === '') continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], allow: [], disallow: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (field === 'sitemap') {
      if (value) sitemaps.push(value);
      continue;
    }
    if (!current) continue;
    if (field === 'disallow') {
      if (value) current.disallow.push(value);
    } else if (field === 'allow') {
      if (value) current.allow.push(value);
    } else if (field === 'crawl-delay') {
      const n = Number(value);
      current.crawlDelay = Number.isFinite(n) ? n : null;
    }
  }
  return { groups, sitemaps };
}

/**
 * Find the group that applies to a user agent: the longest matching specific
 * token, else the wildcard group, else none (everything allowed).
 * @param {{ groups: RobotsGroup[] }} parsed
 * @param {string} agent
 * @returns {{ group: RobotsGroup | null, matched: string | null }}
 */
export function groupFor(parsed, agent) {
  const a = agent.toLowerCase();
  /** @type {RobotsGroup | null} */
  let best = null;
  let bestToken = '';
  for (const g of parsed.groups) {
    for (const token of g.agents) {
      if (token === '*' || token === '') continue;
      if ((a.startsWith(token) || a.includes(token)) && token.length > bestToken.length) {
        best = g;
        bestToken = token;
      }
    }
  }
  if (best) return { group: best, matched: bestToken };
  const wild = parsed.groups.find((g) => g.agents.includes('*'));
  return wild ? { group: wild, matched: '*' } : { group: null, matched: null };
}

/** @param {string} rule */
function ruleToRegex(rule) {
  const escaped = rule.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  const anchored = escaped.endsWith('\\$') ? `${escaped.slice(0, -2)}$` : escaped;
  return new RegExp(`^${anchored}`);
}

/**
 * @param {RobotsGroup | null} group
 * @param {string} path
 */
export function isPathAllowed(group, path) {
  if (!group) return true;
  let verdict = true;
  let bestLen = -1;
  for (const rule of group.allow) {
    if (ruleToRegex(rule).test(path) && rule.length > bestLen) {
      bestLen = rule.length;
      verdict = true;
    }
  }
  for (const rule of group.disallow) {
    if (ruleToRegex(rule).test(path) && rule.length > bestLen) {
      bestLen = rule.length;
      verdict = false;
    }
  }
  return verdict;
}

/**
 * Summarise what a user agent may do.
 * @param {{ groups: RobotsGroup[] }} parsed
 * @param {string} agent
 * @param {string} [path]
 */
export function evaluateAgent(parsed, agent, path = '/') {
  const { group, matched } = groupFor(parsed, agent);
  return {
    matched,
    allowedRoot: isPathAllowed(group, '/'),
    allowedPath: isPathAllowed(group, path),
    allow: group ? group.allow : [],
    disallow: group ? group.disallow : [],
  };
}

/**
 * Collector: fetch and evaluate robots.txt.
 * @param {import('./index.js').ScanContext} ctx
 */
export async function collectRobots(ctx) {
  const url = `${ctx.origin}/robots.txt`;
  const res = await ctx.fetcher.fetch(url, { maxBytes: ctx.budget.bytes.text, accept: 'text/plain, */*;q=0.5' });
  const fetched = res.ok && res.contentType.startsWith('text/');
  const parsed = fetched ? parseRobots(res.body) : { groups: [], sitemaps: [] };
  const targetPath = new URL(ctx.url).pathname;
  /** @type {Record<string, ReturnType<typeof evaluateAgent>>} */
  const agents = {};
  for (const name of [...AI_AGENTS.training, ...AI_AGENTS.user]) agents[name] = evaluateAgent(parsed, name, targetPath);
  ctx.robots = { parsed, self: evaluateAgent(parsed, SELF_AGENT, targetPath) };
  ctx.evidence.robots_txt = {
    url,
    status: res.status,
    fetched,
    error: res.error,
    contentType: res.contentType,
    body: fetched ? truncate(res.body, 8000) : '',
    truncated: fetched && res.body.length > 8000,
    sitemaps: parsed.sitemaps,
    groupCount: parsed.groups.length,
    wildcard: evaluateAgent(parsed, '*', targetPath),
    trainingAgents: Object.fromEntries(AI_AGENTS.training.map((n) => [n, agents[n]])),
    userAgents: Object.fromEntries(AI_AGENTS.user.map((n) => [n, agents[n]])),
  };
}
