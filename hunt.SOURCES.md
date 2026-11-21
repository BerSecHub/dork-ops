# Where the Hunt fingerprints come from (`hunt.js`)

`hunt.js` is a compilation made for DorkOps: fingerprints of adversary infrastructure — C2 frameworks, RATs,
malware panels, phishing kits — as queries for Shodan, Censys and FOFA. **None of them was written here.** Every
query was copied, character for character, from a public source, and every row in the app links to that source.
The hand-kept list is `tools/hunt-sources.json`; `tools/update-libraries.mjs hunt` ranks it and writes `hunt.js`.

The queries are short strings their authors published for others to use. They are reproduced with attribution
and a link, not relicensed: the sources keep whatever terms their authors chose. If you are one of the authors
and want a row changed or removed, open an issue.

## Sources

| Label in the app | Source |
|---|---|
| C2-Tracker | montysecurity, [C2-Tracker](https://github.com/montysecurity/C2-Tracker) — `tracker.py` (archived in April 2026) |
| BushidoUK list | BushidoUK, [OSINT-SearchOperators](https://github.com/BushidoUK/OSINT-SearchOperators) — `ShodanAdversaryInfa.md` |
| lothos612 list | lothos612, [shodan](https://github.com/lothos612/shodan) — "C2 Infrastructure" |
| nuclei-templates | ProjectDiscovery, [nuclei-templates](https://github.com/projectdiscovery/nuclei-templates) — the search queries in template metadata |
| awesome-search-queries | ProjectDiscovery, [awesome-search-queries](https://github.com/projectdiscovery/awesome-search-queries) |
| M. Koczwara | Michael Koczwara — "Hunting Cobalt Strike C2 with Shodan", "Hunting C2 with Shodan and Censys", "Hunting Malicious Infrastructure — Headers and Hardcoded/Static Strings" |
| Embee Research | Embee Research — "Threat Intelligence Query Examples", "Practical Queries for Identifying Malware Infrastructure With FOFA", "How To Track Quasar Rat C2 Infrastructure Using TLS Certificates" |
| Gi7w0rm | Gi7w0rm — "The curious case of the 7777-Botnet" |
| Censys blog | Censys — posts on Cobalt Strike, Mythic, AdaptixC2, Vshell, AsyncRAT and NetSupport Manager |
| Censys docs | Censys documentation — "Threat Data", "Open Directory Data and Threats" |
| Censys Community | Censys Community — "Cool Query of the Week" threads |
| Shodan changelog | The Shodan Book — "Shodan Update: August 2026" |
| Shodan blog | Shodan — "Deep Dive: Malware Hunter" |
| FOFA guide | FofaInfo, [Awesome-FOFA](https://github.com/FofaInfo/Awesome-FOFA) — "A Comprehensive Guide to Threat Intelligence Discovery Using FOFA" |

## What was checked, and what was not

- **Checked:** that each query appears, as written, in the source named with it (November 2026).
- **Not checked:** what a query returns today. Fingerprints go stale — operators change defaults, engines rename
  fields. A row shows when it was published, and the ranking prefers what a public list still carried recently.
- **Known to be noisy** rows say so on the card (for instance JARM hashes, which identify a TLS stack rather than
  a product). Rows that need a paid plan say that too.
- Left out of the compilation: queries in Censys's legacy syntax (Censys announced the retirement of Legacy Search for September 2026), generic
  strings that mostly match unrelated hosts, and tools that are not adversary infrastructure (scanners, analysis
  frameworks).

A hit is a lead, not a verdict: a server that matches a fingerprint may be a researcher's lab, a red team's
exercise or a honeypot.
