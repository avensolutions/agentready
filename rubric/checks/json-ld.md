---
id: json-ld
dimension: structured-data
title: JSON-LD structured data
weight: 3
order: 1
progress: Checking JSON-LD structured data...
evidence: [structured_data]
---
Judge the schema.org JSON-LD on the home page and sampled pages. Look for an Organization (or LocalBusiness, or a more specific subtype) with name, url, logo, contact details and sameAs links; a WebSite; and page-appropriate types such as Product, Service, Offer, Article, FAQPage or BreadcrumbList where the page content warrants them. Check that the JSON parses, that required properties are present, and that the values agree with the visible content. Microdata or RDFa is acceptable evidence but JSON-LD is the expected form.

Scoring:
- 0: No structured data on any sampled page.
- 1: Structured data is present but malformed, or limited to a minimal WebSite or breadcrumb block.
- 2: A valid Organization or equivalent with basic properties, but nothing page-specific.
- 3: Valid Organization plus page-appropriate types on the sampled pages, with most useful properties filled in.
- 4: Comprehensive, valid and consistent structured data that describes the organisation, its offering and each sampled page.
