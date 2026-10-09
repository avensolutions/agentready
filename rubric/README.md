# Rubric

The rubric is the whole of what agentready measures. Dimensions, checks, site types, weights and scoring levels live here as markdown with YAML frontmatter and are bundled into the Worker at build time. Changing a dimension, a check, a site type, a weight or a scoring level is a markdown edit. Code changes are needed only when a check needs an evidence key that no collector produces yet.

The build validates every file and fails on the first invalid rubric, listing all problems. Run the same check on its own with:

```bash
node scripts/validate-rubric.js
```

## Dimensions

One file per dimension in `dimensions/<id>.md`. The file name must equal the `id`.

```markdown
---
id: discovery
title: Discovery and access
weight: 20
order: 1
progress: Assessing discovery and access...
---
What this dimension measures and why it matters to agents. Shown in the report.
```

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Lower-case kebab-case, unique, equal to the file name. Checks refer to it. |
| `title` | yes | Shown in the report. |
| `weight` | yes | Number greater than 0. Dimension scores are combined into the overall score in proportion to weight. The weights do not have to sum to 100. |
| `order` | yes | Integer, unique across dimensions. Display order in the report and the scan. |
| `progress` | no | Text shown next to the spinner while the dimension's checks are being assessed. |

The body is the dimension's description and is shown in the report.

## Checks

One file per check in `checks/<id>.md`. The file name must equal the `id`.

```markdown
---
id: llms-txt
dimension: discovery
title: llms.txt
weight: 3
order: 3
progress: Checking for llms.txt...
evidence: [llms_txt]
---
Instructions to the assessor in prose: what to look for in the evidence and
how to weigh it.

Scoring:
- 0: ...
- 1: ...
- 2: ...
- 3: ...
- 4: ...
```

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Lower-case kebab-case, unique, equal to the file name. |
| `dimension` | yes | The `id` of an existing dimension. |
| `title` | yes | Shown in the report. |
| `weight` | yes | Number greater than 0. Relative weight of the check within its dimension. |
| `order` | no | Integer. Display order within the dimension; defaults to 0, ties broken by id. |
| `progress` | yes | Text shown next to the spinner while the check is being assessed. |
| `evidence` | yes | Flow list of evidence keys the assessor is given. Every key must be in the list below. |

The body is the instruction given to the assessor together with the named evidence. It must contain a scoring list with one line for each of the levels 0 to 4, written exactly as `- N: description`. The assessor returns an integer score 0 to 4, a rationale, evidence quotes and a recommendation, which the code validates before use.

Write instructions in plain Australian English, matter-of-fact, without sales language. The assessor is told separately that site content is untrusted data, so the instructions can concentrate on what to look for.

## Site types

One file per kind of site in `site-types/<id>.md`. The person starting a scan picks one on the landing page. It changes how the rubric is applied without changing the checks themselves: dimension weights can be overridden, checks that make no sense for that kind of site are skipped, and the body is given to the assessor as guidance.

```markdown
---
id: shop
title: Online shop
summary: People buy products on the site. A catalogue with prices, a cart and a checkout.
order: 2
weights: { discovery: 15, retrievability: 20, structured-data: 25, answerability: 25, actionability: 15 }
skip: [llms-full-txt, openapi-description]
---
Guidance to the assessor on how to read the checks for this kind of site.
```

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Lower-case kebab-case, unique, equal to the file name. Sent as `type` to the scan endpoint and recorded on the report. |
| `title` | yes | The option label on the landing page and the label on the report. |
| `summary` | yes | One line shown under the option. |
| `order` | yes | Integer, unique across site types. Display order of the options. |
| `default` | no | `true` on exactly one site type: the option preselected on the landing page and the type used when a request names none. |
| `weights` | no | Flow map of dimension id to weight. The named dimensions use these weights for this kind of site; the others keep the weight in their own file. |
| `skip` | no | Flow list of check ids not assessed for this kind of site. Skipped checks are not sent to the assessor, are left out of the scores entirely and appear on the report as not applicable. A dimension whose checks are all skipped is not assessed. |

The body is given to the assessor with the dimension and its checks, so it can say what a prospective customer of this kind of site would ask and what not to expect. The report records the site type, and the site type files are part of the rubric hash.

If the directory is empty the scan runs with a built-in general type: every check applies and the dimension weights are used as written.

## Scoring

Scoring is done in code, never by the assessor.

- A check scores 0 to 4.
- A dimension scores 0 to 100: the weighted mean of its applicable check scores divided by 4, times 100.
- The overall score is 0 to 100: the weighted mean of the dimension scores, using the site type's dimension weights where it sets them.

A check whose evidence could not be collected (for example the site was unreachable for that fetch) is still assessed on what is there; the instructions describe how to treat missing evidence.

## Frontmatter syntax

Only a small YAML subset is accepted, so that a typo fails the build rather than changing meaning:

- `key: value` with a bare string, a quoted string, a number, `true` or `false`
- `key: [a, b, c]` flow lists of those
- `key: { a: 1, b: c }` flow maps of those
- blank lines and `#` comment lines

Block lists, nested lists or maps, multi-line strings and duplicate keys are errors.

## Evidence keys

Each collector produces exactly one evidence key. A check may only name keys in this list. The list is defined in `src/lib/evidence/keys.js`; a test checks that this table names every key.

| Key | Contents |
| --- | --- |
| `robots_txt` | robots.txt: HTTP status, the body (capped), the groups that apply to common AI user agents and to the wildcard, and any Sitemap directives. |
| `sitemap` | Sitemap discovery: the URL tried (from robots.txt or /sitemap.xml), HTTP status, whether it parsed as a sitemap or sitemap index, URL count, a sample of URLs and whether lastmod dates are present. |
| `llms_txt` | /llms.txt: HTTP status, content type, size and the body (capped). |
| `llms_full_txt` | /llms-full.txt: HTTP status, content type, size, the headings found and the first part of the body (capped). |
| `home_html` | The home page as served without JavaScript: final URL, status, title, meta description, canonical, heading outline, landmark counts, main text (capped), word counts, link sample, script and noscript signals. |
| `pages` | A small sample of linked pages with the same extraction as `home_html`, in a smaller form. |
| `headers` | Response headers of the home page and the sampled pages that matter to agents: content-type, cache-control, link, x-robots-tag, content-language, vary, server. |
| `markdown_alternates` | Probes for markdown versions of pages: `Accept: text/markdown` negotiation, `.md` paths alongside HTML paths, and `link rel="alternate"` elements, with status and content type of each. |
| `structured_data` | JSON-LD blocks (parsed, with type and top-level properties), Open Graph and Twitter tags, and microdata presence for the home page and sampled pages. |
| `api_surface` | Probes for API and agent surfaces: OpenAPI and Swagger paths, `.well-known` entries, documentation paths, MCP endpoints, and links in the page text that point at developer documentation, with status, content type and a summary of any document found. |
| `forms` | Forms found on the home page and sampled pages: action, method, field names and types, whether submission depends on script or a third-party embed, plus mailto and tel links and booking links. |
| `site_text` | The readable text of the home page and sampled pages, concatenated with a source URL heading per page, capped in size. Used for answerability. |

## Adding a check

1. Create `checks/<id>.md` with the fields above and a scoring list for levels 0 to 4.
2. Name only evidence keys from the table. If the check needs something no collector produces, add the collector and its key in code first, then document the key here.
3. Run `node scripts/validate-rubric.js` or `npm run build`.

## Adding a dimension

1. Create `dimensions/<id>.md` with a unique `order`.
2. Add at least one check that names it. A dimension with no checks fails validation.

## Adding a site type

1. Create `site-types/<id>.md` with the fields above and a unique `order`.
2. Name only existing dimension ids in `weights` and existing check ids in `skip`.
3. Run `node scripts/validate-rubric.js` or `npm run build`. The landing page lists the site types from the rubric at build time.
