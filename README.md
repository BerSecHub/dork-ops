<div align="center">

# 🔍 DorkOps

**A single-file OSINT dork & recon toolkit — 232 curated dorks across 38 search engines, zero dependencies, runs entirely in your browser.**

[**▶ Live app**](https://dorks.bersec.me/) · [Report an issue](https://github.com/bersechub/dork-ops/issues) · [Contributing](CONTRIBUTING.md)

`Google` · `GitHub` · `grep.app` · `Shodan` · `FOFA` · `Censys` · `ZoomEye` · `urlscan` · `LeakIX` · `crt.sh` · `Wayback`

</div>

---

## What is DorkOps?

DorkOps turns a target domain into a curated, one-click battery of reconnaissance queries. You type a domain once; every dork in the catalog is instantly templated with it and linkable to the right search engine. It is built for **bug-bounty hunters and authorized red teams** who want to map an attack surface and hunt exposed secrets fast, without leaving the browser.

The entire tool is **one `index.html` file** — no build step, no server, no tracking, no external requests except the searches *you* choose to open. Drop it on any static host (or open the file locally) and it works.

> ⚠️ **Authorized testing only.** Every query is passive and runs against third-party search engines, but the intent — mapping a target's exposure — is only legal against assets you own or are explicitly authorized to test. See [Responsible use](#responsible-use).

## Highlights

- **232 curated dorks** in **18 categories**, each tagged with a **severity** (`crit` → `info`), a short description of *why it matters*, and the engine best suited to run it.
- **38 search engines** wired in — web search, code search, internet-wide scanners, certificate transparency, passive DNS, and web archives — each dork links straight to the engine that answers it.
- **Modern secret coverage (2025–2026):** `sk-ant-`, `sk-proj-`, `ghp_`/`github_pat_`, `glpat-`, `sk_live_`, `hf_`, `r8_`, `lsv2_`, AWS `AKIA`, GCP service accounts, Azure SAS — plus DevOps leaks (tfstate, kubeconfig, Helm, ArgoCD), SaaS exposure (Notion, Airtable, Postman, Confluence), and **MCP / AI-agent** leaks.
- **Powerful search DSL** over the catalog: free text, `tag:`, `sev:`, `engine:`, `cat:`, quoted phrases, and `-exclusions`.
- **Recon recipes** — one-click presets that filter the catalog for a specific workflow (First Pass, Bug Bounty Triage, AI Era, Shadow IT, OPSEC-safe).
- **7 built-in recon tools:** favicon-hash lab (MurmurHash3 + MD5), ASN lab, permutation generator, bug-bounty scope importer, client-side JS secret scanner, Wayback parameter-wordlist generator, and a curated GHDB browser.
- **Exports:** JSON, Markdown, CSV, and a Markdown checklist to clipboard.
- **OPSEC mode** hides engines that log the operator or target (Shodan, FOFA, Censys, urlscan).
- **Deep-link routing, deep dark/light theming, full keyboard control, and a drag-to-install bookmarklet.**

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

There is nothing to install or build. To self-host, copy `index.html` (plus the optional `_headers`, `robots.txt`, `sitemap.xml`, `og-image.svg`) to any static host — see [Deployment](#deployment).

## Usage

### 1. Set a target

Type a domain into the **Target** box (e.g. `example.com`). The `⤵` button normalizes whatever you paste — it strips the scheme, path, `www.`, and wildcards down to a bare host. Targets you use are remembered in an autocomplete history. Every visible dork re-templates live as you type.

### 2. Browse or search the catalog

Pick a category from the sidebar, or search the whole catalog with the search box (`/` to focus it). The search bar is a small query language:

| Syntax | Matches | Example |
| --- | --- | --- |
| `word` | free text across name, description, tags, engine, query | `stripe` |
| `"exact phrase"` | quoted phrase | `"private key"` |
| `tag:x` | dorks carrying tag *x* | `tag:aws` |
| `sev:x` | severity (`crit`/`high`/`med`/`low`/`info`, or `c/h/m/l/i`) | `sev:crit` |
| `engine:x` | dorks that link to engine *x* (key or name) | `engine:gh` |
| `cat:x` | category id or label | `cat:devops` |
| `-word` | **exclude** anything matching *word* | `s3 -wayback` |

Operators combine, e.g. `stripe sev:crit engine:gra -test`. Active operators show as removable chips above the results. Severity pills in the sidebar filter independently.

### 3. Run the dorks

Each card shows the templated query and one or more engine buttons. Click a button to open that search in a new tab, or use:

- **Open visible ↗** — opens every dork in the current view (confirms above 5 tabs).
- **🎯 Crown Jewels** — opens the 10 highest-ROI dorks for the target in one batch.
- **⧉ Q** / **⧉ URL** on each card — copy the query text or the full engine URL.

### 4. Recon recipes

The **Recon recipe** dropdown applies a curated preset:

| Recipe | What it does |
| --- | --- |
| **First Pass (light)** | Cert/DNS discovery, a few dorks per category |
| **Bug Bounty Triage** | High-signal secret & config leaks (raw-GitHub, tfstate, S3, Postman…) |
| **AI Era** | Only the AI/LLM + MCP categories, opens the JS-recon tool |
| **Shadow IT** | Certificate/DNS/subdomain discovery, opens the permutation tool |
| **OPSEC-safe** | Only engines that don't log the operator/target |

### 5. Exports

Export the current (filtered) view as **JSON**, **Markdown**, or **CSV**, or copy a Markdown checklist to the clipboard (📋) — handy for pasting recon steps into a report or ticket.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `/` | Focus the search box |
| `Esc` | Clear search / close modals & panels |
| `j` / `k` | Next / previous category |
| `c` | Copy the first visible card's query |
| `?` | Open the help & engine legend |

### Deep links

State lives in the URL hash, so any view is shareable:

```
https://dorks.bersec.me/#cat=ai-llm&target=example.com&sev=crit,high&filter=openai
```

### Bookmarklet

Drag the **🔖 Bookmarklet** in the footer to your bookmarks bar. Click it on any site and DorkOps opens pre-loaded with that site's hostname as the target.

## The recon toolbox (🧰 Tools)

| Tool | What it does |
| --- | --- |
| 🧩 **Favicon Hash** | Computes the Shodan MurmurHash3 and Censys MD5 of a favicon (URL fetch or local file) and generates Shodan/FOFA/ZoomEye/Censys pivot links |
| 🛰️ **ASN Lab** | Jump-off links to BGP/ASN explorers, then pivots Shodan/FOFA/Censys/Netlas by ASN |
| 🧬 **Permutations** | Generates dev/staging/typo/alt-TLD permutations of the target (AlterX-light) |
| 📜 **Scope Importer** | Parses a HackerOne `structured_scope` JSON, Bugcrowd asset list, or a plain domain list; "Run on all" fans a view across every in-scope target |
| 🔬 **JS Recon** | Client-side LinkFinder/SecretFinder — paste or fetch JS, extract endpoints, secrets, and revealing comments (100% local regex) |
| 📅 **Param Wordlist** | Fetches the Wayback CDX for the target, extracts unique query parameters ranked by frequency, downloads a wordlist ready for ffuf/Burp |
| 📚 **GHDB** | Browse the Exploit-DB Google Hacking Database by category, or run curated still-working dorks against the current target |

## Categories

<details>
<summary><b>All 18 categories</b> (click to expand)</summary>

| Category | Focus |
| --- | --- |
| 🐙 Raw GitHub | `raw.githubusercontent.com` — Google-indexed raw file content (env, keys, tfstate, kubeconfig) |
| 🧠 AI / LLM Leaks | OpenAI/Anthropic/HF/Replicate keys, vector DBs, exposed Ollama/Open WebUI/LiteLLM |
| 🔑 Modern Secrets | Prefix-format secret scanning (a TruffleHog/Gitleaks-style rule pack) |
| ⚙️ DevOps / Cloud Native | tfstate, kubeconfig, Helm, ArgoCD, source maps, Sentry, Firebase, Supabase |
| 🤝 SaaS / Collaboration | Public Notion, Trello, Airtable, Postman, Confluence, Loom |
| 🌐 Network & Service Intel | Shodan/FOFA/ZoomEye/Censys/LeakIX/Onyphe asset intel |
| 🪪 DNS / Cert / Subdomain | crt.sh, DNSDumpster, SecurityTrails, VirusTotal, Phonebook, Wayback, CommonCrawl |
| 📚 Web Archive | Wayback CDX — historical URLs, sensitive extensions, params, archived `.git`/robots |
| 🐙 Code Search | GitHub, grep.app, Sourcegraph, searchcode, PublicWWW (analytics-ID pivots) |
| 🗡️ Attack Vectors | Open redirect, SSRF, LFI, XSS, SAML/OIDC, WordPress/Drupal/Magento, exposed `.git` |
| 🏭 ICS / IoT / Datastores | Modbus, MQTT, S7, RTSP cameras, exposed Elasticsearch/Mongo/Redis |
| 📦 Cloud Storage | S3, GCS, Azure Blob, DO Spaces, R2, Backblaze, Wasabi, OVH |
| 👥 People / Email | Hunter.io, HIBP, LinkedIn pivot, Phonebook |
| 🪝 Subdomain Takeover | `can-i-take-over-xyz` fingerprints visible via Google |
| 🤖 MCP / AI Agent Leaks | MCP servers, Claude Desktop config, AutoGPT/Cursor/Continue, LangSmith |
| 📦 SBOM / Dep Confusion | Exposed SBOMs and internal package patterns |
| 💼 Job Ad Recon | Job ads that disclose the internal tech stack |
| ☁️ CDN Origin Discovery | Pivot to the true origin behind Cloudflare/Akamai/Fastly |

</details>

## Privacy & security

- **No backend, no analytics, no cookies.** DorkOps never phones home. The only network requests are the searches you explicitly open (in new tabs) and the fetches you trigger inside the recon tools.
- **Local state only.** Your target history, theme, and last view are stored in `localStorage` on your machine.
- A strict **Content-Security-Policy** ships in the page `<meta>` and is reinforced by security headers in [`_headers`](_headers) (`X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, HSTS, a restrictive `Permissions-Policy`).
- All outbound links use `rel="noopener noreferrer"` and `referrerpolicy="no-referrer"` so your DorkOps URL never leaks to the destination engine.

## Deployment

DorkOps is designed for **Cloudflare Pages** but works on any static host (GitHub Pages, Netlify, S3, `nginx`, …).

1. Serve the repository root as the site root.
2. The included [`_headers`](_headers) file applies security and caching headers on Cloudflare Pages/Netlify.
3. Update the canonical URL, `og:url`, `sitemap.xml`, and `robots.txt` if you host on a different domain than `dorks.bersec.me`.

Because everything is one file, you can also just email `index.html` to a teammate or keep it on a USB stick for offline use — only the search links need connectivity.

## Contributing

Adding a dork is a two-line change to the `DATA` array. See **[CONTRIBUTING.md](CONTRIBUTING.md)** for the item schema, the engine registry, the template placeholders (`{t}`, `{t_no_tld}`, `{date}`), severity guidance, and how to test your change.

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
