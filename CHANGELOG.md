# Changelog

All notable changes to DorkOps. The app is a single file with no build step, so "a release" is simply what is on the default branch.

## 0.6 — 2026-11-15

The catalog was reviewed against the engines' current documentation, every dork was scoped to the target, and the app learned to track a recon session.

### Work a target

- **Progress per target.** Every card has a tick. Running a dork — its own button, *Run next* or *Open all* — ticks it for the current target; click to undo. A meter in the filter bar, "done / total" in the sidebar and on each step, and a menu to hide what is done, mark the view as done or reset the target.
- **Run next** (button, or `n`): opens the next dork you have not run yet and ticks it off. One key press per step — no pop-up storm, no losing your place.
- **My dorks.** Pin the dorks you keep coming back to, and add your own: any engine, `{t}` placeholders, a live preview of the link. Export them as a JSON pack, import one from a teammate.
- **Search:** `is:todo`, `is:done`, `is:pinned`, `is:mine`; negated operators such as `-tag:aws` and `-sev:crit`.
- Exports carry the status: `[x]` in Markdown, a `done` column in CSV and JSON.

### Catalog — 317 dorks on 41 engines

- **Every dork is scoped to the target.** Scanner dorks used to return the whole internet (`port:9200 "cluster_name"`); they are now matched by the target's certificate, reverse DNS and root domain. Secret formats run as a GitHub regex next to the target's domain, with the global grep.app hunt as a second button.
- **Engines brought up to date.** Censys moved to the Platform and CenQL (`host.*` / `web.*` fields) — Censys deprecated Legacy Search in 2026. ZoomEye takes a base64 query and `field="value"`. Hunter.how, Onyphe, GreyNoise, LeakIX and NerdyData use their current deep links. Netlas uses `host:(…)`. GitHub code search is flagged as needing a login.
- **Removed:** BinaryEdge (shut down in 2025), searchcode (no longer a code search), DNSDumpster and Phonebook.cz (no working deep link), and four engines no dork used.
- **Added engines:** Shodan facet overviews, FullHunt, GrayhatWarfare, Postman search, SwaggerHub, Cert Spotter, RapidDNS, HackerTarget, HE BGP Toolkit, ViewDNS reverse WHOIS, BuiltWith, Docker Hub, npm, GitHub gists, OTX URLs — and Bing, DuckDuckGo and Yandex as alternates for the key web dorks.
- **New categories:** *Exposed Files* (listings, configs, dumps, backups, logs, keys, documents), *APIs, Panels & Debug* (Swagger, GraphQL, admin panels, staging hosts, Spring Actuator, Laravel, Symfony, Django, ASP.NET), *PaaS, Tenants & Tunnels*, *Org & Related Domains*, and *Edge & Remote Access* — VPN, remote-access and file-transfer appliances from CISA's Known Exploited Vulnerabilities catalog, with fingerprints taken from ProjectDiscovery's query set and CVE ids checked against KEV.
- **New secret formats:** Cloudflare (`cfut_` / `cfat_` / `cfk_`), Vercel (`vcp_` …), Supabase (`sb_secret_`), AWS Bedrock (`ABSK…`), the long 2026 GitHub app tokens, registry tokens (npm, PyPI, Docker Hub), Vault / Terraform Cloud / Doppler, SaaS tokens, database URLs with credentials, private-key blocks.
- **Merged:** MCP into *AI / LLM & Agents*, SBOM into *Code & Supply Chain*, job ads into *People & Jobs*, CDN origin into *Network & Service Intel*. Old `#cat=` links still work. Categories are grouped into five sidebar sections.
- A dork can offer the same idea on several engines, each button with its own label; OPSEC mode hides only the noisy ones.
- The secret-pattern and GHDB lists left the tools panel — they are ordinary dorks now: searchable, trackable, exportable.
- Recipes: **Perimeter** and **No account needed** are new; *OPSEC-safe* is gone (the OPSEC switch does that).

### Fixes

Most of these came out of an independent code review.

- The target is parsed, not stripped: `example.com:8443`, `user@host`, a query string or an IDN no longer become a different host.
- `engine:sh` means Shodan, not crt.sh; odd operator values and absurdly long queries can no longer throw.
- An empty search result names the filter that hides the matches and offers to lift it.
- A link that names a view starts it clean; `#target=` is consumed once.
- Focus no longer drops to the top of the page after an action that re-renders the list; content scrolled into view stops below the sticky bars; dialogs make the page behind them inert and lock scrolling without a sideways jump.
- Stored state is validated field by field; nothing in `localStorage` can blank the app.
- Anything typed in or imported goes through one cleaner, and every link the app builds is `https://` — a shared dork pack cannot inject markup or a `javascript:` URL.
- Tag chips keep the 24 × 24 px target size with any system font — caught by the first CI run, on a machine with different fonts.

### Project

- `tests/catalog.test.mjs` — a zero-dependency lint of the whole catalog; `tests/ui.test.mjs` — 180+ checks driving the real page in headless Chromium. Both run in CI.
- Issue and pull-request templates.
- A new social preview image (`og-image`) — the old one still quoted the 0.4 numbers. The lint now reads the numbers in it, and in the README, too. Its URL carries a version derived from the file, so the year-long cache on PNG files cannot serve an old preview.

## 0.5 — 2026-11-15

- **Essentials**: the app opens on a curated first-pass playbook instead of the whole catalog.
- A redesigned interface: one design system for a dark and a light theme (WCAG AA), a sticky filter bar, one Export menu, the recon tools in a slide-over panel, syntax-coloured queries with the target highlighted, an inline icon set, responsive from 360 px.
- Fixes: the sticky top bar, `{t}` in descriptions, crt.sh dorks, the `c` shortcut on Ctrl+C, exports that ignored the active recipe, the CommonCrawl index lookup.

## 0.4 and earlier

- The original catalog: 232 dorks in 18 categories on 39 engines, the search DSL, severity filter, recon recipes, OPSEC mode, exports, deep links, the bookmarklet and the recon tools; followed by an audit-driven pass on correctness, accessibility and SEO.
