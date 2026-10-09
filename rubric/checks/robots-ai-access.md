---
id: robots-ai-access
dimension: discovery
title: robots.txt rules for AI agents
weight: 3
order: 1
progress: Checking robots.txt rules for AI agents...
evidence: [robots_txt]
---
Judge whether robots.txt lets AI agents and AI crawlers fetch the site's public content. Look at the rules that apply to the common AI user agents (GPTBot, ChatGPT-User, OAI-SearchBot, ClaudeBot, Claude-User, anthropic-ai, PerplexityBot, Google-Extended, Applebot-Extended, CCBot, Bytespider, Amazonbot, meta-externalagent) and at the wildcard rules that apply when no specific group matches. A missing robots.txt is treated as allow-all by crawlers, so it is not a block, but it also shows no deliberate policy. Distinguish training crawlers (GPTBot, Google-Extended, CCBot) from agents fetching on a user's behalf (ChatGPT-User, Claude-User, PerplexityBot): a site that blocks training but allows user agents has made a considered choice and should not be marked down for the training rule alone. Blanket disallow rules that stop agents reading the public pages a customer would want are the main fault. Note a Sitemap directive if present.

Scoring:
- 0: robots.txt disallows all user agents from the whole site, or explicitly blocks the main AI agent user agents from all content.
- 1: Several AI user agents are blocked from most content, or the wildcard rules disallow the main content paths.
- 2: robots.txt is absent or has no rules affecting agents, so access is allowed by default with no stated policy.
- 3: AI agents are allowed with only minor or well-targeted restrictions (for example private paths, search results or admin areas), possibly with training crawlers restricted.
- 4: AI agents are explicitly allowed to fetch public content, restrictions are limited to paths that make sense, and a Sitemap directive is present.
