# Contributing to DorkOps

Thanks for helping improve DorkOps! The whole tool is a single `index.html` file with **no build step and no dependencies**, so contributing is fast: edit the file, open it in a browser, and you're testing.

- [Ground rules](#ground-rules)
- [Project layout](#project-layout)
- [Adding a dork](#adding-a-dork)
- [The item schema](#the-item-schema)
- [Template placeholders](#template-placeholders)
- [Severity guide](#severity-guide)
- [Adding a search engine](#adding-a-search-engine)
- [Essentials and recipes](#essentials-and-recipes)
- [Touching the UI](#touching-the-ui)
- [Testing your change](#testing-your-change)
- [Style](#style)
- [Submitting a PR](#submitting-a-pr)

## Ground rules

DorkOps ships only **passive, authorized-recon** queries. Contributions must not:

- perform active exploitation, brute-forcing, or anything that sends traffic to the *target* directly (all queries go to third-party search engines);
- target a specific real organization (use `example.com` / the `{t}` placeholder);
- include real leaked secrets, live credentials, or personal data.

A good dork is **high-signal** (it surfaces something a defender or authorized tester genuinely needs to know) and **still works** on the engine's current syntax.

## Project layout

Everything lives in `index.html`:

| Section | Where | What it holds |
| --- | --- | --- |
| `<style>` | top | The design system: colour tokens for both themes, then one numbered section per UI area |
| Icon sprite + markup | start of `<body>` | Inline SVG icons (`#i-…`), the top bar, sidebar, filter toolbar and the tools panel |
| `ENGINES` | script | The search-engine registry — one entry per engine |
| `DATA` | script | The dork catalog — an array of categories, each with `items` |
| `ESSENTIAL_STEPS` | after `DATA` | The curated first-pass playbook shown on the home view |
| `TOP_PATTERNS`, `GHDB_PICKS`, `RECIPES` | after `DATA` | Curated shortcuts and preset filters |
| App logic | rest | Search parser, `viewGroups()` (what is on screen), rendering, routing, recon tools, wiring |

To find a spot quickly, search the file for the banner comments (`/* ===== ... ===== */`); the comment at the top of the script lists them in order.

## Adding a dork

1. Find the right category object in `DATA` (matched by `id`, e.g. `devops`, `ai-llm`).
2. Add one object to that category's `items` array.
3. Reload the page and confirm your dork renders and links correctly.

```js
{
  name:"Terraform state files",
  desc:"Terraform .tfstate files referencing the target — plaintext creds and ARNs.",
  sev:"crit",
  tags:["terraform"],
  engine:"gh",
  q:'path:*.tfstate "{t}"'
}
```

## The item schema

| Field | Required | Type | Notes |
| --- | --- | --- | --- |
| `name` | ✅ | string | Short, human-readable title shown on the card. Unique within its category (the Essentials playbook refers to dorks by name). |
| `desc` | ✅ | string | One sentence on **why this matters** — what an attacker/defender learns. May contain [placeholders](#template-placeholders). |
| `sev` | ✅ | `"crit"` \| `"high"` \| `"med"` \| `"low"` \| `"info"` | Drives the badge, colour, and the `sev:` filter. See [Severity guide](#severity-guide). |
| `tags` | ✅ | string[] | Lowercase, kebab or single words. Used by the `tag:` filter, recipes, and the search index. Reuse existing tags where possible. |
| `engine` | ✅ | string | An engine **key** from the `ENGINES` registry (e.g. `g`, `gh`, `gra`, `sh`, `fo`, `cen`, `wa`). |
| `q` | ✅ | string | The query template. May contain [placeholders](#template-placeholders). |
| `links` | — | `{engine, q}[]` | Optional extra engine buttons for the same dork (e.g. run the same idea on Shodan *and* FOFA). |

### Getting `q` right

The query must use the **native syntax of its `engine`**:

- **Google** (`g`, `gnp`): `site:`, `filetype:`, `ext:`, `intext:`, `intitle:`, `inurl:`, `OR`, quotes.
- **GitHub code search** (`gh`): the current syntax — `path:`, `language:`, quoted literals. (Legacy `filename:`/`extension:` qualifiers were removed.)
- **grep.app** (`gra`): a **regex** (the engine runs it with `regexp=true`) — escape backslashes for JS strings (`\\.`).
- **GitHub Issues** (`gho`): issue-search qualifiers.
- **Shodan / FOFA / ZoomEye / Censys**: each has its own facet syntax (`port:`, `title=`, `cert.subject=`, `services.http...`). FOFA queries are base64-encoded automatically by the engine builder — write the plain query.
- **crt.sh** (`crt`): the certificate-transparency pattern, e.g. `%.{t}`.
- **Wayback** (`wa`): the query **is the full URL** to open (a `web.archive.org/cdx/...` URL) — the builder passes it through verbatim.

On the card the query is syntax-coloured automatically: quoted strings, `operator:` / `field=` prefixes and `OR` / `AND` / `NOT` / `&&` / `||` are recognised, grep.app queries are styled as regexes, and every spot where a placeholder was substituted is highlighted as the target. You do not need to do anything for that.

When in doubt, click the engine button after adding your dork and confirm the search actually returns what you intend.

## Template placeholders

`applyTemplate()` substitutes these in both `q` and `desc` at render time:

| Placeholder | Replaced with | Example (`target = example.com`) |
| --- | --- | --- |
| `{t}` | the full normalized target host | `example.com` |
| `{t_no_tld}` | the org label (registrable name without the TLD) | `example` |
| `{date}` | today's date, `YYYY-MM-DD` | `2026-07-10` |

Use `{t}` for `site:`/host matches, and `{t_no_tld}` for org-name pivots (Shodan `org:`, analytics-ID reuse, LinkedIn, etc.).

## Severity guide

Rate by **impact if the query hits**, not by likelihood:

| `sev` | Meaning | Examples |
| --- | --- | --- |
| `crit` | Direct credential/secret or full-account/cluster takeover | live API keys, tfstate, kubeconfig, exposed DB |
| `high` | Strong secret/asset exposure or clear attack path | webhooks, SAS tokens, exposed admin panels |
| `med` | Useful intel or a candidate attack surface | reflection params, org enumeration |
| `low` | Contextual / enrichment | version disclosure, job-ad stack mining |
| `info` | Purely informational | well-known endpoints |

## Adding a search engine

Add one entry to the `ENGINES` object. The key is what dorks reference via `engine`:

```js
xx: {
  name:"Example",
  color:"#3366cc",                 // swatch colour on the engine button
  url: q => `https://example.com/search?q=${enc(q)}`,
  auth:true,                       // optional: show a padlock (login required)
  opsec:false                      // optional: hidden in OPSEC mode (engine logs operator/target)
}
```

- `enc` is `encodeURIComponent`; `b64` base64-encodes (used by FOFA).
- Set `opsec:false` for engines that tie a query to your account (Shodan, FOFA, ZoomEye, Censys, Hunter.how, Netlas, Onyphe, BinaryEdge, urlscan) so OPSEC mode can hide them.
- Set `auth:true` if the engine requires a logged-in account to see results.
- Verify the URL builder against the engine's **current** query-parameter name and path.
- The engine shows up in the Help legend automatically.

## Essentials and recipes

**Essentials** is the home view: a short, ordered playbook defined by `ESSENTIAL_STEPS`. Each step has a `title` and a list of `refs`, and each ref is `[categoryId, dorkName]` pointing at an existing item in `DATA`:

```js
{ title:"Map the attack surface", refs:[
  ["dns","crt.sh wildcard JSON"], ["wayback","All historical URLs"], ["code","GitHub org enum"] ]},
```

Keep it short and opinionated — it is what a newcomer runs first. A ref whose dork was renamed or removed silently drops out, so if you rename a dork, update its ref too.

**Recipes** (`RECIPES`) are preset filters over the whole catalog. `label` and `desc` feed the Recipe menu and the view header; the filter itself is any combination of `filterTags` (dork has any of these tags), `onlyCats`, `onlyEngines`, `maxPerCat` (cap per category) and `extraDrawers` (recon tools the recipe pairs with).

## Touching the UI

- **Colours** come from the tokens at the top of `<style>`; both themes define the same set. Do not hard-code colours in rules — add or reuse a token so light and dark stay in step.
- **Icons** are symbols in the inline SVG sprite at the top of `<body>`. In markup use `<svg class="ic" aria-hidden="true"><use href="#i-name"/></svg>`; in script use `icon("name")`. Icon-only buttons need an `aria-label`.
- **What is on screen** is decided in one place, `viewGroups()`. Rendering, *Open all*, *Export* and the scope runner all read from it — add new filters there, not in the individual features.
- Controls must work from the keyboard and meet a 24×24 px target; state must not be conveyed by colour alone.
- Nothing may be requested from the network on page load — only on an explicit user action.

## Testing your change

There is no test runner — you verify in the browser:

1. Open `index.html` (or `python3 -m http.server` and visit it).
2. Confirm the page loads with **no console errors**.
3. Find your dork (browse its category or search for it).
4. Check the templated query looks right for `target = example.com`.
5. **Click each engine button** and confirm the search opens and is well-formed.
6. For UI changes, also check the light theme, a phone-width window, and that you can reach and operate the change with the keyboard alone.
7. Counts in the UI are computed from the data. If the catalog crosses a round number, update the "230+ dorks / 35+ engines" wording in `<head>` (title, meta, JSON-LD) and in the `<noscript>` block.

## Style

- Keep the single-file, zero-dependency architecture — no frameworks, no external scripts, no CDN assets (the CSP forbids them).
- Match the existing formatting of the `DATA`/`ENGINES` blocks (aligned columns are welcome but not required).
- Prefer reusing existing tags and engines over inventing near-duplicates.
- Keep `desc` to a single, specific sentence.

## Submitting a PR

1. Branch from the default branch.
2. Make your change and test it as above.
3. Describe **what the dork/engine finds** and **why it's still working** in the PR description.
4. One logical change per PR keeps review fast.

Thanks for contributing! 🔍
