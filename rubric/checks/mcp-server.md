---
id: mcp-server
dimension: actionability
title: MCP server
weight: 2
order: 3
progress: Checking for an MCP server...
evidence: [api_surface, llms_txt, site_text]
---
Judge whether the organisation offers a Model Context Protocol (MCP) server or an equivalent tool interface that agents can connect to. Look at the probes for /.well-known/mcp.json and common MCP endpoint paths, at mentions of MCP, "agent tools" or "connector" in the page text and in llms.txt, and at links to an MCP server package or hosted endpoint. A documented remote MCP endpoint with a clear list of tools is the strongest evidence. Most organisations will not have one; score 0 in that case without penalising the prose.

Scoring:
- 0: No MCP server or agent tool interface is offered or mentioned.
- 1: MCP or agent tooling is mentioned but nothing is reachable or documented.
- 2: A server or package exists but its tools, authentication or endpoint are not documented.
- 3: A documented MCP server with a clear tool list and connection instructions.
- 4: A documented, discoverable (well-known path or llms.txt link) MCP server whose tools cover the main customer actions.
