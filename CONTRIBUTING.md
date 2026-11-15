# Contributing to DorkOps

Thanks for helping improve DorkOps! The whole tool is a single `index.html` file with **no build step and no dependencies**, so contributing is fast: edit the file, open it in a browser, and you're testing.

- [Ground rules](#ground-rules)
- [Project layout](#project-layout)
- [Adding a dork](#adding-a-dork)
- [The item schema](#the-item-schema)
- [Getting the query right](#getting-the-query-right)
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

A good dork is:

- **high-signal** — it surfaces something a defender or authorized tester genuinely needs to know;
- **scoped to the target** — its query contains `{t}` or `{t_no_tld}`. A query that returns the whole internet (`port:9200 "cluster_name"`) is research, not recon on a target; the lint rejects it;
- **working today** — on the engine's *current* syntax. If you can, link the engine's documentation for the operators you use.

## Project layout

Everything the app needs lives in `index.html`:

| Section | Where | What it holds |
| --- | --- | --- |
| `<style>` | top | The design system: colour tokens for both themes, then one numbered section per UI area |
| Icon sprite + markup | start of `<body>` | Inline SVG icons (`#i-…`), the top bar, sidebar, filter toolbar and the tools panel |
| `ENGINES` | script | The search-engine registry — one entry per engine endpoint |
| `web()` `svc()` `key()` `any()` | before `DATA` | Small helpers that build families of scanner and secret dorks |
| `DATA` | script | The dork catalog — an array of categories, each with a `group` and its `items` |
| `ESSENTIAL_STEPS`, `RECIPES` | after `DATA` | The first-pass playbook and the preset filters |
| Personal data | script | Progress per target, pins and the user's own dorks (`localStorage` only) |
| App logic | rest | Search parser, `viewGroups()` (what is on screen), rendering, routing, recon tools, wiring |

To find a spot quickly, search the file for the banner comments (`/* ===== ... ===== */`); the comment at the top of the script lists them in order.

Next to it: `tests/catalog.test.mjs` (a zero-dependency lint of the catalog) and `tests/ui.test.mjs` (the UI regression suite).

## Adding a dork

1. Find the right category object in `DATA` (matched by `id`, e.g. `files`, `devops`, `edge`).
2. Add one object to that category's `items` array.
3. Run `node tests/catalog.test.mjs`, reload the page and confirm your dork renders and links correctly.

```js
{
  name:"Terraform state files",
  desc:"Terraform .tfstate files referencing the target — plaintext credentials and ARNs.",
  sev:"crit",
  tags:["terraform"],
  engine:"gh",
  q:'path:*.tfstate "{t}"'
}
```

The same idea on more engines goes into `links` — each becomes another button on the card:

```js
{
  name:"Directory listings",
  desc:"Auto-generated “Index of /” pages — the fastest way to everything else on this list.",
  sev:"high", tags:["exposure","listing"],
  engine:"g", q:'site:{t} intitle:"index of"',
  links:[{engine:"bg", q:'site:{t} intitle:"index of"'}, {engine:"ddg", q:'site:{t} intitle:"index of"'}]
}
```

### Scanner and secret dorks: use the helpers

Fingerprint dorks differ only in the fingerprint, so four helpers build them — you supply what is specific:

```js
// Something that serves a page: Shodan by TLS certificate, Shodan by reverse DNS, FOFA by root domain.
web("Palo Alto GlobalProtect", "GlobalProtect portals and gateways. KEV: CVE-2024-3400.", "high", ["edge","vpn","kev"],
    'http.title:"globalprotect"',      // Shodan fingerprint
    'title="globalprotect"'),          // FOFA fingerprint

// A bare TCP service (no certificate to match): Shodan by reverse DNS and by org, FOFA by root domain.
svc("Redis", "Open Redis: data, and often a path to code execution.", "crit", ["database"],
    'port:6379 "redis_version"', 'port="6379"'),

// A secret format: the regex on GitHub next to the target's domain, and bare on grep.app.
key("GitLab PAT (glpat-)", "GitLab personal access tokens.", "crit", ["gitlab"], "glpat-[A-Za-z0-9_-]{20,}"),

// Several products by page title: FOFA and Censys take a list of alternatives.
any("Grafana, Kibana & Prometheus", "Monitoring front-ends.", "med", ["monitoring","panel"], ["Grafana", "Kibana", "Prometheus Time Series"]),
```

For product fingerprints, prefer ones you can cite — a vendor advisory, or [ProjectDiscovery's awesome-search-queries](https://github.com/projectdiscovery/awesome-search-queries). If you mention a CVE as "KEV", check it against [CISA's catalog](https://www.cisa.gov/known-exploited-vulnerabilities-catalog).

## The item schema

| Field | Required | Type | Notes |
| --- | --- | --- | --- |
| `name` | ✅ | string | Short title shown on the card. **Unique within its category** — progress, pins and the Essentials playbook refer to a dork by `category id / name`, so renaming one resets its ticks. |
| `desc` | ✅ | string | One sentence on **why this matters** — what an attacker/defender learns. May contain [placeholders](#template-placeholders). |
| `sev` | ✅ | `"crit"` \| `"high"` \| `"med"` \| `"low"` \| `"info"` | Drives the badge, colour, and the `sev:` filter. See [Severity guide](#severity-guide). |
| `tags` | ✅ | string[] | Lowercase slugs (`a-z`, digits, `.`, `_`, `-`). Used by the `tag:` filter, recipes, and the search index. Reuse existing tags where possible. |
| `engine` | ✅ | string | An engine **key** from the `ENGINES` registry (e.g. `g`, `gh`, `sh`, `fo`, `cen`, `wa`). This is what *Run next* and *Open all* open. |
| `q` | ✅ | string | The query template, containing `{t}` or `{t_no_tld}`. |
| `links` | — | `{engine, q, label?}[]` | The same idea on other engines. `label` replaces the engine's name on the button when two buttons would otherwise read the same (`"Shodan · rDNS"`). |

A category is `{ id, group, label, icon, description, items }`. Categories of one `group` must be listed together; the group names become the sidebar's section headings.

## Getting the query right

The query must use the **native, current syntax of its engine**:

- **Google** (`g`): `site:`, `filetype:`, `ext:`, `intext:`, `intitle:`, `inurl:`, `OR`, quotes. Google reads at most **32 words** — the lint counts them. (`cache:`, `link:` and `info:` are gone.)
- **Bing** (`bg`): `site:`, `filetype:`, `ext:`, `intitle:`, `inbody:` — no `inurl:`. **DuckDuckGo** (`ddg`): `site:`, `intitle:`, `inurl:`, and `filetype:` for office documents and PDFs only. **Yandex** (`ya`): `site:`, `mime:` for file types, `|` for OR.
- **GitHub code search** (`gh`): `path:` (globs allowed), `language:`, `org:`, quoted literals, `(A OR B)`, `NOT`, and regular expressions between slashes — `"{t}" /sk_live_[A-Za-z0-9]{24,}/`. Legacy `filename:` / `extension:` qualifiers no longer exist. Code search needs a login.
- **grep.app** (`gra`): a **regex** (the engine runs it with `regexp=true`) — escape backslashes for JS strings (`\\.`).
- **Shodan** (`sh`): scope with `ssl:"{t}"` (certificate text) or `hostname:"{t}"` (reverse DNS). Numeric filters take comma lists (`port:3389,5900`); string filters do not. `shf` is facet analysis, written `facet:<property> <query>`.
- **FOFA** (`fo`): `domain="{t}"` is the root-domain scope; `title=`, `body=`, `icon_hash=`, `cert=`, `&&`, `||`, `!=`. The builder base64-encodes — write the plain query.
- **Censys** (`cen`): the Platform's CenQL — `host.services.cert.names: "{t}"`, `host.dns.names: "{t}"`, `host.services.endpoints.http.html_title:`, `web.hostname:`, `and` / `or` / `not`. The old `services.*` syntax belongs to Legacy Search, which Censys deprecated in 2026 — do not use it.
- **ZoomEye** (`ze`): `field="value"` — `domain="{t}"`, `ssl="{t}"`, `title=`. The builder base64-encodes.
- **crt.sh** (`crt`): the certificate-transparency pattern, e.g. `%.{t}`.
- **Wayback** (`wa`): the query **is the full URL** to open (a `web.archive.org/cdx/...` URL).

On the card the query is syntax-coloured automatically: quoted strings, `operator:` / `field=` prefixes, `/regex/` literals and `OR` / `AND` / `NOT` / `&&` / `||` are recognised, and every spot where a placeholder was substituted is highlighted as the target. You do not need to do anything for that.

When in doubt, click the engine button after adding your dork and confirm the search actually returns what you intend.

## Template placeholders

`applyTemplate()` substitutes these in both `q` and `desc` at render time:

| Placeholder | Replaced with | Example (`target = example.com`) |
| --- | --- | --- |
| `{t}` | the full normalized target host | `example.com` |
| `{t_no_tld}` | the org label (registrable name without the TLD) | `example` |
| `{date}` | today's date, `YYYY-MM-DD` | `2026-11-15` |

Use `{t}` for `site:`/host matches, and `{t_no_tld}` for org-name pivots (Shodan `org:`, analytics-ID reuse, LinkedIn, platform subdomains).

## Severity guide

Rate by **impact if the query hits**, not by likelihood:

| `sev` | Meaning | Examples |
| --- | --- | --- |
| `crit` | Direct credential/secret or full-account/cluster takeover | live API keys, tfstate, kubeconfig, exposed DB, heap dumps |
| `high` | Strong secret/asset exposure or clear attack path | webhooks, SAS tokens, exposed admin panels, an appliance on the KEV list |
| `med` | Useful intel or a candidate attack surface | API docs, reflection params, org enumeration |
| `low` | Contextual / enrichment | version disclosure, job-ad stack mining |
| `info` | Purely informational | well-known endpoints, security.txt |

## Adding a search engine

Add one entry to the `ENGINES` object. The key is what dorks reference via `engine`:

```js
xx: {
  name:"Example",
  color:"#3366cc",                 // swatch colour on the engine button
  url: q => `https://example.com/search?q=${enc(q)}`,
  auth:true,                       // optional: show a padlock (login required)
  opsec:false                      // optional: hidden in OPSEC mode (the engine ties queries to your account)
}
```

- `enc` is `encodeURIComponent`; `b64` base64-encodes (FOFA, ZoomEye).
- The URL must be `https://` — anything else is rendered as a dead link.
- **An engine needs at least one dork that uses it**; the lint fails on unused entries, so the engine count stays honest.
- A second endpoint of the same service is named `"Service · variant"` (`"Shodan · facets"`, `"GitHub · issues"`); the app counts services, not endpoints.
- Set `opsec:false` for engines that log queries against your account (the internet scanners, urlscan) and `auth:true` if results need a login.
- Verify the URL builder against the engine's **current** query-parameter name and path — open it.
- The engine shows up in the Help legend and in the "add your own dork" form automatically.

## Essentials and recipes

**Essentials** is the home view: a short, ordered playbook defined by `ESSENTIAL_STEPS`. Each step has a `title` and a list of `refs`, and each ref is `[categoryId, dorkName]` pointing at an existing item in `DATA`:

```js
{ title:"Map the attack surface", refs:[
  ["dns","crt.sh wildcard JSON"], ["wayback","All historical URLs"], ["code","GitHub org enum"] ]},
```

Keep it short and opinionated — it is what a newcomer runs first. The lint fails if a ref points at a dork that was renamed or removed.

**Recipes** (`RECIPES`) are preset filters over the whole catalog. `label` and `desc` feed the Recipe menu and the view header; the filter itself is any combination of `filterTags` (dork has any of these tags), `onlyCats`, `noAuth` (the dork's own engine needs no account), `maxPerCat` (cap per category) and `extraDrawers` (recon tools the recipe pairs with).

## Touching the UI

- **Colours** come from the tokens at the top of `<style>`; both themes define the same set. Do not hard-code colours in rules — add or reuse a token so light and dark stay in step.
- **Icons** are symbols in the inline SVG sprite at the top of `<body>`. In markup use `<svg class="ic" aria-hidden="true"><use href="#i-name"/></svg>`; in script use `icon("name")`. Icon-only buttons need an `aria-label`.
- **What is on screen** is decided in one place, `viewGroups()`. Rendering, *Run next*, *Open all*, *Export* and the scope runner all read from it — add new filters there, not in the individual features.
- **Overlays** (dialogs, the tools panel, the mobile drawer) go through `syncOverlays()`, which makes whatever is behind them inert and locks scrolling.
- **Anything a user types or imports** goes through `cleanDork()`, is rendered with `escHtml()` / `textContent`, and reaches a link only through `buildUrl()`, which returns `https://` URLs or nothing.
- Controls must work from the keyboard and meet a 24×24 px target; state must not be conveyed by colour alone.
- Nothing may be requested from the network on page load — only on an explicit user action.
- The social preview (`og-image.png`) is a 1200×630 render of `og-image.svg`. After editing the SVG, re-render it: `npx playwright screenshot --viewport-size "1200,630" "file://$PWD/og-image.svg" og-image.png`. The SVG asks for Inter and JetBrains Mono and falls back to system fonts.

## Testing your change

```bash
node tests/catalog.test.mjs
```

needs only Node and checks every dork (fields, target scope, engine, https link, Google's word limit), that no engine is unused, that the playbook and recipes point at things that exist, and that the numbers quoted in the page head, the README and the social preview image are still true.

Then look at it:

1. Open `index.html` (or `python3 -m http.server` and visit it).
2. Confirm the page loads with **no console errors**.
3. Find your dork (browse its category or search for it).
4. Check the templated query looks right for `target = example.com`.
5. **Click each engine button** and confirm the search opens and is well-formed.
6. For UI changes, also check the light theme, a phone-width window, and that you can reach and operate the change with the keyboard alone.

For UI changes, also run the browser suite (it drives the real page in headless Chromium):

```bash
npm install --no-save playwright && npx playwright install chromium     # once
node tests/ui.test.mjs
```

CI runs both on every pull request.

## Style

- Keep the single-file, zero-dependency architecture — no frameworks, no external scripts, no CDN assets (the CSP forbids them).
- Match the existing formatting of the `DATA`/`ENGINES` blocks (aligned columns are welcome but not required).
- Prefer reusing existing tags and engines over inventing near-duplicates.
- Keep `desc` to a single, specific sentence.

## Submitting a PR

1. Branch from the default branch.
2. Make your change and test it as above.
3. Describe **what the dork/engine finds** and **why it's still working** in the PR description — the template asks for both.
4. One logical change per PR keeps review fast.

Thanks for contributing! 🔍
