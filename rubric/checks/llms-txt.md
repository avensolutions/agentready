---
id: llms-txt
dimension: discovery
title: llms.txt
weight: 3
order: 3
progress: Checking for llms.txt...
evidence: [llms_txt]
---
Judge whether the site publishes a useful /llms.txt following the llmstxt.org convention: a markdown file with an H1 naming the site, a short blockquote summary, and sections of links to the pages that matter most to an agent, each with a one-line description. Look for a 200 response with a text or markdown content type (a 200 that returns the HTML of a catch-all page does not count). Judge the quality: does it describe what the organisation does, does it point to the key pages (offering, pricing, contact, documentation), and are the links absolute or resolvable? Length is not a virtue; a short, accurate index beats a long one.

Scoring:
- 0: No llms.txt, or the path returns an error page or generic HTML.
- 1: A file exists but is not in the convention's shape or has no usable links.
- 2: A recognisable llms.txt with a title and some links, but it is thin, out of date or misses the pages a prospective customer would need.
- 3: A well-formed llms.txt with a summary and links to the key pages with descriptions.
- 4: A well-formed llms.txt that covers the site's key pages with clear descriptions and links to markdown versions of pages where they exist.
