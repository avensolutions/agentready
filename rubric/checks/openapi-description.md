---
id: openapi-description
dimension: actionability
title: OpenAPI description
weight: 2
order: 2
progress: Checking for an OpenAPI description...
evidence: [api_surface]
---
Judge whether a machine-readable API description is published: an OpenAPI (Swagger) document at a common path (/openapi.json, /openapi.yaml, /swagger.json, /.well-known/openapi.json) or linked from the documentation, or an equivalent such as GraphQL introspection or a JSON Schema catalogue. Look for a successful response with a JSON or YAML content type and an openapi or swagger version field. Judge completeness from the probe summary: number of paths and operations, whether operations have descriptions, and whether authentication is described.

Scoring:
- 0: No machine-readable API description is published.
- 1: A description is referenced but does not resolve, or resolves to something that is not a valid OpenAPI document.
- 2: A valid but sparse description (few paths, no descriptions or no security scheme).
- 3: A valid description covering the main operations with descriptions and a security scheme.
- 4: A complete, valid description that is discoverable at a standard path or from the documentation and describes every main operation.
