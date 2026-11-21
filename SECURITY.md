# Security Policy

DorkOps is a **client-side, single-file** web tool. It has no backend, no database, and no user accounts: everything runs in your browser, and the only network requests are the searches you choose to open, the fetches you trigger inside the recon tools, and a library's data file (from the same site as the page) the first time you open that library. This keeps the attack surface small, but the project still takes security reports seriously.

## Reporting a vulnerability

Please **report suspected vulnerabilities privately** — do not open a public issue for anything exploitable.

- Preferred: open a [GitHub private security advisory](https://github.com/bersechub/dork-ops/security/advisories/new) on this repository.
- Alternative: open a normal issue **only** for non-sensitive, low-risk findings (e.g. a broken link or a cosmetic bug).

When reporting, please include:

- a description of the issue and its impact,
- steps to reproduce (a minimal payload or URL is ideal),
- the browser/OS you observed it on.

We aim to acknowledge reports within a few days. As a static app, fixes ship by updating `index.html` (or a data file) and redeploying — there are no version branches to backport to; **the latest published file is the only supported version.**

## In scope

- Cross-site scripting (XSS) or HTML injection in the app via any user-controlled input: the target domain, the indicator typed into *Investigate*, pasted bug-bounty scope JSON, pasted/fetched JS in the JS-recon tool, your own dorks (typed in, or imported from a "My dorks" pack someone shared with you), or the URL hash.
- The same through **a library data file** (`ghdb.js`, `fingerprints.js`, `hunt.js`). They are built from third-party sources and the page treats every row as untrusted: a row that gets markup onto the page, or script to run, is a vulnerability — and so is a CSV export that a spreadsheet would execute.
- Any way a dork, a library row or an Investigate source — from the catalog, typed in or imported — produces a link that is not a plain `https://` URL.
- Any way the indicator typed into *Investigate* ends up in storage.
- Content-Security-Policy bypasses or weaknesses.
- Any way the page leaks the user's data or DorkOps URL to a third party without their action (e.g. a referrer or beacon leak).
- Incorrect or unsafe outbound links (missing `rel="noopener"`, unexpected auto-navigation).

## Out of scope

- The third-party search engines DorkOps links to (Google, GitHub, Shodan, etc.) — report those to the respective vendors.
- Findings that require a already-compromised browser, malicious extension, or physical access.
- The *results* a dork returns. DorkOps does not host, store, or exfiltrate any target data; it only builds query URLs.
- Self-XSS that requires a user to paste attacker-supplied content into the recon tools knowing it is hostile (the JS-recon and scope tools intentionally accept arbitrary pasted text and render it as inert text).

## Responsible & authorized use

DorkOps is a **defensive and authorized-testing** tool. By using it you agree to run it only against:

- assets you own,
- targets within an authorized penetration-testing engagement, or
- bug-bounty programs whose scope explicitly permits reconnaissance.

Do not use DorkOps to target systems without permission, to mass-harvest data, or to access exposed secrets you are not authorized to access. Discovering a leaked credential does **not** authorize using it — report it through the appropriate disclosure channel. You are solely responsible for compliance with all applicable laws, program rules, and target terms of service.
