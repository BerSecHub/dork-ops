// DorkOps catalog lint — zero dependencies, needs only Node 18+.
//
//   node tests/catalog.test.mjs        (exit code 1 on any failure)
//
// Reads the engine registry and the dork catalog straight out of index.html and checks what a
// reviewer would otherwise check by hand: every dork is well-formed, scoped to the target, runs on a
// registered engine and builds an https link; nothing in the registry is unused; the playbook and the
// recipes point at things that exist; and the numbers quoted in the page head, the README and the social
// preview image are still true.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { rankGhdb, rankFingerprints } from '../tools/update-libraries.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const from = html.indexOf('const ENGINES = {');
const to = html.indexOf('/* ============================================================\n * State + storage');
if (from < 0 || to < 0) { console.error('Could not find the catalog in index.html (markers moved?)'); process.exit(2); }

// The slice only defines data and a few functions that touch the browser when called; evaluating it needs
// just the two encoders and the CommonCrawl id that the page defines above it.
const enc = encodeURIComponent, b64 = s => Buffer.from(s, 'utf8').toString('base64');
const { ENGINES, DATA, ESSENTIAL_STEPS, RECIPES, ENGINE_SERVICES, LIB_META, GHDB_CATS, ghdbScope } =
  new Function('enc', 'b64', 'CC_LATEST', html.slice(from, to) + '\nreturn { ENGINES, DATA, ESSENTIAL_STEPS, RECIPES, ENGINE_SERVICES, LIB_META, GHDB_CATS, ghdbScope };')(enc, b64, 'CC-MAIN-2026-43');

const errors = [];
const fail = msg => errors.push(msg);
const SEVERITIES = ['info', 'low', 'med', 'high', 'crit'];
const WEB_ENGINES = ['g', 'bg', 'ddg', 'ya', 'li'];        // Google stops reading a query after 32 words
const fill = q => q.replaceAll('{t_no_tld}', 'example').replaceAll('{t}', 'example.com').replaceAll('{date}', '2026-01-01');
const leftover = s => /\{[a-z_]+\}/.test(fill(s).replace(/\{\d+(,\d*)?\}/g, ''));     // regex quantifiers {16} are fine

const used = new Set(), ids = new Set(), allTags = new Set();
let dorks = 0, links = 0;
const groups = [];

for (const c of DATA) {
  for (const k of ['id', 'group', 'label', 'icon', 'description']) if (!c[k]) fail(`category ${c.id || '?'}: missing ${k}`);
  if (ids.has(c.id)) fail(`duplicate category id "${c.id}"`);
  ids.add(c.id);
  if (groups[groups.length - 1] !== c.group) groups.push(c.group);
  if (!Array.isArray(c.items) || !c.items.length) { fail(`category ${c.id}: no items`); continue; }

  const names = new Set();
  for (const it of c.items) {
    const where = `${c.id} / ${it.name}`;
    dorks++;
    if (!it.name || !it.desc || !it.q) fail(`${where}: name, desc and q are required`);
    if (names.has(it.name)) fail(`${where}: duplicate name in this category (progress and pins are keyed by it)`);
    names.add(it.name);
    if (!SEVERITIES.includes(it.sev)) fail(`${where}: sev must be one of ${SEVERITIES.join(' / ')}`);
    if (!Array.isArray(it.tags) || !it.tags.length) fail(`${where}: at least one tag`);
    for (const t of it.tags || []) { allTags.add(t); if (!/^[a-z0-9][a-z0-9._-]*$/.test(t)) fail(`${where}: tag "${t}" must be a lowercase slug`); }
    if (!/\{t(_no_tld)?\}/.test(it.q)) fail(`${where}: the query is not scoped to the target — use {t} or {t_no_tld}`);
    if (leftover(it.desc)) fail(`${where}: unknown {placeholder} in the description`);

    for (const L of [{ engine: it.engine, q: it.q }, ...(it.links || [])]) {
      const at = `${where} [${L.engine}]`;
      if (!Object.hasOwn(ENGINES, L.engine)) { fail(`${at}: unknown engine`); continue; }
      if (!L.q) { fail(`${at}: empty query`); continue; }
      used.add(L.engine);
      if (leftover(L.q)) fail(`${at}: unknown {placeholder} in the query`);
      let url = '';
      try { url = ENGINES[L.engine].url(fill(L.q)); } catch (e) { fail(`${at}: the URL builder threw — ${e.message}`); }
      if (!/^https:\/\//.test(url)) fail(`${at}: builds a non-https link`);
      if (WEB_ENGINES.includes(L.engine) && fill(L.q).split(/\s+/).length > 32) fail(`${at}: more than 32 words — Google ignores the rest`);
      if ((L.q.match(/"/g) || []).length % 2) fail(`${at}: unbalanced double quotes`);
    }
    links += (it.links || []).length;
  }
}

if (new Set(groups).size !== groups.length) fail(`categories of one group must be listed together: ${groups.join(' → ')}`);
for (const k of Object.keys(ENGINES)) if (!used.has(k)) fail(`engine "${k}" is registered but no dork uses it`);
for (const [k, e] of Object.entries(ENGINES)) if (!e.name || !e.color || typeof e.url !== 'function') fail(`engine "${k}": name, color and url() are required`);

for (const step of ESSENTIAL_STEPS) for (const [cat, name] of step.refs) {
  const c = DATA.find(x => x.id === cat);
  if (!c || !c.items.some(i => i.name === name)) fail(`Essentials: "${cat} / ${name}" does not exist — was the dork renamed?`);
}
for (const [k, r] of Object.entries(RECIPES)) {
  if (!r.label || !r.desc) fail(`recipe ${k}: label and desc are required`);
  for (const cat of r.onlyCats || []) if (!ids.has(cat)) fail(`recipe ${k}: unknown category "${cat}"`);
  for (const t of r.filterTags || []) if (!allTags.has(t)) fail(`recipe ${k}: no dork carries the tag "${t}"`);
}

// Every category and view icon is a symbol in the page's sprite.
for (const c of DATA) if (c.icon && !html.includes(`<symbol id="i-${c.icon}"`)) fail(`category ${c.id}: no icon "i-${c.icon}" in the sprite`);

// ---- The libraries (ghdb.js, fingerprints.js). They are data, but the page loads them as scripts: each must be
// one call carrying JSON and nothing else, every row must be something the app is prepared to show, and the
// order must be exactly what tools/update-libraries.mjs produces — "best first" is a rule, not a hand edit.
const libRows = { ghdb: 0, fingerprints: 0 }, libPicks = { ghdb: 0, fingerprints: 0 };
const printable = (v, max) => typeof v === 'string' && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v) && v === v.trim();
const dayOk = d => Number.isInteger(d) && d >= 20030101 && d <= Number(new Date().toISOString().slice(0, 10).replace(/-/g, '')) && /^\d{4}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(String(d));
const iso = d => String(d).replace(/^(\d{4})(\d\d)(\d\d)$/, '$1-$2-$3');
function readLib(id, file, headerMust) {
  let src;
  try { src = readFileSync(new URL('../' + file, import.meta.url), 'utf8'); } catch (e) { fail(`${file} is missing — build it with: node tools/update-libraries.mjs`); return null; }
  const OPEN = `(window.DORKOPS_LIB || function(){})(${JSON.stringify(id)}, `, CLOSE = ');';
  const body = src.replace(/^\/\*[\s\S]*?\*\/\s*/, '').trim();
  for (const re of headerMust) if (!re.test(src.slice(0, 2000))) fail(`${file} must keep its source and licence header (${re})`);
  if (!body.startsWith(OPEN) || !body.endsWith(CLOSE)) { fail(`${file} must be a single DORKOPS_LIB("${id}", {…}) call and nothing else`); return null; }
  let d = null;
  try { d = JSON.parse(body.slice(OPEN.length, -CLOSE.length)); } catch (e) { fail(`${file}: the payload is not plain JSON — ${e.message}`); return null; }
  const rows = Array.isArray(d.rows) ? d.rows : [], meta = LIB_META[id];
  libRows[id] = rows.length; libPicks[id] = d.picks;
  if (d.count !== rows.length || meta.count !== rows.length) fail(`${file} has ${rows.length} rows, its header says ${d.count} and LIB_META.${id} in index.html says ${meta.count} — run tools/update-libraries.mjs`);
  for (const k of Object.keys(meta)) if (k !== 'count' && d[k] !== meta[k]) fail(`LIB_META.${id}.${k} is ${JSON.stringify(meta[k])} but ${file} says ${JSON.stringify(d[k])}`);
  if (!Number.isInteger(d.picks) || d.picks < 1 || d.picks > rows.length) fail(`${file}: "picks" must be between 1 and the number of rows`);
  return d;
}
const few = (file) => { let n = 0; return msg => { if (n++ < 12) fail(`${file}: ${msg}`); else if (n === 14) fail(`${file}: … and more problems`); }; };

const g = readLib('ghdb', 'ghdb.js', [/GNU General Public License v2\.0/, /exploit-database\/exploitdb/]);
if (g) {
  const flag = few('ghdb.js');
  for (const c of g.cats || []) if (!Object.hasOwn(GHDB_CATS, c)) fail(`ghdb.js: category "${c}" has no slug and severity in GHDB_CATS`);
  for (const c of Object.keys(GHDB_CATS)) if (!(g.cats || []).includes(c)) fail(`GHDB_CATS lists "${c}", which the snapshot does not have`);
  if (new Set(Object.values(GHDB_CATS).map(c => c[0])).size !== Object.keys(GHDB_CATS).length) fail('GHDB_CATS: slugs must be unique');
  for (const [, sev] of Object.values(GHDB_CATS)) if (!SEVERITIES.includes(sev)) fail(`GHDB_CATS: unknown severity "${sev}"`);
  for (const a of g.authors || []) if (!printable(a, 60) || !a) fail(`ghdb.js: bad author entry ${JSON.stringify(a)}`);
  const seen = new Set(), plain = [];
  for (const r of g.rows) {
    if (!Array.isArray(r) || r.length !== 5) { flag(`not a 5-field row: ${JSON.stringify(r).slice(0, 80)}`); continue; }
    const [id, day, c, a, q] = r;
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) flag(`row ${id}: the id must be a unique positive integer`);
    seen.add(id);
    if (!dayOk(day)) flag(`row ${id}: bad date ${day}`);
    if (!Number.isInteger(c) || !(g.cats || [])[c]) flag(`row ${id}: bad category index`);
    if (!Number.isInteger(a) || !(g.authors || [])[a]) flag(`row ${id}: bad author index`);
    if (!printable(q, 300) || !q) { flag(`row ${id}: the query must be 1–300 printable characters`); continue; }
    if (/\{t\}|\{t_no_tld\}|\{date\}/.test(q)) flag(`row ${id}: the query contains a literal placeholder`);
    const scoped = ghdbScope(q);
    if (!scoped.includes('{t}')) flag(`row ${id}: scoping lost the target — ${scoped}`);
    if (!/^https:\/\/www\.google\.com\/search\?q=/.test(ENGINES.g.url(fill(scoped)))) flag(`row ${id}: does not build a Google search link`);
    plain.push({ id, date: iso(day), cat: (g.cats || [])[c], q });
  }
  if (plain.length === g.rows.length) {
    const want = rankGhdb(plain);
    if (want.picks !== g.picks) fail(`ghdb.js says ${g.picks} top picks, the ranking gives ${want.picks}`);
    const at = want.rows.findIndex((r, i) => r.id !== g.rows[i][0]);
    if (at >= 0) fail(`ghdb.js is not in ranked order from row ${at + 1} (GHDB-${g.rows[at][0]} where GHDB-${want.rows[at].id} belongs) — rebuild it with tools/update-libraries.mjs`);
  }
  let lic = '';
  try { lic = readFileSync(new URL('../ghdb.LICENSE.md', import.meta.url), 'utf8'); } catch (e) { /* reported below */ }
  if (!/GNU GENERAL PUBLIC LICENSE\s+Version 2, June 1991/.test(lic) || !/END OF TERMS AND CONDITIONS/.test(lic)) fail('ghdb.LICENSE.md must carry the full GNU GPL v2 text — ghdb.js is distributed under it');
}

const fp = readLib('fingerprints', 'fingerprints.js', [/MIT License, Copyright \(c\) 2023 ProjectDiscovery/, /awesome-search-queries/, /Known Exploited Vulnerabilities/]);
if (fp) {
  const flag = few('fingerprints.js');
  const seen = new Set(), plain = [];
  for (const r of fp.rows) {
    if (!Array.isArray(r) || r.length !== 9) { flag(`not a 9-field row: ${JSON.stringify(r).slice(0, 80)}`); continue; }
    const [name, vendor, sh, fo, q3, kev, cve, day, ransom] = r, where = `${vendor}/${name}`;
    if (!printable(name, 80) || !name || !printable(vendor, 60)) { flag(`${where}: bad product or vendor name`); continue; }
    if (seen.has(where.toLowerCase())) flag(`${where}: listed twice`);
    seen.add(where.toLowerCase());
    for (const q of [sh, fo, q3]) if (!printable(q, 200) || (q.match(/"/g) || []).length % 2 || /\{t\}|\{t_no_tld\}|\{date\}/.test(q)) flag(`${where}: a query is not usable — ${JSON.stringify(q).slice(0, 60)}`);
    if (!sh && !fo && !q3) flag(`${where}: no query on any engine`);
    if (/&&|\|\||cpe:/.test(sh)) flag(`${where}: the Shodan query uses something Shodan does not take`);
    if (!Number.isInteger(kev) || kev < 0 || (ransom !== 0 && ransom !== 1)) flag(`${where}: bad KEV fields`);
    if (kev > 0 ? !/^CVE-\d{4}-\d{4,7}$/.test(cve) || !dayOk(day) : cve !== '' || day !== 0 || ransom !== 0) flag(`${where}: the KEV CVE and date must be set exactly when the product is on the list`);
    plain.push({ name, vendor, sh, fo, g: q3, kev, cve, kevDate: kev > 0 ? iso(day) : '', ransom: ransom === 1 });
  }
  if (plain.length === fp.rows.length) {
    const want = rankFingerprints(plain);
    if (want.picks !== fp.picks) fail(`fingerprints.js says ${fp.picks} top picks, the ranking gives ${want.picks}`);
    const at = want.rows.findIndex((r, i) => r.name !== fp.rows[i][0] || r.vendor !== fp.rows[i][1]);
    if (at >= 0) fail(`fingerprints.js is not in ranked order from row ${at + 1} — rebuild it with tools/update-libraries.mjs`);
  }
  let lic = '';
  try { lic = readFileSync(new URL('../fingerprints.LICENSE.md', import.meta.url), 'utf8'); } catch (e) { /* reported below */ }
  if (!/MIT License/.test(lic) || !/Copyright \(c\) 2023 ProjectDiscovery/.test(lic) || !/Creative Commons 0 1\.0/.test(lic)) fail('fingerprints.LICENSE.md must carry the MIT licence of the query set and the CC0 note of the KEV catalog');
}

// The page head and the no-JavaScript fallback quote round numbers: keep them true.
const quoted = [...html.matchAll(/(\d+)\+ (?:modern |curated )?(?:OSINT )?dorks/g)].map(m => +m[1]);
const quotedEngines = [...html.matchAll(/across (\d+)\+ engines/g)].map(m => +m[1]);
const quotedCats = [...html.matchAll(/catalog of (\d+) categories/g)].map(m => +m[1]);
if (!quoted.length || quoted.some(n => n > dorks)) fail(`the page claims ${Math.max(...quoted, 0)}+ dorks but the catalog has ${dorks}`);
if (!quotedEngines.length || quotedEngines.some(n => n > ENGINE_SERVICES)) fail(`the page claims ${Math.max(...quotedEngines, 0)}+ engines but there are ${ENGINE_SERVICES}`);
if (quotedCats.some(n => n !== DATA.length)) fail(`the page says ${quotedCats.join('/')} categories but there are ${DATA.length}`);

// The social preview image (og-image.svg, the source of og-image.png) quotes the same round numbers.
let og = '';
try { og = readFileSync(new URL('../og-image.svg', import.meta.url), 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ''); } catch (e) { /* a copy without it */ }
for (const m of og.matchAll(/(\d+)\+\s*dorks/g)) if (+m[1] > dorks) fail(`og-image.svg claims ${m[1]}+ dorks but the catalog has ${dorks}`);
for (const m of og.matchAll(/(\d+)\+\s*engines/g)) if (+m[1] > ENGINE_SERVICES) fail(`og-image.svg claims ${m[1]}+ engines but there are ${ENGINE_SERVICES}`);
for (const m of og.matchAll(/(\d+)\s*categories/g)) if (+m[1] !== DATA.length) fail(`og-image.svg says ${m[1]} categories but there are ${DATA.length}`);

// og-image.png is served with a one-year immutable cache, so its URL in the page head carries a version taken
// from the file's content: change the image and the lint says which value the three meta tags need.
let png = null;
try { png = readFileSync(new URL('../og-image.png', import.meta.url)); } catch (e) { /* a copy without it */ }
if (png) {
  const want = createHash('sha256').update(png).digest('hex').slice(0, 8);
  const urls = [...html.matchAll(/<meta (?:property|name)="(og:image|og:image:secure_url|twitter:image)" content="([^"]*)"/g)];
  if (urls.length !== 3) fail(`expected og:image, og:image:secure_url and twitter:image in the page head, found ${urls.length}`);
  for (const [, name, url] of urls) if (!url.endsWith(`/og-image.png?v=${want}`)) fail(`${name} must end with og-image.png?v=${want} (the image changed, or the version is missing)`);
}

// The README quotes exact numbers: a catalog change has to update them.
let readme = '';
try { readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8'); } catch (e) { /* a copy without the README: nothing to check */ }
const withLinks = DATA.reduce((n, c) => n + c.items.filter(i => (i.links || []).length).length, 0);
const essentials = ESSENTIAL_STEPS.reduce((n, s) => n + s.refs.length, 0);
for (const [re, actual, what] of [
  [/(\d+) curated dorks/g, dorks, 'curated dorks'],
  [/(\d+) search engines/g, ENGINE_SERVICES, 'search engines'],
  [/(\d+) categories/g, DATA.length, 'categories'],
  [/(\d+) hand-picked dorks/g, essentials, 'hand-picked dorks (Essentials)'],
  [/(\d+) of them also run on a second/g, withLinks, 'dorks with a second engine'],
  [/\((\d+) extra engine buttons/g, links, 'extra engine buttons'],
  [/([\d,]+) GHDB dorks/g, libRows.ghdb, 'GHDB dorks in ghdb.js'],
  [/([\d,]+) product fingerprints/g, libRows.fingerprints, 'products in fingerprints.js'],
  [/top ([\d,]+) of the GHDB/g, libPicks.ghdb, 'GHDB top picks'],
  [/([\d,]+) products on CISA's KEV list/g, libPicks.fingerprints, 'fingerprints on the KEV list'],
]) for (const m of readme.matchAll(re)) if (+m[1].replace(/,/g, '') !== actual) fail(`README.md says "${m[0]}" but there are ${actual} ${what}`);

console.log(`${dorks} dorks (+${links} links to further engines) · libraries: GHDB ${libRows.ghdb} (${libPicks.ghdb} picks), fingerprints ${libRows.fingerprints} (${libPicks.fingerprints} picks) · ${DATA.length} categories in ${groups.length} groups · ${ENGINE_SERVICES} engines (${Object.keys(ENGINES).length} endpoints) · ${ESSENTIAL_STEPS.reduce((n, s) => n + s.refs.length, 0)} in Essentials · ${Object.keys(RECIPES).length} recipes`);
if (errors.length) { console.error(`\n${errors.length} problem${errors.length === 1 ? '' : 's'}:\n` + errors.map(e => '  ✗ ' + e).join('\n')); process.exit(1); }
console.log('catalog OK');
