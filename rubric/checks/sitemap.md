---
id: sitemap
dimension: discovery
title: Sitemap
weight: 2
order: 2
progress: Checking for a sitemap...
evidence: [sitemap, robots_txt]
---
Judge whether the site publishes an XML sitemap that an agent can use to enumerate its pages. Look for a Sitemap directive in robots.txt and for /sitemap.xml or a sitemap index. Consider whether the sitemap returned successfully, whether it is well formed, whether it lists a plausible number of URLs for the site and whether it includes lastmod dates. A sitemap that references only the home page or returns an error is close to no sitemap.

Scoring:
- 0: No sitemap could be found and robots.txt does not reference one.
- 1: A sitemap is referenced or present but it errors, is empty or is not valid XML.
- 2: A valid sitemap exists but covers only a few pages or is not referenced from robots.txt.
- 3: A valid sitemap covers the site's main pages and is referenced from robots.txt or at the standard path.
- 4: A valid, referenced sitemap covers the site with lastmod dates, or a sitemap index organises a larger site clearly.
