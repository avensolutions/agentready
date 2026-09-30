---
id: machine-usable-paths
dimension: actionability
title: Machine-usable paths to human actions
weight: 2
order: 4
progress: Checking for machine-usable equivalents of forms...
evidence: [forms, api_surface, site_text]
---
Judge whether the things a person would do on this site through forms and buttons (enquire, book, subscribe, quote, order, sign up) have equivalents an agent can use without a browser: a documented API endpoint, a mailto: address, a plain HTML form with named fields that submits without JavaScript, a calendar booking link, or a structured contact channel. Look at the forms found (action, method, field names, whether submission depends on script or third-party embeds) and at any API or contact routes in the evidence. Forms rendered entirely by third-party scripts with no fallback are the weakest case.

Scoring:
- 0: The main actions are only possible through script-rendered forms or widgets with no alternative.
- 1: Some actions have a plain fallback (for example an email address) but most do not.
- 2: The main actions have plain HTML forms or direct contact routes, but nothing structured for agents.
- 3: The main actions have both a human route and a documented machine route (API, mailto, booking link).
- 4: Every main action has a documented machine-usable route that an agent could complete end to end.
