---
id: markdown-alternates
dimension: retrievability
title: Markdown alternates
weight: 2
order: 2
progress: Checking for markdown versions of pages...
evidence: [markdown_alternates, headers]
---
Judge whether the site offers markdown (or plain text) versions of its pages for agents, which are cheaper to read than HTML. Look at the probes: a request for the home page with Accept: text/markdown, a .md path alongside the HTML path (for example /about.md or /index.md), a link rel="alternate" with type text/markdown in the HTML head, and any content negotiation hints in the response headers. A probe counts only if it returns a markdown or plain text content type with the page's real content, not an HTML error page.

Scoring:
- 0: No markdown alternate exists by any of the probed methods.
- 1: Something markdown-like exists but is not discoverable (no link, no content negotiation) or does not match the page.
- 2: Markdown alternates exist for some pages via one method, without being advertised.
- 3: Markdown alternates exist for the sampled pages and are advertised through a link element or content negotiation.
- 4: Every sampled page has a markdown alternate that is advertised, current and matches the HTML content.
