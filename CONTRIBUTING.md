# Contributing to DorkOps

Thanks for helping improve DorkOps! The whole tool is a single `index.html` file with **no build step and no dependencies**, so contributing is fast: edit the file, open it in a browser, and you're testing.

- [Ground rules](#ground-rules)
- [Project layout](#project-layout)
- [Adding a dork](#adding-a-dork)
- [The item schema](#the-item-schema)
- [Template placeholders](#template-placeholders)
- [Severity guide](#severity-guide)
- [Adding a search engine](#adding-a-search-engine)
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

| Section | Around line | What it holds |
| --- | --- | --- |
| `<style>` | top | The design-system CSS (dark + light tokens) |
| `ENGINES` | mid | The search-engine registry — one entry per engine |
| `DATA` | mid | The dork catalog — an array of categories, each with `items` |
| `TOP_PATTERNS`, `CROWN`, `GHDB_PICKS`, `RECIPES` | after `DATA` | Curated shortcuts and presets |
| App logic | rest | Parser, rendering, routing, recon tools, wiring |

To find a spot quickly, search the file for the banner comments (`/* ===== ... ===== */`).

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
| `name` | ✅ | string | Short, unique, human-readable title shown on the card. |
| `desc` | ✅ | string | One sentence on **why this matters** — what an attacker/defender learns. |
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
- **Wayback** (`wa`): the query **is the full URL** to open (e.g. a `web.archive.org/cdx/...` or `crt.sh/...` URL) — the builder passes it through verbatim.

When in doubt, click the engine button after adding your dork and confirm the search actually returns what you intend.

## Template placeholders

`applyTemplate()` substitutes these in `q` (and in `desc`) at render time:

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
  auth:true,                       // optional: show a 🔒 (login required)
  opsec:false                      // optional: hidden in OPSEC mode (engine logs operator/target)
}
```

- `enc` is `encodeURIComponent`; `b64` base64-encodes (used by FOFA).
- Set `opsec:false` for engines that log who searched or the target (Shodan, FOFA, Censys, urlscan) so OPSEC mode can hide them.
- Set `auth:true` if the engine requires a logged-in account to see results.
- Verify the URL builder against the engine's **current** query-parameter name and path.

## Testing your change

There is no test runner — you verify in the browser:

1. Open `index.html` (or `python3 -m http.server` and visit it).
2. Confirm the page loads with **no console errors**.
3. Find your dork (browse its category or search for it).
4. Check the templated query looks right for `target = example.com`.
5. **Click each engine button** and confirm the search opens and is well-formed.
6. If you touched counts, update the title/meta/JSON-LD in `<head>` and the search placeholder so the advertised numbers stay accurate.

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
