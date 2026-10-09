---
id: initial-html-content
dimension: retrievability
title: Content in the initial HTML
weight: 3
order: 1
progress: Checking whether content loads without JavaScript...
evidence: [home_html, pages]
---
Judge whether the site's content is present in the HTML returned by the server, without JavaScript running. Most agents and crawlers fetch pages with a plain HTTP client and do not execute scripts. Look at the extracted text and word counts of the home page and sampled pages, at whether the body is an empty application shell (a root div with no text, a "please enable JavaScript" notice, or a noscript fallback only), and at the ratio of script bytes to text. A page whose main text, headings and links are all present in the initial HTML scores high even if it also uses JavaScript for enhancement.

Scoring:
- 0: The pages are empty shells: no meaningful text in the initial HTML.
- 1: Only a title, navigation or a fragment of content is present; the main content needs JavaScript.
- 2: Some pages have their content in the HTML but others do not, or the content is present but truncated or hidden behind script-rendered sections.
- 3: The main content of every sampled page is in the initial HTML, with minor parts (for example interactive widgets) rendered by script.
- 4: All sampled pages deliver complete, readable content in the initial HTML.
