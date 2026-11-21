# Changelog

All notable changes to DorkOps. The app is a single file with no build step, so "a release" is simply what is on the default branch.

## 0.7 — 2026-11-21

A calmer interface, three libraries that load on demand, and a first step from recon into threat intelligence.

### Interface

- **One reading column.** The content sits in a single centred column with larger type and more air; the filter bar lines up with it. Cards show the title, the reason, the query and the buttons — in that order, with less chrome around them.
- **Line icons instead of emoji**, a neutral palette in both themes (every text and control pair meets WCAG AA), and severity shown as a dot and a word rather than a coloured block.
- Long words and long queries wrap instead of widening the page, down to 320 px.

### Libraries

Big third-party collections now live next to the page as data files and load the first time their view is opened. The page itself stays one small file.

- **GHDB** — Exploit-DB's Google Hacking Database, 7,944 dorks. Each one is rewritten to stay on the target: a bare dork gets `site:{t}`; a top-level or wildcard scope (`site:.gov`, `site:*.edu.*`) becomes the target; a named third party keeps its `site:` and gets the target as a phrase; `site:login.*.*` becomes `site:login.{t}`.
- **Fingerprints** — how 2,766 products show up on Shodan, FOFA and Google (ProjectDiscovery's awesome-search-queries), tied to the target by certificate, root domain or `site:`.
- **Hunt** — 174 published fingerprints of adversary infrastructure (below).
- **Best first, by rules you can read.** `tools/update-libraries.mjs` downloads the sources, ranks them and writes the files. GHDB opens on 500 top picks — a quota per GHDB category, scored on what a hit is worth, how recent the dork is and how widely it applies. Fingerprints opens on the products on CISA's Known Exploited Vulnerabilities list, ransomware first. The lint re-runs the ranking against the committed files.
- One menu per library — *Top picks*, *Everything*, its own categories — and a search that always goes through the whole library. Rows are ticked, run and exported like any dork; **+** saves one to *My dorks*.
- A catalog search ends with *Search the libraries too*, which carries the search over.
- The data files are treated as untrusted: every row is type- and size-checked, and everything is rendered as text.
- A scheduled workflow refreshes the libraries every Monday and offers the result as a pull request; it never merges.

### Threat intel

- **Investigate.** Type an indicator — a domain, an IP address, a file hash, an e-mail address, or the name of a threat actor or malware family — and get five questions (*Is it already known? What has it done? Who is behind it? What else is connected? Where else does it turn up?*), each with the sources that answer it. 59 services; every address was checked against the service itself. Defanged indicators (`hxxp://evil[.]example`, `1.2.3[.]4`) are understood. With nothing typed, the target is the indicator.
- The indicator is kept in the tab and the address bar, never in storage. People-search engines, data brokers and username look-ups are left out on purpose, and the lint keeps them out.
- **Hunt.** Published fingerprints of C2 frameworks, RATs, malware panels and phishing kits for Shodan, Censys and FOFA. Nothing was written here: each row is copied from a public source, links to it and says when it was published. Noisy fingerprints and ones behind a paid plan are labelled, and neither is among the top picks. They search the whole internet, not the target.

### Fixes

- A CSV export defuses cells that a spreadsheet would run as a formula.
- The social preview image URL carries a version, so caches cannot serve an old image.

### Licences

- The app stays MIT. `ghdb.js` is GPL-2.0, as the repository it comes from (`ghdb.LICENSE.md`); `fingerprints.js` is MIT with the KEV catalog under CC0 (`fingerprints.LICENSE.md`); `hunt.js` reproduces published queries with attribution (`hunt.SOURCES.md`).

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
