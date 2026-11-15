<div align="center">

# 🔍 DorkOps

**A single-file OSINT dork & recon toolkit — 317 curated dorks across 41 search engines, every one scoped to your target, with progress tracking per target. Zero dependencies; runs entirely in your browser.**

[**▶ Live app**](https://dorks.bersec.me/) · [Report an issue](https://github.com/bersechub/dork-ops/issues) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md)

`Google` · `GitHub` · `grep.app` · `Shodan` · `FOFA` · `Censys` · `ZoomEye` · `urlscan` · `LeakIX` · `crt.sh` · `Wayback`

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshot-dark.png">
  <img alt="DorkOps — the Essentials view: a first-pass playbook of syntax-highlighted dorks for the target domain, with progress ticked off as you run them" src="docs/screenshot-light.png" width="880">
</picture>

</div>

---

## What is DorkOps?

DorkOps turns a target domain into a curated, one-click battery of reconnaissance queries. You type a domain once; every dork in the catalog is instantly templated with it and linked to the search engine that answers it. It is built for **bug-bounty hunters and authorized red teams** who want to map an attack surface and hunt exposed secrets fast, without leaving the browser.

The entire tool is **one `index.html` file** — no build step, no server, no tracking, no external requests except the searches *you* choose to open. Drop it on any static host (or open the file locally) and it works.

> ⚠️ **Authorized testing only.** Every query is passive and runs against third-party search engines, but the intent — mapping a target's exposure — is only legal against assets you own or are explicitly authorized to test. See [Responsible use](#responsible-use).

## What sets it apart

- **Every dork is about *your* target.** Scanner queries are scoped by the target's TLS certificate, reverse DNS and root domain; secret formats run as a regex *next to the target's domain* on GitHub. Nothing in the catalog returns "the whole internet".
- **It works today.** Engine links and query syntax were reviewed against the engines' current documentation in November 2026 — Censys Platform (CenQL), ZoomEye's base64 queries, GitHub's `path:` and regex search — and dead engines were removed. A lint keeps it that way: an engine nobody uses, or a dork that is not scoped, fails CI.
- **It tracks the session.** Running a dork ticks it off *for that target*. **Run next** steps through a playbook one key press at a time. Progress, pins and your own dorks stay in your browser.
- **It covers what gets exploited.** Exposed files and debug endpoints, modern secret formats (including the new prefixed Cloudflare, Vercel and Supabase keys), cloud buckets, AI / MCP leaks — and the VPN and edge appliances on CISA's Known Exploited Vulnerabilities list.

## Highlights

- **Essentials — a first-pass playbook.** The app opens on 19 hand-picked dorks in the order you would run them: map the attack surface → hunt leaked secrets → find exposed files & data → check the quick wins.
- **317 curated dorks** in **19 categories**, each with a **severity** (`crit` → `info`) and a one-line reason *why it matters*; 100 of them also run on a second or third engine (152 extra engine buttons in all).
- **41 search engines** — web search, code search, internet-wide scanners, certificate transparency, passive DNS, web archives, open-bucket and API-collection search.
- **Progress per target, Run next, My dorks** — see [Work a target](#4-work-a-target).
- **Readable queries.** Every dork is shown in full with syntax colouring (operators, strings, booleans, regexes) and your target highlighted wherever it was substituted.
- **A search DSL** over the catalog: free text, `tag:`, `sev:`, `engine:`, `cat:`, `is:todo`, quoted phrases, and `-exclusions`.
- **6 built-in recon tools:** favicon hash (MurmurHash3 + MD5), ASN lab, permutation generator, bug-bounty scope importer, client-side JS secret scanner, Wayback parameter-wordlist generator.
- **Exports** of exactly what is on screen, with the progress: Markdown checklist, JSON, CSV, or straight to the clipboard.
- **Dark and light themes, full keyboard control, shareable deep links, and a drag-to-install bookmarklet.**

## Quick start

DorkOps is a static file. Any of these work:

```bash
# 1. Just open it
open index.html            # macOS   (xdg-open on Linux)

# 2. Or serve it locally
python3 -m http.server 8080   # then visit http://localhost:8080

# 3. Or use the hosted version
# https://dorks.bersec.me/
```

There is nothing to install or build. To self-host, copy `index.html` (plus the optional `_headers`, `robots.txt`, `sitemap.xml`, `og-image.png`) to any static host — see [Deployment](#deployment).

## Usage

### 1. Set a target

Type a domain into the **Target** box (e.g. `example.com`). Paste anything — a full URL, `host:port`, a wildcard like `*.example.com` — and it is reduced to a bare, lower-cased host when you press Enter. Every visible dork re-templates live as you type. Targets you have used are offered as autocomplete, and the last one is restored the next time you open the app.

### 2. Start with Essentials, then browse or search

The app opens on **⭐ Essentials**: a short playbook that takes you from mapping the surface to the quick wins. From there:

- **🗂️ All dorks** lists the whole catalog under its category headings; each category is also one click away in the sidebar, grouped into *Web exposure*, *Secrets & code*, *Third parties*, *Infrastructure* and *People*.
- The **search box** (`/` to focus it) searches the whole catalog from Essentials and All dorks, and stays inside the category when you are in one. It is a small query language:

| Syntax | Matches | Example |
| --- | --- | --- |
| `word` | free text across name, description, tags, engine, query | `stripe` |
| `"exact phrase"` | quoted phrase | `"private key"` |
| `tag:x` | dorks carrying tag *x* | `tag:kev` |
| `sev:x` | severity (`crit`/`high`/`med`/`low`/`info`, or `c/h/m/l/i`) | `sev:crit` |
| `engine:x` | dorks that run on engine *x* (key or name) | `engine:gh` |
| `cat:x` | category id or label | `cat:devops` |
| `is:x` | `todo` / `done` for this target, `pinned`, `mine` | `is:todo sev:crit` |
| `-word`, `-tag:x` | **exclude** a word, or negate any operator | `s3 -wayback -tag:aws` |

Operators combine, e.g. `stripe sev:crit engine:gh -test`, and show up as removable chips under the title.

### 3. Filter

The bar above the results holds the filters, and stays pinned while you scroll:

- **Severity** — toggle `crit` / `high` / `med` / `low` / `info` on and off.
- **Recipe** — a curated preset over the whole catalog (see below).
- **OPSEC** — hides the engines that tie your queries to an account: the internet scanners (Shodan, FOFA, Censys, ZoomEye, Hunter.how, Netlas, Onyphe, FullHunt) and urlscan. A dork whose own engine is quiet stays; only its noisy buttons disappear. It is a per-machine safety setting and is never written to a shareable link.

| Recipe | What it shows |
| --- | --- |
| **First Pass** | Certificate, DNS and subdomain discovery, at most three dorks per category |
| **Bug Bounty Triage** | The findings that pay: exposed files, debug endpoints, API docs, leaked secrets, takeovers — at most four per category |
| **Perimeter** | VPN and edge appliances, exposed services and scanner intel (pairs well with the Favicon hash and ASN tools) |
| **AI Era** | LLM keys, vector databases, exposed model servers, MCP servers and agent configs |
| **Shadow IT** | Certificate pivots, platform deployments, SaaS tenants and developer tunnels |
| **No account needed** | Only dorks whose main engine works without a login |

### 4. Work a target

Each card shows the full query and a button for every engine it can run on (a padlock means that engine needs a login). Click one to open the search in a new tab — or let the app drive:

- **Run next** (`n`) opens the next dork you have not run yet for this target and ticks it off. Press it again for the one after. No pop-up storm, and you always know where you are.
- **The tick** on a card means *done for this target*. Running a dork sets it; click it to undo or to tick something off by hand.
- **The progress meter** in the filter bar opens a menu: *Hide done*, *Mark this view as done*, *Reset progress for this target*. The sidebar shows `done / total` per category, so you can see what is left across the whole catalog.
- **Open all** opens every dork in the current view, one tab each (asks first above 5, never more than 50 at once).

On a card you can also **copy the query** (icon in the query box), **copy the search URL** (link icon), **pin** the dork, or click a **#tag** to filter by it.

### 5. My dorks

**📌 My dorks** is your own view:

- **Pin** any dork from the catalog to keep it one click away.
- **Add your own**: name, query, engine, severity, tags. Use `{t}` for the target domain and `{t_no_tld}` for the organisation's label (`example` for `example.com`); a live preview shows the link that will open. Your dorks are searchable from anywhere and tracked like the rest.
- **Export** them (with your pins) as a JSON pack — a backup, or something to hand to a teammate — and **Import** a pack to merge it in. Imported content is treated as untrusted: a dork for an engine the app does not know is dropped, text is length-capped and shown as text only, and every link the app builds is `https://`.

### 6. Export

**Export** saves exactly what is on screen — after search, severity, recipe and OPSEC — as a **Markdown checklist** (with `[x]` for what is done), **JSON** or **CSV**, or copies the Markdown to the clipboard. Handy for pasting recon steps into a report or ticket.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `/` | Focus the search box |
| `n` | Run the next dork that is not done |
| `j` / `k` | Next / previous view |
| `c` | Copy the first visible query |
| `?` | Search syntax, shortcuts and the engine legend |
| `Esc` | Clear the search / close dialogs and panels |

Single-key shortcuts can be switched off in the help dialog.

### Deep links

The view lives in the URL hash, so it is shareable:

```
https://dorks.bersec.me/#cat=edge&target=example.com&sev=crit,high&filter=vpn
```

`cat` is `essentials`, `my`, `all` or a category id; `target`, `sev`, `filter` and `recipe` are optional. A link that names a view starts it clean — nothing from your last session leaks into it. Progress, pins and OPSEC mode are never part of a link.

### Bookmarklet

Drag the **Bookmarklet** link at the bottom of the sidebar to your bookmarks bar. Click it on any site and DorkOps opens with that site's hostname as the target.

## The recon toolbox

Open **Tools** in the top bar. Everything here runs locally in your browser.

| Tool | What it does |
| --- | --- |
| **Favicon hash** | Computes the Shodan MurmurHash3 and Censys MD5 of a favicon (URL fetch or local file) and builds Shodan / FOFA / ZoomEye / Censys pivot links |
| **ASN lab** | Jump-off links to BGP / ASN explorers, then Shodan / FOFA / Censys / Netlas pivots by ASN |
| **Permutations** | Generates dev / staging / alt-TLD / typo variants of the target (AlterX-light) |
| **Scope importer** | Parses a HackerOne `structured_scope` JSON, a Bugcrowd asset list or a plain domain list; "Run on all" runs the current view against every in-scope target |
| **JS recon** | A client-side LinkFinder / SecretFinder — paste or fetch a JS file, extract endpoints, secrets and revealing comments |
| **Param wordlist** | Fetches the Wayback CDX for the target, ranks the unique query parameters by frequency and downloads a wordlist for ffuf / Burp |

## Categories

<details>
<summary><b>All 19 categories</b> (click to expand)</summary>

| Category | Focus |
| --- | --- |
| **Web exposure** | |
| 📂 Exposed Files | Directory listings, `.env` and config files, database dumps, backups, logs, keys, exposed `.git`, confidential documents |
| 🧩 APIs, Panels & Debug | Swagger / OpenAPI, GraphQL, admin and login panels, staging hosts, Spring Actuator, Laravel, Symfony, Django, ASP.NET debug |
| 🗡️ Attack Vectors | Redirect, SSRF, LFI, XSS, SQLi, RCE and IDOR parameter candidates, OAuth / SAML / OIDC, WordPress, Drupal, Magento, AEM |
| 🪝 Subdomain Takeover | `can-i-take-over-xyz` fingerprints visible via Google |
| **Secrets & code** | |
| 🐙 Raw GitHub | `raw.githubusercontent.com` — Google-indexed raw file content (env, keys, tfstate, kubeconfig) |
| 🔑 Modern Secrets | Secret formats by prefix, as a target-scoped GitHub regex + a global grep.app hunt |
| 🧠 AI / LLM & Agents | Provider keys, vector DBs, exposed Ollama / Open WebUI / LiteLLM / Langflow, MCP servers, agent configs, chat share links |
| ⚙️ DevOps / Cloud Native | tfstate, kubeconfig, Helm, CI files, source maps, Firebase, Supabase; Kubernetes, etcd, Argo CD, Vault, Harbor on the target's hosts |
| 💻 Code & Supply Chain | GitHub org, `.env` files, internal hostnames, gists, analytics-ID pivots, registries, dependency confusion, SBOMs |
| **Third parties** | |
| 🤝 SaaS / Collaboration | Postman, Notion, Trello, Airtable, Confluence, Jira, Google Docs, Loom, paste sites, code sandboxes |
| 🛰️ PaaS, Tenants & Tunnels | Heroku / Vercel / Netlify / Pages, cloud app domains, ngrok, Firebase, SharePoint, Salesforce, Okta, Zendesk tenants |
| 🪣 Cloud Storage | GrayhatWarfare open-bucket search, S3, GCS, Azure Blob, DO Spaces, R2, Backblaze, Wasabi, OVH |
| **Infrastructure** | |
| 🪪 DNS / Cert / Subdomain | crt.sh, Cert Spotter, RapidDNS, HackerTarget, SecurityTrails, VirusTotal, OTX, urlscan, Wayback, CommonCrawl |
| 🏢 Org & Related Domains | ASN and netblocks, reverse WHOIS, BuiltWith relationships, other TLDs, certificates by organisation |
| 📚 Web Archive | Wayback CDX — historical URLs, sensitive extensions, archived API specs and JavaScript, params, `.git` |
| 🌐 Network & Service Intel | Shodan (with facet overviews), Censys, FOFA, ZoomEye, Hunter.how, Netlas, FullHunt, Onyphe, LeakIX; CDN origin discovery |
| 🚪 Edge & Remote Access | GlobalProtect, Ivanti, FortiGate, NetScaler, Cisco ASA, SonicWall, Check Point, F5, Exchange, SharePoint, vCenter, MOVEit… (CISA KEV) |
| 🏭 Exposed Services & ICS | Elasticsearch, MongoDB, Redis, SQL, MQTT, Jenkins, GitLab, TeamCity, Confluence, webmail, Modbus, S7, BACnet, cameras |
| **People** | |
| 👥 People & Jobs | Hunter.io, HIBP, LinkedIn, committer emails, job ads that disclose the internal stack |

</details>

## Privacy & security

- **No backend, no analytics, no cookies.** DorkOps never phones home, and nothing is requested when the page loads. The only network requests are the searches you explicitly open (in new tabs) and the fetches you trigger inside the recon tools. (One nuance: the first time you open a CommonCrawl dork, the app asks commoncrawl.org — the site you are about to visit — for its newest index name, and remembers it for a week.)
- **Local state only.** Your target history, progress, pins, own dorks, theme and filters are stored in `localStorage` on your machine. Nothing is synced; export *My dorks* if you want a backup.
- **OPSEC mode** hides the engines that would log your target against your account.
- A strict **Content-Security-Policy** ships in the page `<meta>` and is reinforced by security headers in [`_headers`](_headers) (`X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, HSTS, a restrictive `Permissions-Policy`).
- All outbound links use `rel="noopener noreferrer"` and `referrerpolicy="no-referrer"` so your DorkOps URL never leaks to the destination engine, and every link the app builds — including from dorks you typed or imported — is a plain `https://` URL.

Found a security issue? Please report it privately — see **[SECURITY.md](SECURITY.md)**.

## Development

There is no build. Two test scripts keep the single file honest:

```bash
node tests/catalog.test.mjs     # zero dependencies: lints every dork, engine, playbook reference and quoted number

npm install --no-save playwright && npx playwright install chromium     # once
node tests/ui.test.mjs          # 180+ checks driving the real page in headless Chromium
```

Both run in CI on every pull request.

## Deployment

DorkOps is designed for **Cloudflare Pages** but works on any static host (GitHub Pages, Netlify, S3, `nginx`, …).

1. Serve the repository root as the site root.
2. The included [`_headers`](_headers) file applies security and caching headers on Cloudflare Pages/Netlify.
3. Update the canonical URL, `og:url`, `sitemap.xml`, and `robots.txt` if you host on a different domain than `dorks.bersec.me`.

Because everything is one file, you can also just email `index.html` to a teammate or keep it on a USB stick for offline use — only the search links need connectivity.

## Contributing

Adding a dork is a one-object change to the `DATA` array. See **[CONTRIBUTING.md](CONTRIBUTING.md)** for the item schema, the engine registry, the template placeholders (`{t}`, `{t_no_tld}`, `{date}`), severity guidance, the Essentials playbook, and how to test your change. Found a dork that stopped working? There is an [issue template](https://github.com/bersechub/dork-ops/issues/new/choose) for that.

## Credits

Appliance and product fingerprints in *Edge & Remote Access* and *Exposed Services* follow [ProjectDiscovery's awesome-search-queries](https://github.com/projectdiscovery/awesome-search-queries); the exploited-in-the-wild references come from [CISA's KEV catalog](https://www.cisa.gov/known-exploited-vulnerabilities-catalog); several secret formats follow the [gitleaks](https://github.com/gitleaks/gitleaks) rule set. The classic Google dorks stand on two decades of the [Google Hacking Database](https://www.exploit-db.com/google-hacking-database).

## Responsible use

DorkOps is a **defensive and authorized-testing** tool. Use it only against:

- assets you own,
- targets inside an authorized penetration-testing engagement, or
- programs whose bug-bounty scope explicitly permits reconnaissance.

Do not use it to target systems without permission, to mass-harvest data, or to access exposed secrets you are not authorized to access. Finding a leaked credential does not authorize using it — report it through the appropriate disclosure channel. You are responsible for complying with all applicable laws and program rules.

## License

Released under the [MIT License](LICENSE).

---

<div align="center">
<sub>Passive recon · authorized targets only · queries run in your browser.</sub>
</div>
