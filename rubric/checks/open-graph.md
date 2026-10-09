---
id: open-graph
dimension: structured-data
title: Open Graph and social metadata
weight: 1
order: 2
progress: Checking Open Graph metadata...
evidence: [structured_data]
---
Judge whether the pages carry Open Graph tags (og:title, og:description, og:type, og:url, og:image) and Twitter card tags that describe each page accurately. These tags are read by many agents and link-preview systems as a quick summary of the page. Look for presence on the home page and sampled pages, for values that match the page rather than a site-wide default, and for an absolute og:image URL.

Scoring:
- 0: No Open Graph or Twitter tags.
- 1: A few tags on the home page only, or values that are placeholders.
- 2: Core tags on most sampled pages, but with site-wide defaults reused on inner pages.
- 3: Core tags on every sampled page with page-specific title and description.
- 4: Complete, page-specific Open Graph and Twitter tags on every sampled page, with absolute image URLs.
