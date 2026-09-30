---
id: signal-to-noise
dimension: retrievability
title: Signal to noise
weight: 2
order: 3
progress: Checking signal to noise...
evidence: [home_html, pages]
---
Judge how much of each page is substantive content versus chrome, repeated navigation, cookie and consent banners, promotional interstitials, tracking scripts and inline styles. An agent reading the page pays for every token. Look at the ratio of main text to total text, whether a main landmark or article element isolates the content, how much repeated boilerplate appears across the sampled pages, and the script and style weight relative to text. Judge from the extracted evidence, not from assumptions about the platform.

Scoring:
- 0: Almost all of the page is chrome, scripts or boilerplate; the substantive content is a small fraction.
- 1: Substantive content is present but buried under heavy navigation, banners and repeated blocks.
- 2: A reasonable amount of content with noticeable boilerplate and no clear main landmark.
- 3: Content dominates the page and is isolated in a main or article element, with modest chrome.
- 4: Lean pages where the substantive content is clearly delimited and boilerplate is minimal.
