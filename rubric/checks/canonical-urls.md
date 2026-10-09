---
id: canonical-urls
dimension: structured-data
title: Canonical URLs
weight: 1
order: 4
progress: Checking canonical URLs...
evidence: [home_html, pages, headers]
---
Judge whether each sampled page declares a canonical URL (a link rel="canonical" element or a Link response header) that is absolute, uses https, and points to the page itself or to a sensible preferred version. Also note whether the site redirects cleanly between http and https and between www and bare host so an agent lands on one address. Conflicting or missing canonicals make it harder for an agent to cite and deduplicate pages.

Scoring:
- 0: No canonical URLs on any sampled page.
- 1: Canonicals are present but relative, inconsistent or pointing at the wrong pages.
- 2: Canonicals on most pages, with some pages missing or duplicate hosts still reachable without a redirect.
- 3: Correct absolute canonicals on every sampled page.
- 4: Correct canonicals on every sampled page and clean redirects to a single preferred host and scheme.
