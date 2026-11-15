// Fetches the libraries DorkOps keeps outside index.html and ranks them, best first.
// Zero dependencies, Node 18+.
//
//   node tools/update-libraries.mjs                    every library, from its official source
//   node tools/update-libraries.mjs ghdb               just one (ghdb | fingerprints)
//   node tools/update-libraries.mjs --from some/dir    read ghdb.xml, QUERIES.yaml and kev.json from a folder instead of downloading
//
//   ghdb.js          Exploit-DB's Google Hacking Database — ghdb.xml, GNU GPL v2.0 (ghdb.LICENSE.md)
//   fingerprints.js  ProjectDiscovery's awesome-search-queries — QUERIES.yaml, MIT (fingerprints.LICENSE.md),
//                    ranked with CISA's Known Exploited Vulnerabilities catalog (CC0 1.0)
//
// Both files are data only. The rest of this project is MIT.
//
// "Best" is not an opinion buried in the data: it is the handful of rules in rankGhdb() and rankFingerprints()
// below, and tests/catalog.test.mjs re-runs them against the files in the repository. Each file lists its rows
// best first; the first `picks` of them are the top picks a view opens on.
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('..', import.meta.url);
const SOURCES = {
  ghdb: 'https://gitlab.com/exploit-database/exploitdb/-/raw/main/ghdb.xml',
  queries: 'https://raw.githubusercontent.com/projectdiscovery/awesome-search-queries/main/QUERIES.yaml',
  kev: ['https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
        'https://raw.githubusercontent.com/cisagov/kev-data/develop/known_exploited_vulnerabilities.json']      // CISA's own mirror
};
const clean = (s, max) => String(s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/* ============================================================
 * GHDB
 * ============================================================ */
// The dump is flat and regular, so it is read with two regexes instead of an XML parser: no entity expansion,
// no external references, nothing to configure.
const ENT = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'" };
const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|quot|amp|lt|gt|apos);/gi, (m, e) => {
  if (e[0] !== '#') return ENT[e.toLowerCase()];
  const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  return cp > 31 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : ' ';
});
// "Â©" is "©" whose UTF-8 bytes were read as Windows-1252 and saved again — sometimes twice. Undo it while the
// text still looks that way and decodes cleanly; otherwise leave it exactly as published.
const CP1252 = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';
function unmojibake(s) {
  for (let pass = 0; pass < 3 && /[ÃÂâ]/.test(s); pass++) {
    const bytes = [];
    for (const ch of s) {
      const cp = ch.codePointAt(0), i = CP1252.indexOf(ch);
      if (i >= 0) bytes.push(0x80 + i); else if (cp < 256) bytes.push(cp); else return s;      // not single-byte text: leave it
    }
    let out;
    try { out = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes)); } catch (e) { return s; }
    if (out === s) return s;
    s = out;
  }
  return s;
}
function ghdbQuery(q) {
  q = clean(q, 2000);
  if (/^https?:\/\/(www\.)?google\.[a-z.]+\//i.test(q)) {                 // a search URL instead of the dork
    const m = q.match(/[?&#]q=([^&#]*)/);
    if (!m) return '';
    try { q = decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (e) { return ''; }
  }
  return clean(unmojibake(q.replace(/^#\s*(google\s+)?(dork|description)\s*:\s*/i, '')), 2000);
}
// → [{ id, date: 'yyyy-mm-dd', cat, author, q }]
export function parseGhdb(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('unexpected DOCTYPE / ENTITY declaration in the GHDB dump — refusing to parse it');
  const field = (entry, name) => { const m = entry.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)); return m ? decode(m[1]) : ''; };
  const rows = [], skipped = [];
  for (const [, entry] of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const id = Number(field(entry, 'id').trim()), date = field(entry, 'date').trim();
    const cat = clean(field(entry, 'category'), 80), author = clean(unmojibake(field(entry, 'author')), 60) || 'anonymous';
    const q = ghdbQuery(field(entry, 'query'));
    if (!Number.isInteger(id) || id <= 0 || !/^\d{4}-\d\d-\d\d$/.test(date) || !cat || !q || q.length > 300) { skipped.push(id || '?'); continue; }
    rows.push({ id, date, cat, author, q });
  }
  if (rows.length < 5000) throw new Error(`only ${rows.length} GHDB entries parsed — the dump's format has probably changed`);
  if (new Set(rows.map(r => r.id)).size !== rows.length) throw new Error('duplicate GHDB ids in the dump');
  return { rows, skipped };
}

// ---- What makes a GHDB dork one of the best?
// 1. what a hit is worth: GHDB's own category                                                  0–40
const GHDB_WORTH = {
  'Files Containing Passwords': 40, 'Files Containing Juicy Info': 34, 'Sensitive Directories': 34, 'Files Containing Usernames': 30,
  'Vulnerable Files': 26, 'Footholds': 26, 'Network or Vulnerability Data': 24, 'Error Messages': 22, 'Vulnerable Servers': 20,
  'Pages Containing Login Portals': 16, 'Sensitive Online Shopping Info': 10, 'Various Online Devices': 10, 'Web Server Detection': 8,
  'Advisories and Vulnerabilities': 4
};
// 2. how current it is: nothing for anything older than 2010, full marks for the newest year     0–25
// 3. how widely the pattern applies: a directory listing, a sensitive file type, a secret, a telling path   0–35
const SIGNAL = [
  [12, /index[ .]of/i],
  [10, /\b(?:ext|filetype):\s?"?(?:env|sql|bak|old|backup|log|conf|cnf|cfg|ini|key|pem|ppk|pfx|p12|kdbx|db|sqlite3?|dump|tar|tgz|gz|zip|rar|7z|swp|csv|xlsx?|json|ya?ml|properties|htpasswd|git|svn)\b/i],
  [10, /pass(?:word|wd)?|pwd|credential|secret|token|api[_-]?key|private key|BEGIN (?:RSA|OPENSSH|PGP|DSA|EC)|aws_|authorization|connectionstring/i],
  [6, /inurl:\S*(?:admin|login|config|backup|\.git|\.env|wp-config|phpinfo|debug|dump|upload|private|internal|swagger|api)/i]
];
// 4. what makes it unlikely to work on a given target
const FLAW = [
  [20, q => (q.match(/"/g) || []).length % 2 === 1],                                   // broken quoting
  [12, q => /powered by|copyright|©|\bv(?:ersion)?\s?\d+\.\d+/i.test(q)],               // tied to one product or one version
  [10, q => q.length < 10]                                                             // too vague to mean anything
];
// The top picks are not simply the 500 highest scores — that would be passwords and nothing else. Each GHDB
// category contributes its best, in proportion to what a hit is worth.
export const GHDB_QUOTA = {
  'Files Containing Passwords': 90, 'Files Containing Juicy Info': 90, 'Sensitive Directories': 70, 'Pages Containing Login Portals': 50,
  'Vulnerable Files': 30, 'Footholds': 30, 'Network or Vulnerability Data': 30, 'Error Messages': 30, 'Files Containing Usernames': 25,
  'Vulnerable Servers': 25, 'Various Online Devices': 10, 'Web Server Detection': 10, 'Sensitive Online Shopping Info': 5,
  'Advisories and Vulnerabilities': 5
};
// rows: [{ id, date, cat, q }] → { rows (best first, each with .score and .pick), picks }
export function rankGhdb(rows) {
  const newest = Math.max(...rows.map(r => +r.date.slice(0, 4)));
  const key = r => r.q.toLowerCase().replace(/\s+/g, ' ');
  const original = new Map();                                    // the same dork submitted twice: the later entry stands, the others sink
  for (const r of rows) if (!original.has(key(r)) || original.get(key(r)) < r.id) original.set(key(r), r.id);
  const scored = rows.map(r => {
    let s = GHDB_WORTH[r.cat] || 0;
    s += Math.round(25 * Math.max(0, Math.min(1, (+r.date.slice(0, 4) - 2010) / Math.max(1, newest - 2010))));
    s += Math.min(35, SIGNAL.reduce((n, [pts, re]) => n + (re.test(r.q) ? pts : 0), 0));
    s -= FLAW.reduce((n, [pts, is]) => n + (is(r.q) ? pts : 0), 0);
    const dup = original.get(key(r)) !== r.id;
    return { ...r, dup, score: Math.max(0, Math.min(100, dup ? s - 40 : s)) };
  });
  const order = (a, b) => b.score - a.score || (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id);
  scored.sort(order);
  const left = { ...GHDB_QUOTA };
  for (const r of scored) r.pick = !r.dup && left[r.cat] > 0 && (left[r.cat]--, true);
  const picks = scored.filter(r => r.pick), rest = scored.filter(r => !r.pick);
  return { rows: [...picks, ...rest], picks: picks.length };
}

function ghdbFile(ranked, today) {
  const { rows, picks } = ranked;
  const count = new Map(), authorsBy = new Map();
  for (const r of rows) { count.set(r.cat, (count.get(r.cat) || 0) + 1); authorsBy.set(r.author, (authorsBy.get(r.author) || 0) + 1); }
  const cats = [...count.keys()].sort();
  const authors = [...authorsBy.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(e => e[0]);   // most frequent first: short indexes
  const ci = new Map(cats.map((c, i) => [c, i])), ai = new Map(authors.map((a, i) => [a, i]));
  const meta = { v: today, count: rows.length, picks, newest: rows.reduce((m, r) => (r.date > m ? r.date : m), '') };
  const js = `/* Google Hacking Database (GHDB) — a snapshot for the GHDB view of DorkOps. Data only; generated, do not edit.
 *
 * Source:   ghdb.xml from the Exploit Database repository, https://gitlab.com/exploit-database/exploitdb
 *           The GHDB is maintained by OffSec (https://www.exploit-db.com/google-hacking-database);
 *           each dork is the work of the author recorded with it.
 * Licence:  GNU General Public License v2.0, as the repository it comes from — see ghdb.LICENSE.md.
 * Changes:  reduced to id, date, category, author and query; search URLs reduced to the query; double-encoded
 *           text decoded; whitespace collapsed; ranked — the first ${picks} rows are the top picks, the rest
 *           follow best first. Made by tools/update-libraries.mjs on ${today}.
 *
 * rows: [GHDB id, date as yyyymmdd, index into cats, index into authors, query] */
(window.DORKOPS_LIB || function(){})("ghdb", {
"v":${JSON.stringify(meta.v)},"count":${meta.count},"picks":${meta.picks},"newest":${JSON.stringify(meta.newest)},
"cats":${JSON.stringify(cats)},
"authors":${JSON.stringify(authors)},
"rows":[
${rows.map(r => JSON.stringify([r.id, Number(r.date.replace(/-/g, '')), ci.get(r.cat), ai.get(r.author), r.q])).join(',\n')}
]});
`;
  return { js, meta, cats: cats.map(c => [c, count.get(c)]) };
}

/* ============================================================
 * Fingerprints
 * ============================================================ */
// QUERIES.yaml is a flat list (name, vendor, type, engines → platform, queries), read line by line.
const scalar = v => {
  v = v.trim();
  if (v.length > 1 && v[0] === "'" && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  if (v.length > 1 && v[0] === '"' && v.endsWith('"')) { try { return JSON.parse(v); } catch (e) { return v.slice(1, -1); } }
  return v;
};
// → [{ name, vendor, engines: { shodan: [...], fofa: [...], google: [...] } }]
export function parseQueries(yaml) {
  const out = [];
  let cur = null, plat = null;
  for (const line of yaml.split(/\r?\n/)) {
    let m;
    if ((m = /^- name:(.*)$/.exec(line))) { cur = { name: scalar(m[1]), vendor: '', engines: {} }; out.push(cur); plat = null; }
    else if (!cur) continue;
    else if ((m = /^  vendor:(.*)$/.exec(line))) cur.vendor = scalar(m[1]);
    else if ((m = /^    - platform:(.*)$/.exec(line))) { plat = scalar(m[1]).toLowerCase(); cur.engines[plat] = cur.engines[plat] || []; }
    else if ((m = /^        - (.*)$/.exec(line)) && plat) cur.engines[plat].push(scalar(m[1]));
  }
  if (out.length < 1000) throw new Error(`only ${out.length} products parsed from QUERIES.yaml — its format has probably changed`);
  return out;
}
// One query per engine: the most specific kind there is. Anything a scanner would not accept, or that says
// nothing about the product (a bare port, a bare word), is left out.
const usable = q => q.length >= 4 && q.length <= 200 && !/[\u0000-\u001f\u007f]/.test(q) && (q.match(/"/g) || []).length % 2 === 0;
const PREFER = {
  shodan: [/http\.favicon\.hash:/, /http\.title:/, /http\.html:/, /http\.component:/, /product:/, /ssl[.:]/],
  fofa: [/icon_hash=/, /title=/, /body=/, /app=/, /header=/, /[a-z_]+=/],
  google: [/intitle:/, /inurl:/, /intext:/]
};
const REJECT = { shodan: /&&|\|\||cpe:/, fofa: /^$/, google: /&&|\|\||http\.|html:/ };       // Shodan has no boolean operators; cpe: needs a paid plan
function best(list, engine, name) {
  const ok = (list || []).map(q => clean(q, 400)).filter(q => usable(q) && !REJECT[engine].test(q));
  const says = name.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4);       // of several candidates, the one that names the product
  for (const re of PREFER[engine]) {
    const hits = ok.filter(q => re.test(q));
    if (hits.length) return hits.find(q => says.some(w => q.toLowerCase().includes(w))) || hits[0];
  }
  return '';
}
// A product is "on the KEV list" when CISA lists the same vendor and every word of the product's name is a
// word of the KEV product ("netscaler_gateway" ⊂ "NetScaler ADC and NetScaler Gateway"). Deliberately strict:
// a product that is missed is merely unranked; one that is wrongly matched would carry someone else's CVEs.
const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const words = s => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
export function joinKev(products, kev) {
  const byVendor = new Map();
  for (const v of kev.vulnerabilities || []) {
    if (!v || typeof v.vendorProject !== 'string' || typeof v.product !== 'string' || !/^CVE-\d{4}-\d+$/.test(v.cveID) || !/^\d{4}-\d\d-\d\d$/.test(v.dateAdded)) continue;
    const k = norm(v.vendorProject);
    if (!byVendor.has(k)) byVendor.set(k, []);
    byVendor.get(k).push({ cve: v.cveID, date: v.dateAdded, w: words(v.product), ransom: v.knownRansomwareCampaignUse === 'Known' });
  }
  return products.map(p => {
    const nw = [...words(p.name)];
    const hits = nw.some(w => w.length >= 3) ? (byVendor.get(norm(p.vendor)) || []).filter(v => nw.every(w => v.w.has(w))) : [];
    const latest = hits.reduce((m, v) => (!m || v.date > m.date || (v.date === m.date && v.cve > m.cve) ? v : m), null);
    return { ...p, kev: hits.length, cve: latest ? latest.cve : '', kevDate: latest ? latest.date : '', ransom: hits.some(v => v.ransom) };
  });
}
// The source labels each query set with a vendor and a product, and now and then the label is the platform an
// application runs on rather than the application the query finds ("microsoft / windows" on a query for some
// file-transfer app). A KEV entry is only attached when the label is believable:
//   · the product is something a scanner can see, not an operating system, a runtime or a desktop program, and
//   · the query either is a hash (a favicon cannot be second-guessed) or names the product or its vendor.
const PLATFORM = /^(windows(_.*)?|linux(_kernel)?|kernel|android|macos|mac_os_x|ios|iphone_os|php|\.net(_framework|_core)?|jre|jdk|java(_se)?|node\.js|python|ruby|perl|openssl|glibc|office|excel|word|powerpoint|outlook|internet_explorer|edge(_chromium)?|chrome|chromium|firefox|safari|flash_player|acrobat(_reader)?|reader|sql_server|access)$/;
const GENERIC = new Set(['server', 'manager', 'system', 'systems', 'cloud', 'enterprise', 'software', 'project', 'platform', 'service', 'services', 'application',
  'applications', 'framework', 'firmware', 'device', 'devices', 'router', 'control', 'management', 'security', 'center', 'suite', 'client', 'portal', 'login',
  'admin', 'core', 'open', 'data', 'network', 'networks', 'http', 'https', 'html', 'title', 'body', 'product', 'intitle', 'inurl', 'web', 'the', 'and', 'for']);
function believable(r) {
  if (PLATFORM.test(r.name.toLowerCase().replace(/ /g, '_'))) return false;
  const text = [r.sh, r.fo, r.g].join(' ').toLowerCase();
  if (/favicon\.hash|icon_hash|html_hash|headers_hash/.test(text)) return true;
  const flat = text.replace(/[^a-z0-9]+/g, ' '), tight = flat.replace(/ /g, '');
  const toks = v => v.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !GENERIC.has(w));
  const name = toks(r.name), vendor = toks(r.vendor);
  return name.some(w => flat.includes(w)) || (name.length > 0 && tight.includes(name.join(''))) || vendor.some(w => flat.includes(w));
}

// ---- What makes a fingerprint one of the best? The product is on CISA's Known Exploited Vulnerabilities list
// and a scanner can find it. Among those: used by ransomware first, then more KEV entries, then the most recent.
// Everything else follows by how many engines can look for it, then by name.
// rows: [{ name, vendor, sh, fo, g, kev, cve, kevDate, ransom }] → { rows (best first, each with .pick), picks }
export function rankFingerprints(rows) {
  const engines = r => (r.sh ? 1 : 0) + (r.fo ? 1 : 0) + (r.g ? 1 : 0);
  const label = r => r.vendor + '/' + r.name;
  const ranked = rows.map(r => ({ ...r, pick: r.kev > 0 && !!(r.sh || r.fo) }));
  ranked.sort((a, b) => (b.pick - a.pick)
    || (a.pick ? (b.ransom - a.ransom) || (b.kev - a.kev) || (a.kevDate < b.kevDate ? 1 : a.kevDate > b.kevDate ? -1 : 0) : engines(b) - engines(a))
    || (label(a) < label(b) ? -1 : label(a) > label(b) ? 1 : 0));
  return { rows: ranked, picks: ranked.filter(r => r.pick).length };
}
export function buildFingerprints(yaml, kev) {
  const seen = new Set(), rows = [];
  for (const p of parseQueries(yaml)) {
    const name = clean(p.name.replace(/\\/g, ''), 80), vendor = clean(p.vendor.replace(/\\/g, ''), 60);
    const sh = best(p.engines.shodan, 'shodan', name), fo = best(p.engines.fofa, 'fofa', name), g = best(p.engines.google, 'google', name);
    const id = (vendor + '/' + name).toLowerCase();
    if (!name || (!sh && !fo && !g) || seen.has(id)) continue;
    seen.add(id);
    rows.push({ name, vendor, sh, fo, g });
  }
  const unlisted = { kev: 0, cve: '', kevDate: '', ransom: false };
  return rankFingerprints(joinKev(rows, kev).map(r => (r.kev && !believable(r) ? { ...r, ...unlisted } : r)));
}
function fingerprintsFile(ranked, kevVersion, today) {
  const { rows, picks } = ranked;
  const meta = { v: today, count: rows.length, picks, kev: clean(kevVersion || '', 20) };
  const js = `/* Product fingerprints — a snapshot for the Fingerprints view of DorkOps. Data only; generated, do not edit.
 *
 * Source:   QUERIES.yaml from ProjectDiscovery's awesome-search-queries,
 *           https://github.com/projectdiscovery/awesome-search-queries
 * Licence:  MIT License, Copyright (c) 2023 ProjectDiscovery — see fingerprints.LICENSE.md.
 * Ranking:  CISA's Known Exploited Vulnerabilities catalog ${meta.kev} (CC0 1.0),
 *           https://www.cisa.gov/known-exploited-vulnerabilities-catalog — using it implies no endorsement by CISA or DHS.
 * Changes:  one query kept per engine (Shodan, FOFA, Google) — the most specific one; products without a usable
 *           query dropped; each product checked against the KEV catalog (same vendor, every word of its name in
 *           the KEV product); ranked — the first ${picks} rows are the products on that list, the rest follow.
 *           Made by tools/update-libraries.mjs on ${today}.
 *
 * rows: [product, vendor, Shodan query, FOFA query, Google query, KEV entries, latest KEV CVE, date it was added (yyyymmdd), 1 = used in ransomware campaigns] */
(window.DORKOPS_LIB || function(){})("fingerprints", {
"v":${JSON.stringify(meta.v)},"count":${meta.count},"picks":${meta.picks},"kev":${JSON.stringify(meta.kev)},
"rows":[
${rows.map(r => JSON.stringify([r.name, r.vendor, r.sh, r.fo, r.g, r.kev, r.cve, r.kevDate ? Number(r.kevDate.replace(/-/g, '')) : 0, r.ransom ? 1 : 0])).join(',\n')}
]});
`;
  return { js, meta };
}

/* ============================================================
 * Command line
 * ============================================================ */
async function get(urls, label) {
  let last;
  for (const url of [].concat(urls)) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) { last = `${url}: ${e.message}`; }
  }
  throw new Error(`could not download ${label} — ${last}`);
}
// A run that finds nothing new leaves the file alone — snapshot date included — so a scheduled run only produces
// a change when the data changed. (The fingerprints are compared without the KEV catalog's version, which moves
// several times a week without touching most products.)
const dataOf = js => js.replace(/^\/\*[\s\S]*?\*\/\s*/, '').replace(/"v":"[^"]*",/, '').replace(/"kev":"[^"]*",/, '');
async function save(file, js) {
  const path = new URL(file, ROOT);
  let old = '';
  try { old = await readFile(path, 'utf8'); } catch (e) { /* first build */ }
  if (old && dataOf(old) === dataOf(js)) return false;
  await writeFile(path, js);
  return true;
}
// The page knows each library's size and date without loading it (sidebar count, top picks, cache-busting ?v=).
async function writeMeta(id, meta) {
  const path = new URL('index.html', ROOT), page = await readFile(path, 'utf8');
  const re = new RegExp(`(\\n  ${id}: )\\{[^}]*\\}`);
  if (!/const LIB_META = \{/.test(page) || !re.test(page)) throw new Error(`LIB_META.${id} not found in index.html`);
  const body = Object.entries(meta).map(([k, v]) => `${k}:${JSON.stringify(v)}`).join(', ');
  await writeFile(path, page.replace(re, `$1{ ${body} }`));
}
async function main(argv) {
  const from = argv.includes('--from') ? argv[argv.indexOf('--from') + 1] : null;
  const only = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--from');
  const wanted = id => !only.length || only.includes(id);
  for (const id of only) if (!['ghdb', 'fingerprints'].includes(id)) throw new Error(`unknown library "${id}" — use ghdb or fingerprints`);
  const src = (file, urls, label) => from ? readFile(`${from.replace(/\/$/, '')}/${file}`, 'utf8') : get(urls, label);
  const today = new Date().toISOString().slice(0, 10);

  if (wanted('ghdb')) {
    const parsed = parseGhdb(await src('ghdb.xml', SOURCES.ghdb, 'the GHDB dump'));
    const { js, meta, cats } = ghdbFile(rankGhdb(parsed.rows), today);
    const changed = await save('ghdb.js', js);
    if (changed) await writeMeta('ghdb', meta);
    console.log(`ghdb.js: ${meta.count} dorks · ${meta.picks} top picks · newest ${meta.newest} · ${(js.length / 1024).toFixed(0)} KB${changed ? '' : ' — nothing new, file left as it was'}`);
    console.log('  ' + cats.map(([c, n]) => `${c} ${n}`).join(' · '));
    if (parsed.skipped.length) console.log(`  skipped ${parsed.skipped.length} entries with no usable query: ${parsed.skipped.slice(0, 20).join(', ')}`);
  }
  if (wanted('fingerprints')) {
    const yaml = await src('QUERIES.yaml', SOURCES.queries, 'QUERIES.yaml');
    const kev = JSON.parse(await src('kev.json', SOURCES.kev, 'the KEV catalog'));
    if (!Array.isArray(kev.vulnerabilities) || kev.vulnerabilities.length < 500) throw new Error('the KEV catalog looks wrong — refusing to rank with it');
    const ranked = buildFingerprints(yaml, kev);
    const { js, meta } = fingerprintsFile(ranked, kev.catalogVersion, today);
    const changed = await save('fingerprints.js', js);
    if (changed) await writeMeta('fingerprints', meta);
    const n = k => ranked.rows.filter(r => r[k]).length;
    console.log(`fingerprints.js: ${meta.count} products · ${meta.picks} on the KEV list (catalog ${meta.kev}) · ${(js.length / 1024).toFixed(0)} KB${changed ? '' : ' — nothing new, file left as it was'}`);
    console.log(`  Shodan ${n('sh')} · FOFA ${n('fo')} · Google ${n('g')} · used in ransomware ${ranked.rows.filter(r => r.pick && r.ransom).length}`);
  }
  console.log('Now run  node tests/catalog.test.mjs  — it re-checks every row and the order.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(e => { console.error('update-libraries: ' + e.message); process.exit(1); });
}
