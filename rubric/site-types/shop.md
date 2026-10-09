---
id: shop
title: Online shop
summary: People buy products on the site. A catalogue with prices, a cart and a checkout.
order: 2
weights: { discovery: 15, retrievability: 20, structured-data: 25, answerability: 25, actionability: 15 }
skip: [llms-full-txt, openapi-description]
---
Judge answerability as an agent shopping on someone's behalf: what is sold, what it costs, whether it is in stock, how delivery and returns work, and how to buy. Product, Offer and BreadcrumbList structured data and page-specific titles and descriptions matter most, because agents use them to identify and compare products. For actionability, the question is whether an agent can find and buy a product without a browser: a documented API, a product feed, an MCP server or plain HTML forms with named fields. A single llms-full.txt is not expected for a catalogue.
