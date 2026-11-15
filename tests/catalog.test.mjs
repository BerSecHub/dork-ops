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

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const from = html.indexOf('const ENGINES = {');
const to = html.indexOf('/* ============================================================\n * State + storage');
if (from < 0 || to < 0) { console.error('Could not find the catalog in index.html (markers moved?)'); process.exit(2); }

// The slice only defines data and a few functions that touch the browser when called; evaluating it needs
// just the two encoders and the CommonCrawl id that the page defines above it.
const enc = encodeURIComponent, b64 = s => Buffer.from(s, 'utf8').toString('base64');
const { ENGINES, DATA, ESSENTIAL_STEPS, RECIPES, ENGINE_SERVICES } =
  new Function('enc', 'b64', 'CC_LATEST', html.slice(from, to) + '\nreturn { ENGINES, DATA, ESSENTIAL_STEPS, RECIPES, ENGINE_SERVICES };')(enc, b64, 'CC-MAIN-2026-43');

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
]) for (const m of readme.matchAll(re)) if (+m[1] !== actual) fail(`README.md says "${m[0]}" but there are ${actual} ${what}`);

console.log(`${dorks} dorks (+${links} links to further engines) · ${DATA.length} categories in ${groups.length} groups · ${ENGINE_SERVICES} engines (${Object.keys(ENGINES).length} endpoints) · ${ESSENTIAL_STEPS.reduce((n, s) => n + s.refs.length, 0)} in Essentials · ${Object.keys(RECIPES).length} recipes`);
if (errors.length) { console.error(`\n${errors.length} problem${errors.length === 1 ? '' : 's'}:\n` + errors.map(e => '  ✗ ' + e).join('\n')); process.exit(1); }
console.log('catalog OK');
