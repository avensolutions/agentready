---
id: llms-full-txt
dimension: discovery
title: llms-full.txt
weight: 2
order: 4
progress: Checking for llms-full.txt...
evidence: [llms_full_txt, llms_txt]
---
Judge whether the site publishes /llms-full.txt: a single markdown document containing the full text of the site's important pages so an agent can read everything in one fetch. Look for a 200 response with text content, a plausible size for the site, markdown headings that separate pages, and source URLs for each section. Judge whether the content is the site's real content rather than navigation chrome or boilerplate. If llms.txt links to it, note that.

Scoring:
- 0: No llms-full.txt, or the path returns an error page or generic HTML.
- 1: A file exists but is nearly empty, is not markdown-like text or is mostly boilerplate.
- 2: A file with real content from some pages, but it is partial or hard to navigate (no headings or source URLs).
- 3: A file that covers the main pages with headings and readable content.
- 4: A file that covers the site's important pages with clear headings, source URLs and current content, and is linked from llms.txt.
