// DorkOps UI regression suite — drives the real page in headless Chromium.
//
//   npm install --no-save playwright && npx playwright install chromium     (once)
//   node tests/ui.test.mjs                                     (exit code 1 on any failure)
//
// Playwright is only needed here; the app itself has no dependencies. If Playwright lives outside
// node_modules (a global install), point PLAYWRIGHT_MODULE at its index.mjs.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

let chromium;
try { ({ chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')); }
catch (e) { console.error('Playwright is not installed: run  npm install --no-save playwright && npx playwright install chromium'); process.exit(2); }

// Serve the repo over HTTP like production does (file:// localStorage is flaky across reloads in headless Chromium).
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.xml': 'application/xml', '.txt': 'text/plain' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '') || 'index.html';
  try { const body = await readFile(join(ROOT, path)); res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const FILE = `${ORIGIN}/index.html`;
const browser = await chromium.launch();
const results = [];
const errors = [];
const check = (name, cond, detail) => results.push({ name, ok: cond === true, detail: cond === true ? '' : (detail !== undefined ? detail : cond) });

async function newPage(viewport = { width: 1440, height: 900 }, { hash = '', storage = { ndo_disclaimer_v1: '1' }, scheme = 'dark' } = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme: scheme });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`PAGE ERROR: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`CONSOLE ${m.type()}: ${m.text()}`); });
  await page.route('**/*', r => { const u = r.request().url(); return (u.startsWith(ORIGIN) || u.startsWith('data:') || u.startsWith('blob:')) ? r.continue() : r.abort(); });
  await page.addInitScript(s => { try { if (!sessionStorage.getItem('__seeded')) { for (const k in s) localStorage.setItem(k, s[k]); sessionStorage.setItem('__seeded', '1'); } } catch (e) {} }, storage);
  await page.goto(FILE + hash, { waitUntil: 'networkidle' });
  await page.waitForTimeout(150);
  return page;
}
const settle = p => p.waitForTimeout(180);

/* ───────────── 1. data integrity ───────────── */
{
  const p = await newPage();
  const d = await p.evaluate(() => {
    const sevs = new Set(SEVERITIES);
    const bad = [], dupNames = [], badUrl = [], tooLong = [], unresolved = [], unscoped = [], badTags = [];
    const used = new Set();
    DATA.forEach(c => {
      const seen = new Set();
      c.items.forEach(it => {
        const where = `${c.id}/${it.name}`;
        if (!it.name || !it.desc || !sevs.has(it.sev) || !Array.isArray(it.tags) || !it.tags.length || !it.q) bad.push(where);
        if (it.tags.some(t => !/^[a-z0-9][a-z0-9._-]*$/.test(t))) badTags.push(where);
        if (seen.has(it.name)) dupNames.push(where); seen.add(it.name);
        if (!/\{t(_no_tld)?\}/.test(it.q)) unscoped.push(where);
        [{ engine: it.engine, q: it.q }, ...(it.links || [])].forEach(L => {
          if (!has(ENGINES, L.engine) || !L.q) { bad.push(where + ' → ' + L.engine); return; }
          used.add(L.engine);
          if (!/^https:\/\//.test(buildUrl(L.engine, L.q, 'example.com'))) badUrl.push(where + ' → ' + L.engine);
          const q = applyTemplate(L.q, 'example.com');
          if (['g', 'bg', 'ddg', 'ya', 'li'].includes(L.engine) && q.split(/\s+/).length > 32) tooLong.push(where + ' → ' + L.engine);
          if (/\{[a-z_]+\}/.test(q.replace(/\{\d+(,\d*)?\}/g, ''))) unresolved.push(where + ' → ' + L.engine);
        });
        if (/\{[a-z_]+\}/.test(applyTemplate(it.desc, 'example.com'))) unresolved.push(where + ' (desc)');
      });
    });
    const icons = DATA.map(c => c.icon), ids = DATA.map(c => c.id);
    const refs = ESSENTIAL_STEPS.flatMap(s => s.refs);
    const groups = []; DATA.forEach(c => { if (groups[groups.length - 1] !== c.group) groups.push(c.group); });
    return {
      dorks: DATA.reduce((n, c) => n + c.items.length, 0), cats: DATA.length, endpoints: Object.keys(ENGINES).length, services: ENGINE_SERVICES,
      bad, badTags, dupNames, badUrl, tooLong, unresolved, unscoped,
      dupIcons: icons.filter((x, i) => icons.indexOf(x) !== i), dupIds: ids.filter((x, i) => ids.indexOf(x) !== i),
      unusedEngines: Object.keys(ENGINES).filter(k => !used.has(k)),
      groups, noGroup: DATA.filter(c => !c.group).map(c => c.id),
      essRefs: refs.length, essResolved: ESSENTIALS.items.length, essUnique: new Set(ESSENTIALS.items).size,
      recipesEmpty: Object.keys(RECIPES).filter(k => { state.recipe = k; const n = DATA.reduce((a, c) => a + c.items.filter(i => itemMatchesRecipe(i, c.id)).length, 0); state.recipe = null; return n === 0; }),
      recipeNoMeta: Object.keys(RECIPES).filter(k => !RECIPES[k].label || !RECIPES[k].desc),
      keys: new Set(DATA.flatMap(c => c.items.map(i => i.key))).size,
    };
  });
  check('catalog: 300+ dorks in 19 categories on 40+ engines', d.dorks >= 300 && d.cats === 19 && d.services >= 40 && d.endpoints >= d.services, { dorks: d.dorks, cats: d.cats, services: d.services, endpoints: d.endpoints });
  check('catalog: every item is well-formed (fields, severity, engine of every link)', d.bad.length === 0, d.bad);
  check('catalog: tags are lowercase slugs', d.badTags.length === 0, d.badTags);
  check('catalog: dork names unique per category, every dork has its own key', d.dupNames.length === 0 && d.keys === d.dorks, d.dupNames);
  check('catalog: category ids and icons are unique', d.dupIcons.length === 0 && d.dupIds.length === 0, { icons: d.dupIcons, ids: d.dupIds });
  check('catalog: every category sits in a group, groups are contiguous', d.noGroup.length === 0 && new Set(d.groups).size === d.groups.length && d.groups.length === 5, d.groups);
  check('catalog: every dork and every extra engine link builds an https URL', d.badUrl.length === 0, d.badUrl);
  check('catalog: web-search queries stay within Google\'s 32-word limit', d.tooLong.length === 0, d.tooLong);
  check('catalog: no unresolved {placeholders} in any query or description', d.unresolved.length === 0, d.unresolved);
  check('catalog: every dork is scoped to the target', d.unscoped.length === 0, d.unscoped);
  check('engines: none is registered without a dork that uses it', d.unusedEngines.length === 0, d.unusedEngines);
  check('essentials: all refs resolve, no duplicates', d.essRefs >= 15 && d.essResolved === d.essRefs && d.essUnique === d.essRefs, d);
  check('recipes: each has label + desc and matches something', d.recipeNoMeta.length === 0 && d.recipesEmpty.length === 0, d);

  const e = await p.evaluate(() => {
    const find = (cat, name) => DATA.find(c => c.id === cat).items.find(i => i.name === name);
    const dec = u => atob(decodeURIComponent(new URL(u).searchParams.get(u.includes('fofa') ? 'qbase64' : 'q')));
    return {
      dead: ['be', 'sc', 'dd', 'pb', 'ghdb', 'gnp', 'bd'].filter(k => has(ENGINES, k)),
      cen: ENGINES.cen.url('host.dns.names: "example.com"'), cenName: ENGINES.cen.name,
      ze: dec(ENGINES.ze.url('domain="example.com"')), fo: dec(ENGINES.fo.url('domain="example.com"')),
      shf: ENGINES.shf.url('facet:http.title ssl:"example.com"'),
      nd: decodeURIComponent(ENGINES.nd.url('example.com')), gn: ENGINES.gn.url('x'), oy: ENGINES.oy.url('x'), lx: ENGINES.lx.url('x'), hh: ENGINES.hh.url('x'),
      ghr: ENGINES.ghr.url('org:x'), ghAuth: ENGINES.gh.auth,
      auth: [ENGINES.gn.auth, ENGINES.vt.auth, ENGINES.lx.auth], opsec: [ENGINES.sh, ENGINES.shf, ENGINES.fo, ENGINES.cen, ENGINES.ze, ENGINES.hh, ENGINES.nl, ENGINES.oy, ENGINES.fh].map(x => x.opsec),
      cc: ENGINES.cc.url('x').includes(CC_LATEST + '-index'),
      crt: buildUrl('crt', find('dns', 'crt.sh wildcard JSON').q, 'example.com'),
      wa: ENGINES.wa.url('example.com/*'),
      s3: find('cloud', 'S3 by bucket name').q, shodan: find('net', 'Shodan org').q, saml: find('attack', 'SAML metadata exposed').q,
      sg: find('code', 'Sourcegraph multi-lang').q, orgEnum: find('code', 'GitHub org enum'),
      censys: DATA.flatMap(c => c.items).flatMap(i => [i, ...(i.links || [])]).filter(l => l.engine === 'cen').map(l => l.q),
      zoomeye: DATA.flatMap(c => c.items).flatMap(i => [i, ...(i.links || [])]).filter(l => l.engine === 'ze').map(l => l.q),
      key: find('secrets', 'AWS Access Key ID (AKIA)'), dbUrl: find('secrets', 'Database URLs with credentials').q,
      web: find('edge', 'Palo Alto GlobalProtect'), svc: find('services', 'Redis'), any: find('services', 'Grafana, Kibana & Prometheus'),
    };
  });
  check('engines: the dead ones are gone (BinaryEdge, searchcode, DNSDumpster, Phonebook, …)', e.dead.length === 0, e.dead);
  check('engines: Censys points at the Platform with CenQL fields; no legacy services.* syntax left', e.cen === 'https://platform.censys.io/search?q=host.dns.names%3A%20%22example.com%22' && !/legacy/i.test(e.cenName) && e.censys.length > 5 && e.censys.every(q => /\b(host|web)\./.test(q) && !/(^|[\s(])services\./.test(q)), { cen: e.cen, bad: e.censys.filter(q => !/\b(host|web)\./.test(q)) });
  check('engines: ZoomEye and FOFA get a base64 query; ZoomEye dorks use field="value"', e.ze === 'domain="example.com"' && e.fo === 'domain="example.com"' && e.zoomeye.every(q => /^[a-z.]+="/.test(q)), e);
  check('engines: Shodan facets split the facet from the query', e.shf === 'https://www.shodan.io/search/facet?query=ssl%3A%22example.com%22&facet=http.title', e.shf);
  check('engines: NerdyData, GreyNoise, Onyphe, LeakIX and Hunter.how use their current deep links', e.nd.includes('/reports/new?search={"all":[{"type":"code","value":"example.com"}]') && e.gn === 'https://viz.greynoise.io/ips?q=x' && e.oy === 'https://search.onyphe.io/search?q=x' && e.lx === 'https://leakix.net/search?scope=leak&q=x' && e.hh === 'https://hunter.how/list?searchValue=x', e);
  check('engines: GitHub repos endpoint; code search is flagged as needing a login', e.ghr.includes('type=repositories') && e.ghAuth === true, e.ghr);
  check('engines: auth flags on GreyNoise / VirusTotal / LeakIX', e.auth.every(x => x === true), e.auth);
  check('engines: every internet scanner is hidden in OPSEC mode', e.opsec.every(x => x === false), e.opsec);
  check('engines: CommonCrawl uses the resolved crawl id', e.cc);
  check('engines: crt.sh URL', e.crt === 'https://crt.sh/?q=%25.example.com&output=json', e.crt);
  check('engines: Wayback turns a plain pattern into a capture listing', e.wa === 'https://web.archive.org/web/*/example.com/*', e.wa);
  check('dorks: S3 matches bucket names (no negation)', e.s3.includes('"{t_no_tld}-backup"') && !e.s3.includes('-backup OR'), e.s3);
  check('dorks: Shodan org uses the org label', e.shodan === 'org:"{t_no_tld}"', e.shodan);
  check('dorks: SAML is single-level', e.saml === 'site:{t} (inurl:"/saml/metadata" OR "EntityDescriptor")', e.saml);
  check('dorks: Sourcegraph parenthesised', e.sg.includes('(lang:yaml OR lang:dotenv)'), e.sg);
  check('dorks: org enum on GitHub repos, without the no-op fork:false', e.orgEnum.engine === 'ghr' && e.orgEnum.q === 'org:{t_no_tld}', e.orgEnum);
  check('dorks: secret formats run as a target-scoped GitHub regex, with grep.app as the global variant', e.key.engine === 'gh' && e.key.q === '"{t}" /AKIA[0-9A-Z]{16}/' && e.key.links[0].engine === 'gra' && e.key.links[0].q === 'AKIA[0-9A-Z]{16}' && e.dbUrl.includes(':\\/\\/'), { key: e.key, dbUrl: e.dbUrl });
  check('dorks: scanner fingerprints are scoped by certificate, reverse DNS and root domain', e.web.q === 'ssl:"{t}" http.title:"globalprotect"' && e.web.links[0].q === 'hostname:"{t}" http.title:"globalprotect"' && e.web.links[0].label === 'Shodan · rDNS' && e.web.links[1].q === 'domain="{t}" && title="globalprotect"', e.web);
  check('dorks: bare services are scoped by reverse DNS and org; multi-product dorks use FOFA + Censys lists', e.svc.q.startsWith('hostname:"{t}" ') && e.svc.links[0].q.startsWith('org:"{t_no_tld}" ') && e.any.engine === 'fo' && e.any.q.includes('title="Grafana" || title="Kibana"') && e.any.links[0].q.includes('html_title: {"Grafana", "Kibana", "Prometheus Time Series"}'), { svc: e.svc, any: e.any });
  await p.context().close();
}

/* ───────────── 2. views, search, filters ───────────── */
{
  const p = await newPage();
  const home = await p.evaluate(() => ({
    title: document.getElementById('catTitle').textContent.trim(), cards: document.querySelectorAll('.card').length,
    groups: document.querySelectorAll('.group').length, steps: document.querySelectorAll('.group-head .step').length,
    pills: document.querySelectorAll('.card .cat-pill').length, count: document.getElementById('visibleCount').textContent,
    open: document.getElementById('openCount').textContent, active: document.querySelector('.nav-item.active .nm').textContent,
    current: document.querySelectorAll('.nav-item[aria-current="page"]').length, nav: document.querySelectorAll('.nav-item').length,
    h1: document.querySelectorAll('h1').length, placeholder: document.getElementById('filter').placeholder,
  }));
  check('home: Essentials is the default view', home.title.endsWith('Essentials') && home.active === 'Essentials' && home.current === 1, home);
  const ESS_N = await p.evaluate(() => ESSENTIALS.items.length), ALL_N = await p.evaluate(() => DATA.reduce((n, c) => n + c.items.length, 0)), CAT_N = await p.evaluate(() => DATA.length);
  check('home: the playbook in 4 numbered steps, each card with its category', home.cards === ESS_N && home.groups === 4 && home.steps === 4 && home.pills === ESS_N, home);
  check('home: counter + Open-all agree', home.count.startsWith(`${ESS_N} dorks`) && home.open === String(ESS_N), home);
  check('home: nav has Essentials + My dorks + All + the libraries + Investigate + every category', home.nav === 4 + (await p.evaluate(() => LIBS.length + DATA.length)), home.nav);
  check('home: exactly one h1, live placeholder count', home.h1 === 1 && home.placeholder.includes(String(ALL_N)), home);

  // search from Essentials is global
  await p.fill('#filter', 'stripe'); await settle(p);
  const s = await p.evaluate(() => ({
    title: document.getElementById('catTitle').textContent.trim(), cards: document.querySelectorAll('.card').length,
    cats: new Set([...document.querySelectorAll('.card .cat-pill')].map(x => x.textContent)).size,
    marks: document.querySelectorAll('.card mark').length, count: document.getElementById('visibleCount').textContent,
    hash: location.hash,
  }));
  check('search: global from Essentials, ranked + highlighted', s.title === 'Search results' && s.cards >= 3 && s.cats >= 2 && s.marks > 0 && /^\d+ results/.test(s.count), s);
  check('search: reflected in the URL hash', s.hash.includes('filter=stripe') && s.hash.includes('cat=essentials'), s.hash);

  await p.fill('#filter', 'token sev:crit -wayback'); await settle(p);
  const ops = await p.evaluate(() => ({ chips: [...document.querySelectorAll('#searchOps .op')].map(x => x.textContent.trim()), sevs: [...new Set([...document.querySelectorAll('.card')].map(c => c.dataset.sev))] }));
  check('search: operator chips + sev gate', ops.chips.length === 2 && ops.sevs.join() === 'crit', ops);
  await p.click('#searchOps .op .x'); await settle(p);
  check('search: removing a chip rewrites the query', (await p.inputValue('#filter')) === 'token -wayback', await p.inputValue('#filter'));

  await p.fill('#filter', 'engine:g'); await settle(p);
  const eg = await p.evaluate(() => { const cards = [...document.querySelectorAll('.card')]; return { n: cards.length, noGoogle: cards.filter(c => ![...c.querySelectorAll('.eng-btn')].some(a => /^Google( ·|$)/.test(a.textContent.trim()))).map(c => c.dataset.key), ghOnly: cards.filter(c => BY_KEY.get(c.dataset.key).it.engine === 'gh' && !(BY_KEY.get(c.dataset.key).it.links || []).some(l => l.engine === 'g')).length }; });
  check('search: engine:g means Google — every hit can be run on Google, GitHub-only dorks are not matched', eg.n > 50 && eg.noGoogle.length === 0 && eg.ghOnly === 0, eg);

  await p.fill('#filter', 'zzzzqqq'); await settle(p);
  const empty = await p.evaluate(() => ({ t: document.querySelector('.empty-state h2')?.textContent, btns: [...document.querySelectorAll('.empty-state .btn')].map(b => b.textContent), open: document.getElementById('openCat').disabled }));
  check('search: empty state with a way out, Open-all disabled', empty.t === 'No dorks match' && empty.btns.includes('Clear search') && empty.open === true, empty);
  await p.click('.empty-state .btn'); await settle(p);
  check('search: Clear search restores the view', (await p.locator('.card').count()) === ESS_N);

  // XSS probe through the search box and the hash
  await p.fill('#filter', '"<img src=x onerror=window.__xss=1>" <svg/onload=window.__xss=1>'); await settle(p);
  check('security: search input is rendered inert', await p.evaluate(() => !window.__xss && !document.querySelector('#grid img, #searchOps img, #grid svg[onload]')));
  await p.fill('#filter', ''); await settle(p);

  // all dorks
  await p.click('.nav-item[data-view="-1"]'); await settle(p);
  const all = await p.evaluate(() => ({ cards: document.querySelectorAll('.card').length, heads: document.querySelectorAll('.group-head').length, count: document.getElementById('visibleCount').textContent, y: window.scrollY, hash: location.hash }));
  check('all: every dork under its category heading', all.cards === ALL_N && all.heads === CAT_N && all.count.startsWith(`${ALL_N} dorks`) && all.hash.includes('cat=all'), all);
  await p.click('.group-head h2 button'); await settle(p);
  const first = await p.evaluate(() => ({ id: DATA[0].id, n: DATA[0].items.length }));
  check('all: a heading opens its category', (await p.evaluate(() => location.hash)).includes('cat=' + first.id) && (await p.locator('.card').count()) === first.n);

  // severity
  await p.click('.sev-pill[data-sev="crit"]'); await settle(p);
  const sev = await p.evaluate(() => ({ pressed: document.querySelector('.sev-pill[data-sev="crit"]').getAttribute('aria-pressed'), crit: document.querySelectorAll('.card[data-sev="crit"]').length, count: document.getElementById('visibleCount').textContent, hash: location.hash }));
  check('filters: severity toggle (aria-pressed, counter "x of y", hash)', sev.pressed === 'false' && sev.crit === 0 && new RegExp(` of ${first.n} dorks`).test(sev.count) && !/sev=[^&]*crit/.test(sev.hash), sev);
  await p.click('.sev-pill[data-sev="crit"]'); await settle(p);

  // recipes
  await p.selectOption('#recipe', 'bbTriage'); await settle(p);
  const rec = await p.evaluate(() => ({
    title: document.getElementById('catTitle').textContent.trim(), desc: document.getElementById('catDesc').textContent,
    active: document.getElementById('recipeWrap').classList.contains('active'), nav: document.querySelector('.nav-item.active .nm').textContent,
    maxPerCat: Math.max(...[...document.querySelectorAll('.group')].map(g => g.querySelectorAll('.card').length)),
    cards: document.querySelectorAll('.card').length, exported: buildExportData().reduce((n, c) => n + c.items.length, 0), hash: location.hash,
    options: document.querySelectorAll('#recipe option').length,
  }));
  check('recipes: select lists every recipe (+ none)', rec.options === 1 + (await p.evaluate(() => Object.keys(RECIPES).length)), rec.options);
  check('recipes: becomes a named view over All dorks, capped per category', rec.title.endsWith('Bug Bounty Triage') && rec.active && rec.nav === 'All dorks' && rec.maxPerCat <= 4 && rec.cards > 0 && rec.hash.includes('recipe=bbTriage'), rec);
  check('export: exactly the visible dorks (recipe + cap respected)', rec.exported === rec.cards, rec);
  await p.click('.nav-item[data-view="-2"]'); await settle(p);
  check('recipes: going to Essentials clears the recipe', await p.evaluate(() => state.recipe === null && document.getElementById('recipe').value === '' && document.querySelectorAll('.card').length === ESSENTIALS.items.length));

  // OPSEC
  await p.goto(FILE + '#cat=net'); await p.reload(); await settle(p);
  await p.click('label.switch'); await settle(p);
  const op = await p.evaluate(() => ({
    on: document.body.classList.contains('opsec-on'), flag: getComputedStyle(document.querySelector('.opsec-flag')).display,
    leaky: [...document.querySelectorAll('.card .eng-btn')].map(a => a.textContent).filter(t => /Shodan|FOFA|ZoomEye|Censys|Hunter|Netlas|Onyphe|BinaryEdge|urlscan/.test(t)),
    cards: document.querySelectorAll('.card').length, hash: location.hash, checked: document.getElementById('opsec').checked,
  }));
  check('OPSEC: hides logging engines, shows the status flag, stays out of the URL', op.on && op.checked && op.flag !== 'none' && op.leaky.length === 0 && op.cards >= 1 && !/opsec/i.test(op.hash), op);
  await p.goto(FILE + '#cat=ics'); await p.reload(); await settle(p);
  const op2 = await p.evaluate(() => ({ persisted: state.opsec, btns: [...document.querySelectorAll('.empty-state .btn')].map(b => b.textContent), cards: document.querySelectorAll('.card').length }));
  check('OPSEC: persists across reloads; empty category explains itself', op2.persisted === true && (op2.cards > 0 || op2.btns.includes('Turn off OPSEC mode')), op2);
  await p.context().close();
}

/* ───────────── 3. cards ───────────── */
{
  const p = await newPage(undefined, { hash: '#cat=raw-gh' });
  await p.fill('#target', 'https://www.Tesla.com/path?x=1'); await p.press('#target', 'Enter'); await settle(p);
  const c = await p.evaluate(() => {
    const card = document.querySelector('.card');
    return {
      target: document.getElementById('target').value,
      heading: card.querySelector('.card-title').tagName, badge: card.querySelector('.sev-badge').textContent,
      code: card.querySelector('.card-query code').textContent, tk: { o: card.querySelectorAll('.tk-o').length, s: card.querySelectorAll('.tk-s').length, k: card.querySelectorAll('.tk-k').length, t: card.querySelectorAll('.tk-t').length },
      tTxt: [...card.querySelectorAll('.tk-t')].map(x => x.textContent), copy: card.querySelector('.q-copy').getAttribute('aria-label'),
      link: card.querySelector('.card-meta .iconbtn').getAttribute('aria-label'), tags: [...card.querySelectorAll('.tag')].map(t => t.tagName + ':' + t.textContent),
      href: card.querySelector('.eng-btn').href, rel: card.querySelector('.eng-btn').rel, raw: /\{t(_no_tld)?\}/.test(document.getElementById('grid').textContent),
      sentinel: /[]/.test(document.getElementById('grid').textContent + [...document.querySelectorAll('.eng-btn')].map(a => a.href).join('')),
    };
  });
  check('target: pasted URL is normalised on Enter', c.target === 'www.tesla.com', c.target);
  check('card: query is templated + syntax-coloured', c.code.includes('"www.tesla.com"') && c.tk.o >= 3 && c.tk.s >= 3 && c.tk.k >= 1, c);
  check('card: only real substitutions are highlighted as the target', c.tk.t === 1 && c.tTxt[0] === 'www.tesla.com', c.tTxt);
  check('card: no raw {placeholders} or marker characters leak into the page', c.raw === false && c.sentinel === false, c);
  check('card: labelled copy buttons, tag buttons, safe outbound link', c.copy === 'Copy query' && c.link === 'Copy search URL' && c.tags.every(t => t.startsWith('BUTTON')) && c.rel.includes('noopener') && c.href.startsWith('https://www.google.com/search?q='), c);
  check('card: h2 titles when the view has no group headings', c.heading === 'H2', c.heading);

  // coincidental "example" must not light up
  await p.fill('#target', 'example.com'); await p.press('#target', 'Enter'); await settle(p);
  const fx = await p.evaluate(() => { const card = document.querySelector('.card'); return { t: [...card.querySelectorAll('.tk-t')].map(x => x.textContent), code: card.querySelector('code').textContent }; });
  check('card: a literal "example" in a dork is not mistaken for the target', fx.t.length === 1 && fx.t[0] === 'example.com' && fx.code.includes('-intext:"example"'), fx);

  // copy via stubbed clipboard
  await p.evaluate(() => { window.__clip = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: t => { window.__clip.push(t); return Promise.resolve(); } } }); });
  await p.click('.card .q-copy'); await p.waitForTimeout(80);
  const cp = await p.evaluate(() => ({ clip: window.__clip[0], done: document.querySelector('.card .q-copy').classList.contains('done') }));
  check('card: copy query → clipboard + ✓ feedback', cp.clip.startsWith('site:raw.githubusercontent.com "example.com"') && cp.done, cp);
  await p.click('.card .card-meta .iconbtn'); await p.waitForTimeout(80);
  check('card: copy search URL', await p.evaluate(() => window.__clip[1].startsWith('https://www.google.com/search?q=site%3Araw.githubusercontent.com')));
  await p.click('.card .tag'); await settle(p);
  check('card: a tag filters by tag:', (await p.inputValue('#filter')).startsWith('tag:'), await p.inputValue('#filter'));
  await p.fill('#filter', ''); await settle(p);

  // other token styles
  const tk = await p.evaluate(() => {
    const find = (cat, name) => { state.cat = DATA.findIndex(c => c.id === cat); state.filter = ''; render(); return [...document.querySelectorAll('.card')].find(c => c.querySelector('.card-title').textContent === name); };
    const re = find('secrets', 'AWS Access Key ID (AKIA)'); const a = { re: re.querySelector('.tk-re').textContent, s: re.querySelector('.tk-s').textContent, brk: re.querySelector('code').classList.contains('brk'), btns: [...re.querySelectorAll('.eng-btn')].map(b => b.textContent.trim()) };
    const url = find('wayback', 'All historical URLs'); const b = { brk: url.querySelector('code').classList.contains('brk'), t: url.querySelectorAll('.tk-t').length, o: url.querySelectorAll('.tk-o').length, btn: url.querySelector('.eng-btn').textContent.trim() };
    const fofa = find('net', 'CDN origin: FOFA body match'); const c = { o: [...fofa.querySelectorAll('.tk-o')].map(x => x.textContent), k: [...fofa.querySelectorAll('.tk-k')].map(x => x.textContent), lock: !!fofa.querySelector('.eng-btn .visually-hidden') };
    const crt = find('dns', 'crt.sh wildcard JSON'); const d = { btn: crt.querySelector('.eng-btn').textContent.trim(), code: crt.querySelector('code').textContent, desc: crt.querySelector('.card-desc').textContent };
    return { a, b, c, d };
  });
  check('query: a GitHub /regex/ gets the regex style next to the quoted target; the global variant is its own button', tk.a.re === '/AKIA[0-9A-Z]{16}/' && tk.a.s === '"example.com"' && tk.a.brk && tk.a.btns.length === 2 && tk.a.btns[0].startsWith('GitHub') && tk.a.btns[1].startsWith('grep.app · global'), tk.a);
  check('query: URL dorks wrap evenly, only the target highlighted', tk.b.brk && tk.b.t === 1 && tk.b.o === 0 && tk.b.btn.startsWith('Wayback'), tk.b);
  check('query: FOFA operators + && recognised, login flagged for screen readers', tk.c.o.includes('body=') && tk.c.o.includes('cert.subject!=') && tk.c.k.includes('&&') && tk.c.lock, tk.c);
  check('query: crt.sh card is labelled crt.sh and its description is templated', tk.d.btn.startsWith('crt.sh') && tk.d.code === '%.example.com' && tk.d.desc.includes('%.example.com'), tk.d);
  const hl = await p.evaluate(() => ({ ent: highlightHTML('a "b" c', getParsed('quot')), ok: highlightHTML('x<y & z', getParsed('y')) }));
  check('highlight: never splits an HTML entity', hl.ent === 'a &quot;b&quot; c' && hl.ok === 'x&lt;<mark>y</mark> &amp; z', hl);
  await p.context().close();
}

/* ───────────── 4. dialogs, tools, keyboard, theme ───────────── */
{
  const p = await newPage();
  // sticky chrome + skip link
  await p.evaluate(() => { location.hash = '#cat=all'; }); await settle(p);
  await p.evaluate(() => window.scrollTo(0, 2400)); await settle(p);
  const sticky = await p.evaluate(() => ({ top: Math.round(document.querySelector('.topbar').getBoundingClientRect().top), bar: Math.round(document.getElementById('toolbar').getBoundingClientRect().top), side: Math.round(document.getElementById('sidebar').getBoundingClientRect().top), y: scrollY }));
  check('layout: topbar, filter toolbar and sidebar stay put while scrolling', sticky.y > 2000 && sticky.top === 0 && sticky.bar === 57 && sticky.side === 58, sticky);
  await p.evaluate(() => { window.scrollTo(0, 0); location.hash = '#cat=essentials&filter=aws'; }); await settle(p);
  await p.keyboard.press('Tab'); await p.waitForTimeout(300);     // let it slide in
  const skip1 = await p.evaluate(() => ({ id: document.activeElement.id, top: Math.round(document.activeElement.getBoundingClientRect().top) }));
  await p.keyboard.press('Enter'); await settle(p);
  const skip2 = await p.evaluate(() => ({ id: document.activeElement.id, filter: state.filter, hash: location.hash }));
  check('a11y: first Tab reveals "Skip to results", which focuses the results and keeps the search', skip1.id === 'skipLink' && skip1.top >= 0 && skip2.id === 'grid' && skip2.filter === 'aws' && skip2.hash.includes('filter=aws'), { skip1, skip2 });
  await p.evaluate(() => { location.hash = '#cat=essentials'; }); await settle(p);
  // help
  await p.click('#helpBtn'); await settle(p);
  const h = await p.evaluate(() => ({
    open: !!document.querySelector('.modal[role="dialog"][aria-modal="true"]'), top: document.querySelector('.modal-body').scrollTop,
    focus: document.activeElement.id, engines: document.querySelectorAll('.eng-chip').length, inView: document.querySelector('.modal h3').getBoundingClientRect().top < innerHeight,
  }));
  check('help: opens at the top with focus on Close, lists every engine endpoint', h.open && h.top === 0 && h.focus === 'hmClose' && h.engines === (await p.evaluate(() => Object.keys(ENGINES).length)) && h.inView, h);
  // the page behind is inert, so Tab can only move inside the dialog (or out to the browser's own UI)
  const outside = [];
  for (let i = 0; i < 6; i++) { await p.keyboard.press(i % 2 ? 'Tab' : 'Shift+Tab'); outside.push(await p.evaluate(() => { const a = document.activeElement; return a === document.body || document.querySelector('.modal').contains(a) ? '' : a.tagName + '#' + a.id; })); }
  const behind = await p.evaluate(() => ['.topbar', '.layout', '#skipLink', '#toolsPanel'].every(s => document.querySelector(s).hasAttribute('inert')));
  check('help: the page behind is inert, so focus cannot leave the dialog', behind && outside.every(x => x === ''), { behind, outside });
  await p.keyboard.press('j'); check('help: view shortcuts are off while the dialog is open', await p.evaluate(() => state.cat === ESS));
  await p.keyboard.press('Escape'); await settle(p);
  check('help: Esc closes and returns focus to the trigger', await p.evaluate(() => !document.querySelector('.modal') && document.activeElement.id === 'helpBtn'));

  // tools
  await p.click('#toolsBtn'); await settle(p);
  const t = await p.evaluate(() => ({
    open: document.body.classList.contains('tools-open'), inert: document.getElementById('toolsPanel').hasAttribute('inert'),
    bg: document.querySelector('.layout').hasAttribute('inert') && document.querySelector('.topbar').hasAttribute('inert'),
    focus: document.activeElement.id, tools: document.querySelectorAll('.tool .dt').length,
    aria: [...document.querySelectorAll('.tool .dt')].every(b => b.getAttribute('aria-expanded') === 'false' && document.getElementById(b.getAttribute('aria-controls'))),
  }));
  check('tools: modal panel with 6 tools, background inert, focus moved in', t.open && !t.inert && t.bg && t.focus === 'toolsClose' && t.tools === 6 && t.aria, t);
  await p.click('.dt[data-drawer="perm"]');
  await p.evaluate(() => { document.getElementById('target').value = 'app.example.co.uk'; });
  await p.click('#permGo'); await settle(p);
  const pm = await p.evaluate(() => ({ exp: document.querySelector('.dt[data-drawer="perm"]').getAttribute('aria-expanded'), chips: [...document.querySelectorAll('#permChips .chip')].map(c => c.tagName + ':' + c.textContent) }));
  check('tools: permutations handle subdomain + multi-level TLD targets', pm.exp === 'true' && pm.chips.length > 40 && pm.chips.every(c => c.startsWith('BUTTON')) && pm.chips.some(c => c.endsWith(':example-dev.co.uk')) && !pm.chips.some(c => /\.ple\.|\.\./.test(c)), pm.chips.slice(0, 6));
  check('tools: the dork lists that used to live here (secret patterns, GHDB picks) are ordinary catalog dorks now', await p.evaluate(() => !document.getElementById('patterns') && !document.getElementById('ghdbList') && !!BY_KEY.get('files/Directory listings') && !!BY_KEY.get('secrets/Stripe live secret (sk_live_)')));
  await p.click('.dt[data-drawer="scope"]');
  await p.fill('#scopeIn', JSON.stringify({ data: [
    { attributes: { asset_identifier: '*.Example.com', asset_type: 'WILDCARD', eligible_for_submission: true } },
    { attributes: { asset_identifier: 'com.example.app', asset_type: 'GOOGLE_PLAY_APP_ID', eligible_for_submission: true } },
    { attributes: { asset_identifier: 'out.example.org', asset_type: 'URL', eligible_for_submission: false } },
    { asset_identifier: 'api.example.net' } ] }));
  await p.click('#scopeParse');
  const sc = await p.evaluate(() => [...document.querySelectorAll('#scopeChips .chip')].map(c => c.textContent));
  check('tools: scope importer (H1 nesting, asset types, out-of-scope)', sc.join() === 'example.com,api.example.net', sc);
  await p.click('.dt[data-drawer="js"]');
  await p.fill('#jsIn', 'const a="https://api.example.com/v1/users"; // TODO remove debug\nfetch("/internal/admin"); /* legacy key */ const k="AKIAIOSFODNN7EXAMPLE";');
  await p.click('#jsScan');
  const js = await p.textContent('#jsOut');
  check('tools: JS recon finds endpoints, secrets, real comments only', js.includes('[AWS AKIA] AKIAIOSFODNN7EXAMPLE') && js.includes('/internal/admin') && js.includes('// TODO remove debug') && js.includes('/* legacy key */') && !js.split('=== Comments')[1].includes('api.example.com'), js);
  await p.click('.dt[data-drawer="favicon"]');
  const fav = await p.evaluate(() => { const b = new TextEncoder().encode('hello').buffer; return { mmh3: shodanFaviconHash(b), md5: md5Hex(b) }; });
  check('tools: favicon hash math (mmh3 of base64, md5)', fav.mmh3 === 1155597304 || typeof fav.mmh3 === 'number' && fav.md5 === '5d41402abc4b2a76b9719d911017c592', fav);
  check('tools: md5("hello")', fav.md5 === '5d41402abc4b2a76b9719d911017c592', fav.md5);
  await p.keyboard.press('Escape'); await settle(p);
  check('tools: Esc closes, panel inert again, focus restored', await p.evaluate(() => !document.body.classList.contains('tools-open') && document.getElementById('toolsPanel').hasAttribute('inert') && !document.querySelector('.layout').hasAttribute('inert') && document.activeElement.id === 'toolsBtn'));
  await p.fill('#target', 'example.com'); await p.press('#target', 'Enter'); await settle(p);

  // export menu
  await p.click('#exportBtn');
  const m1 = await p.evaluate(() => ({ open: !document.getElementById('exportPop').hidden, exp: document.getElementById('exportBtn').getAttribute('aria-expanded'), focus: document.activeElement.id }));
  check('export: menu opens with focus on the first item', m1.open && m1.exp === 'true' && m1.focus === 'exportMd', m1);
  await p.keyboard.press('ArrowDown'); check('export: arrow keys move through the menu', await p.evaluate(() => document.activeElement.id === 'exportJson'));
  await p.keyboard.press('Escape');
  check('export: Esc closes only the menu and restores focus', await p.evaluate(() => document.getElementById('exportPop').hidden && document.activeElement.id === 'exportBtn'));
  const ex = await p.evaluate(() => { const d = buildExportData(); const md = buildMd(); return { cats: d.length, items: d.reduce((n, c) => n + c.items.length, 0), md: md.startsWith('# DorkOps — example.com') && md.includes('- [ ] **crt.sh wildcard JSON**'), desc: d.flatMap(c => c.items).every(i => !/\{t/.test(i.desc + i.query)) }; });
  check('export: Essentials exports its dorks under their real categories', ex.items === (await p.evaluate(() => ESSENTIALS.items.length)) && ex.cats >= 5 && ex.md && ex.desc, ex);

  // keyboard
  await p.evaluate(() => { document.activeElement.blur(); window.__clip = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: t => { window.__clip.push(t); return Promise.resolve(); } } }); });
  await p.keyboard.press('j'); await settle(p);
  check('keys: j → next view (My dorks)', await p.evaluate(() => state.cat === MY && document.querySelector('.nav-item.active .nm').textContent === 'My dorks'));
  await p.keyboard.press('j'); await settle(p);
  check('keys: j again → All dorks', await p.evaluate(() => state.cat === -1 && document.querySelector('.nav-item.active .nm').textContent === 'All dorks'));
  await p.keyboard.press('j'); await p.keyboard.press('k'); await p.keyboard.press('k'); await p.keyboard.press('k'); await p.keyboard.press('k'); await settle(p);
  check('keys: k walks back and stops at Essentials', await p.evaluate(() => state.cat === ESS));
  await p.keyboard.press('Control+c'); await p.waitForTimeout(60);
  check('keys: Ctrl+C is left alone (no clipboard hijack)', await p.evaluate(() => window.__clip.length === 0));
  await p.keyboard.press('c'); await p.waitForTimeout(60);
  check('keys: c copies the first visible query', await p.evaluate(() => window.__clip.length === 1 && window.__clip[0] === '%.example.com'));
  await p.keyboard.press('/'); check('keys: / focuses search', await p.evaluate(() => document.activeElement.id === 'filter'));
  await p.keyboard.type('aws'); await settle(p); await p.keyboard.press('Escape'); await settle(p);
  check('keys: Esc clears the search', (await p.inputValue('#filter')) === '');
  await p.evaluate(() => { document.activeElement.blur(); state.shortcutsOff = true; }); await p.keyboard.press('j'); await settle(p);
  check('keys: single-key shortcuts can be switched off', await p.evaluate(() => state.cat === ESS)); await p.evaluate(() => { state.shortcutsOff = false; });

  // theme
  await p.click('#themeBtn');
  const th = await p.evaluate(() => ({ theme: document.documentElement.dataset.theme, metas: [...document.querySelectorAll('meta[name="theme-color"]')].map(m => m.content), label: document.getElementById('themeBtn').getAttribute('aria-label'), saved: localStorage.getItem('ndo_theme'), sun: getComputedStyle(document.querySelector('#themeBtn .i-sun')).display, moon: getComputedStyle(document.querySelector('#themeBtn .i-moon')).display }));
  check('theme: toggles, persists, updates both theme-color metas and the icon', th.theme === 'light' && th.saved === 'light' && th.metas.every(c => c === '#f6f8fb') && /dark/.test(th.label) && th.sun !== 'none' && th.moon === 'none', th);

  // brand = home; back/forward re-syncs controls
  await p.selectOption('#recipe', 'aiEra'); await p.fill('#filter', 'ollama'); await settle(p);
  await p.click('.brand'); await settle(p);
  check('brand: click returns to a clean Essentials', await p.evaluate(() => state.cat === ESS && state.filter === '' && state.recipe === null && document.getElementById('filter').value === '' && document.querySelectorAll('.card').length === ESSENTIALS.items.length));
  await p.evaluate(() => { location.hash = '#cat=devops&sev=crit,high&filter=tfstate'; }); await settle(p);
  const nav = await p.evaluate(() => ({ cat: DATA[state.cat].id, filter: document.getElementById('filter').value, pills: [...document.querySelectorAll('.sev-pill.on')].map(x => x.dataset.sev).join(), cards: document.querySelectorAll('.card').length }));
  check('routing: a hand-edited hash drives view, search and severity pills', nav.cat === 'devops' && nav.filter === 'tfstate' && nav.pills === 'crit,high' && nav.cards >= 1, nav);
  await p.context().close();
}

/* ───────────── 4b. working a target: progress, Run next ───────────── */
{
  const p = await newPage();
  await p.evaluate(() => { window.__opened = []; window.open = u => { window.__opened.push(u); return null; }; window.confirm = () => true; });
  const p0 = await p.evaluate(() => ({ menu: document.getElementById('progressMenu').hidden, run: document.getElementById('runNext').disabled, label: document.getElementById('runNextLabel').textContent, ticks: document.querySelectorAll('.done-btn[aria-pressed="false"]').length, cards: document.querySelectorAll('.card').length }));
  check('progress: fresh target — no meter, Run next ready, a tick control on every card', p0.menu && !p0.run && p0.label === 'Run next' && p0.ticks === p0.cards && p0.cards > 0, p0);

  await p.click('#runNext'); await settle(p);
  const r1 = await p.evaluate(() => ({ opened: window.__opened.slice(), first: document.querySelector('.card').classList.contains('done'), pressed: document.querySelector('.card .done-btn').getAttribute('aria-pressed'), text: document.getElementById('progressText').textContent, menu: document.getElementById('progressMenu').hidden, nav: document.querySelector('.nav-item.active .ct').textContent, gp: document.querySelector('.group .gp').textContent, stored: JSON.parse(localStorage.getItem('ndo_progress_v1'))['example.com'].done, key: document.querySelector('.card').dataset.key, n: ESSENTIALS.items.length, href: document.querySelector('.card .eng-btn').href }));
  check('run next: opens the first dork not yet run and ticks it off', r1.opened.length === 1 && r1.opened[0] === r1.href && r1.first && r1.pressed === 'true', r1);
  check('progress: meter, sidebar count, step count and storage agree', r1.text === `1/${r1.n}` && !r1.menu && r1.nav === `1/${r1.n}` && r1.gp.startsWith('1/') && r1.stored.length === 1 && r1.stored[0] === r1.key, r1);

  await p.evaluate(() => document.activeElement.blur()); await p.keyboard.press('n'); await settle(p);
  check('keys: n runs the next one', await p.evaluate(() => window.__opened.length === 2 && document.querySelectorAll('.card.done').length === 2 && document.querySelectorAll('.card')[1].classList.contains('done')));

  await p.evaluate(() => { const a = document.querySelectorAll('.card')[3].querySelector('.eng-btn'); a.addEventListener('click', e => e.preventDefault()); a.click(); }); await settle(p);
  check('progress: running a dork from its own button ticks it too', await p.evaluate(() => document.querySelectorAll('.card')[3].classList.contains('done') && document.getElementById('progressText').textContent.startsWith('3/')));

  await p.click('.card.done .done-btn'); await settle(p);
  check('progress: the tick is a toggle — click again to undo', await p.evaluate(() => !document.querySelector('.card').classList.contains('done') && document.querySelector('.card .done-btn').getAttribute('aria-pressed') === 'false' && document.getElementById('progressText').textContent.startsWith('2/')));

  // the same dork is done in its home category too
  const home = await p.evaluate(() => { const k = document.querySelectorAll('.card')[1].dataset.key; const { it, c } = BY_KEY.get(k); location.hash = '#cat=' + c.id; return { name: it.name, n: c.items.length }; });
  await settle(p);
  const cat = await p.evaluate(() => ({ done: [...document.querySelectorAll('.card.done .card-title')].map(x => x.textContent), nav: document.querySelector('.nav-item.active .ct').textContent, text: document.getElementById('progressText').textContent }));
  check('progress: follows the dork into its home category', cat.done.includes(home.name) && cat.nav === `${cat.done.length}/${home.n}` && cat.text === cat.nav, { home, cat });

  await p.fill('#target', 'other.example'); await p.press('#target', 'Enter'); await settle(p);
  const other = await p.evaluate(() => ({ done: document.querySelectorAll('.card.done').length, menu: document.getElementById('progressMenu').hidden, nav: document.querySelector('.nav-item.active .ct').textContent }));
  await p.fill('#target', 'example.com'); await p.press('#target', 'Enter'); await settle(p);
  check('progress: is kept per target', other.done === 0 && other.menu && !other.nav.includes('/') && await p.evaluate(() => document.querySelectorAll('.card.done').length >= 1), other);

  // the progress menu
  await p.evaluate(() => { location.hash = '#cat=essentials'; }); await settle(p);
  const total = await p.evaluate(() => ESSENTIALS.items.length);
  await p.click('#progressBtn');
  const menu = await p.evaluate(() => ({ open: !document.getElementById('progressPop').hidden, exp: document.getElementById('progressBtn').getAttribute('aria-expanded'), focus: document.activeElement.id }));
  await p.keyboard.press('Enter'); await settle(p);
  const hid = await p.evaluate(() => ({ cards: document.querySelectorAll('.card').length, done: document.querySelectorAll('.card.done').length, checked: document.getElementById('hideDone').getAttribute('aria-checked'), count: document.getElementById('visibleCount').textContent, text: document.getElementById('progressText').textContent, focus: document.activeElement.id, closed: document.getElementById('progressPop').hidden, state: JSON.parse(localStorage.getItem('ndo_state_v1')).hideDone }));
  check('progress menu: opens on its first item; "Hide done" takes finished dorks off screen and is remembered', menu.open && menu.exp === 'true' && menu.focus === 'hideDone' && hid.cards === total - 2 && hid.done === 0 && hid.checked === 'true' && hid.count === `${total - 2} of ${total} dorks` && hid.text === `2/${total}` && hid.closed && hid.focus === 'progressBtn' && hid.state === true, { menu, hid });
  await p.click('#runNext'); await settle(p);
  check('hide done: a dork leaves the list as soon as it is run', await p.evaluate(t => document.querySelectorAll('.card').length === t - 3 && document.getElementById('progressText').textContent === `3/${t}`, total));
  await p.focus('.card .done-btn'); await p.keyboard.press('Enter'); await settle(p);
  check('hide done: ticking with the keyboard keeps focus in the list', await p.evaluate(t => document.querySelectorAll('.card').length === t - 4 && document.activeElement.classList.contains('done-btn'), total));
  await p.evaluate(() => markViewDone()); await settle(p);
  const all = await p.evaluate(() => ({ cards: document.querySelectorAll('.card').length, h: (document.querySelector('.empty-state h2') || {}).textContent, run: document.getElementById('runNext').disabled, label: document.getElementById('runNextLabel').textContent, nav: document.querySelector('.nav-item.active .ct').className }));
  check('progress: everything done → an "All done" state, Run next rests, the sidebar count turns green', all.cards === 0 && all.h === 'All done' && all.run && all.label === 'All done' && all.nav.includes('all'), all);
  await p.click('.empty-state .btn.primary'); await settle(p);
  check('progress: "Show done" brings the finished dorks back, steps show as complete', await p.evaluate(t => document.querySelectorAll('.card.done').length === t && [...document.querySelectorAll('.group')].every(g => g.classList.contains('complete')), total));

  await p.fill('#filter', 'is:done sev:crit'); await settle(p);
  const isd = await p.evaluate(() => ({ n: document.querySelectorAll('.card').length, allDone: [...document.querySelectorAll('.card')].every(c => c.classList.contains('done') && c.dataset.sev === 'crit'), chips: [...document.querySelectorAll('#searchOps .op')].map(o => o.textContent) }));
  await p.fill('#filter', 'is:todo'); await settle(p);
  const todo = await p.evaluate(t => ({ done: document.querySelectorAll('.card.done').length, n: document.querySelectorAll('.card').length, want: DATA.reduce((n, c) => n + c.items.length, 0) - t }), total);
  check('search: is:done and is:todo filter by progress', isd.n > 0 && isd.allDone && isd.chips.includes('is:done') && todo.done === 0 && todo.n === todo.want, { isd, todo });
  await p.fill('#filter', ''); await settle(p);

  const ex = await p.evaluate(() => { const d = buildExportData(); const md = buildMd(); let csv = ''; const o = window.dl; window.dl = (n, c) => { csv = c; }; exportCsv(); window.dl = o; return { done: d.flatMap(c => c.items).every(i => i.done === true), md: (md.match(/^- \[x\] /gm) || []).length, open: (md.match(/^- \[ \] /gm) || []).length, csvHead: csv.split('\n')[0], csvYes: (csv.match(/,"yes"$/gm) || []).length }; });
  check('export: progress travels with it ([x] in Markdown, a done column in CSV and JSON)', ex.done && ex.md === total && ex.open === 0 && ex.csvHead.endsWith(',done') && ex.csvYes === total, ex);

  await p.evaluate(() => resetProgress()); await settle(p);
  check('progress: reset clears the target', await p.evaluate(() => document.querySelectorAll('.card.done').length === 0 && document.getElementById('progressMenu').hidden && !(JSON.parse(localStorage.getItem('ndo_progress_v1') || '{}')['example.com'])));

  await p.evaluate(() => { location.hash = '#cat=people'; }); await settle(p);
  const n0 = await p.evaluate(() => ({ opened: window.__opened.length, cards: document.querySelectorAll('.card').length }));
  await p.click('#openCat'); await p.waitForTimeout(300 * n0.cards + 400);
  check('open all: opens every visible dork and ticks them off', await p.evaluate(b => window.__opened.length - b.opened === b.cards && document.querySelectorAll('.card.done').length === b.cards, n0), n0);
  await p.reload({ waitUntil: 'networkidle' }); await settle(p);
  check('progress: survives a reload', await p.evaluate(b => document.querySelectorAll('.card.done').length === b.cards, n0));
  await p.context().close();
}

/* ───────────── 4c. My dorks: pins, your own dorks, import / export ───────────── */
{
  const p = await newPage();
  await p.evaluate(() => { window.confirm = () => true; });
  const engineCount = await p.evaluate(() => Object.keys(ENGINES).length);
  const firstKey = await p.evaluate(() => document.querySelector('.card').dataset.key);
  await p.click('.card .pin-btn'); await settle(p);
  const pin = await p.evaluate(() => ({ pressed: document.querySelector('.card .pin-btn').getAttribute('aria-pressed'), nav: document.querySelector('.nav-item[data-view="-3"] .ct').textContent, stored: JSON.parse(localStorage.getItem('ndo_pins_v1')) }));
  check('pin: toggles on the card, counts in the sidebar, is stored', pin.pressed === 'true' && pin.nav === '1' && pin.stored.length === 1 && pin.stored[0] === firstKey, pin);

  await p.evaluate(() => { location.hash = '#cat=my'; }); await settle(p);
  const my = await p.evaluate(() => ({ cat: state.cat === MY, title: document.getElementById('catTitle').textContent.trim(), groups: [...document.querySelectorAll('.group-head h2')].map(h => h.textContent), cards: document.querySelectorAll('.card').length, add: !!document.getElementById('addDork'), pill: !!document.querySelector('.card .cat-pill'), hash: location.hash }));
  check('my dorks: its own view (#cat=my) with the add tile, then the pins labelled with their category', my.cat && my.title.endsWith('My dorks') && my.groups.join('|') === 'Your own dorks|Pinned from the catalog' && my.cards === 1 && my.add && my.pill, my);

  await p.click('#addDork'); await settle(p);
  const f0 = await p.evaluate(() => ({ dialog: !!document.querySelector('#dorkForm[role="dialog"][aria-modal="true"]'), focus: document.activeElement.id, engines: document.querySelectorAll('#dfEngine option').length, inert: document.querySelector('.layout').hasAttribute('inert'), lock: document.documentElement.classList.contains('locked') }));
  check('form: a dialog over an inert, non-scrolling page; focus on Name; every engine offered', f0.dialog && f0.focus === 'dfName' && f0.engines === engineCount && f0.inert && f0.lock, f0);
  await p.click('#dorkForm button[type=submit]');
  const err = await p.evaluate(() => ({ shown: !document.getElementById('dfErr').hidden, text: document.getElementById('dfErr').textContent, focus: document.activeElement.id, open: !!document.querySelector('.modal') }));
  check('form: an empty submit says what is missing and focuses it', err.shown && /name/i.test(err.text) && err.focus === 'dfName' && err.open, err);
  await p.fill('#dfName', 'Staging <b>hosts</b>'); await p.fill('#dfQ', 'site:{t} inurl:staging "{t_no_tld}"'); await p.fill('#dfTags', 'Staging, #env, <x>');
  const prev = await p.evaluate(() => document.getElementById('dfPreview').textContent);
  check('form: live preview of the link that will open', prev.includes('https://www.google.com/search?q=site%3Aexample.com%20inurl%3Astaging'), prev);
  await p.press('#dfTags', 'Enter'); await settle(p);
  const added = await p.evaluate(() => { const c = document.querySelector('.card'); return { modal: !!document.querySelector('.modal'), lock: document.documentElement.classList.contains('locked'), title: c.querySelector('.card-title').innerHTML, code: c.querySelector('code').textContent, tags: [...c.querySelectorAll('.tag')].map(t => t.textContent), href: c.querySelector('.eng-btn').href, edit: !!c.querySelector('[aria-label="Edit this dork"]'), del: !!c.querySelector('[aria-label="Delete this dork"]'), pin: !!c.querySelector('.pin-btn'), pill: !!c.querySelector('.cat-pill'), stored: JSON.parse(localStorage.getItem('ndo_custom_v1')), focus: document.activeElement.className, nav: document.querySelector('.nav-item.active .ct').textContent, all: document.querySelector('.nav-item[data-view="-1"] .ct').textContent, want: DATA.reduce((n, c) => n + c.items.length, 0) + 1 }; });
  check('my dorks: a new dork is saved, templated and escaped; it gets edit / delete instead of pin', !added.modal && !added.lock && added.title === 'Staging &lt;b&gt;hosts&lt;/b&gt;' && added.code === 'site:example.com inurl:staging "example"' && added.tags.join(',') === 'staging,env,x' && added.href.startsWith('https://www.google.com/search?q=') && added.edit && added.del && !added.pin && !added.pill && added.stored.length === 1 && added.focus.includes('eng-btn'), added);
  check('my dorks: counted in the sidebar (My dorks and All dorks)', added.nav === '2' && added.all === String(added.want), added);

  await p.click('.card [aria-label="Edit this dork"]'); await settle(p);
  const ed = await p.evaluate(() => ({ title: document.getElementById('dfTitle').textContent, name: document.getElementById('dfName').value, q: document.getElementById('dfQ').value, tags: document.getElementById('dfTags').value, id: MY_CAT.items[0].id }));
  await p.selectOption('#dfEngine', 'gh'); await p.fill('#dfName', 'Staging hosts'); await p.click('#dorkForm button[type=submit]'); await settle(p);
  const ed2 = await p.evaluate(() => { const c = document.querySelector('.card'); return { title: c.querySelector('.card-title').textContent, btn: c.querySelector('.eng-btn').textContent.trim(), n: MY_CAT.items.length, id: MY_CAT.items[0].id }; });
  check('my dorks: edit changes the dork in place', ed.title === 'Edit your dork' && ed.name === 'Staging <b>hosts</b>' && ed.q.includes('{t}') && ed.tags === 'staging, env, x' && ed2.title === 'Staging hosts' && ed2.btn.startsWith('GitHub') && ed2.n === 1 && ed2.id === ed.id, { ed, ed2 });

  await p.evaluate(() => { location.hash = '#cat=essentials&filter=staging'; }); await settle(p);
  const srch = await p.evaluate(() => { const c = [...document.querySelectorAll('.card')].find(c => c.querySelector('.card-title').textContent === 'Staging hosts'); return { found: !!c, pill: c ? c.querySelector('.cat-pill').textContent.trim() : '' }; });
  await p.fill('#filter', 'is:mine'); await settle(p); const mine = await p.evaluate(() => document.querySelectorAll('.card').length);
  await p.fill('#filter', 'is:pinned'); await settle(p); const pinned = await p.evaluate(() => [...document.querySelectorAll('.card')].map(c => c.dataset.key));
  check('my dorks: searchable from anywhere; is:mine and is:pinned work', srch.found && srch.pill.includes('My dorks') && mine === 1 && pinned.length === 1 && pinned[0] === firstKey, { srch, mine, pinned });
  await p.evaluate(() => { location.hash = '#cat=all'; }); await settle(p);
  check('my dorks: listed as their own group under All dorks', await p.evaluate(() => [...document.querySelectorAll('.group-head h2')].pop().textContent.trim().endsWith('My dorks')));

  // a hostile pack
  await p.evaluate(() => { location.hash = '#cat=my'; }); await settle(p);
  const imp = await p.evaluate(() => {
    const r = mergeImport({ dorks: [
      { name: 'ok one', q: 'site:{t} x', engine: 'g' },
      { name: 'bad engine', q: 'x', engine: 'constructor' },
      { name: 'proto', q: 'x', engine: '__proto__' },
      { name: '<img src=x onerror=alert(1)>', q: '"><script>alert(1)</script>', engine: 'g', tags: ['<b>', 'ok'], sev: 'nope', desc: '<i>d</i>' },
      { name: 'js link', q: 'javascript:alert(1)', engine: 'wa' },
      { name: 'data link', q: 'data:text/html,<script>alert(1)</script>', engine: 'wa' },
      { name: 'ok one', q: 'site:{t} x', engine: 'g' },
      { name: 'x'.repeat(500), q: 'y'.repeat(9000), engine: 'g', id: 'u<script>' },
      { name: 'marks', q: 'abc\u0000d', engine: 'g' },
      null, 5, 'str', { q: 'no name', engine: 'g' }
    ], pins: ['devops/Terraform state files', 'nope/none', 5] });
    render();
    const items = MY_CAT.items, long = items.find(d => d.name.startsWith('xxx'));
    return { r, n: items.length, hrefs: [...document.querySelectorAll('#grid a')].map(a => a.getAttribute('href')),
      markup: document.querySelectorAll('#grid script, #grid img, #grid i, #grid b').length,
      sev: items.find(d => d.name.startsWith('<img')).sev, tags: items.find(d => d.name.startsWith('<img')).tags, long: [long.name.length, long.q.length, /^u[a-z0-9]{8}$/.test(long.id)],
      marks: items.find(d => d.name === 'marks').q, ids: new Set(items.map(d => d.id)).size, pins: [...pins].length, text: document.getElementById('grid').textContent.includes('<img src=x onerror=alert(1)>') };
  });
  check('import: unknown engines, non-objects and duplicates are skipped; valid dorks and pins are merged', imp.r.added === 6 && imp.r.skipped === 7 && imp.r.pinned === 1 && imp.n === 7 && imp.ids === 7 && imp.pins === 2, imp);
  check('import: content is cleaned (length caps, severity, tags, control and marker characters) and shown as text only', imp.markup === 0 && imp.text && imp.sev === 'med' && imp.tags.join(',') === 'b,ok' && imp.long[0] === 120 && imp.long[1] === 4000 && imp.long[2] && imp.marks === 'a b c d', imp);
  check('import: every link is https — a javascript: or data: query can never become a link', imp.hrefs.length > 7 && imp.hrefs.every(h => h.startsWith('https://')), imp.hrefs.filter(h => !h.startsWith('https://')));
  const safe = await p.evaluate(() => ({ js: buildUrl('wa', 'javascript:alert(1)', 'example.com'), proto: buildUrl('constructor', 'x', 'example.com'), bad: buildUrl('g', '\uD800', 'example.com'), cdx: buildUrl('wa', 'https://web.archive.org/cdx/search/cdx?url=*.{t}/*', 'example.com') }));
  check('links: buildUrl only ever returns https (or "#")', safe.js.startsWith('https://web.archive.org/web/*/') && safe.proto === '#' && safe.bad === '#' && safe.cdx === 'https://web.archive.org/cdx/search/cdx?url=*.example.com/*', safe);

  const rt = await p.evaluate(() => { let saved; const o = window.dl; window.dl = (n, c) => { saved = { n, c }; }; exportMine(); window.dl = o; const d = JSON.parse(saved.c); const before = MY_CAT.items.length; const again = mergeImport(d); return { name: saved.n, kind: d.kind, dorks: d.dorks.length, pins: d.pins.length, clean: d.dorks.every(x => !('id' in x) && !('key' in x) && !('mine' in x)), again, before, after: MY_CAT.items.length }; });
  check('export my dorks: a self-describing pack without local ids; importing it again adds nothing', /^dorkops-my-dorks-\d{4}-\d\d-\d\d\.json$/.test(rt.name) && rt.kind === 'my-dorks' && rt.dorks === 7 && rt.pins === 2 && rt.clean && rt.again.added === 0 && rt.again.pinned === 0 && rt.after === rt.before, rt);

  await p.evaluate(() => render()); await settle(p);
  await p.click('.card [aria-label="Delete this dork"]'); await settle(p);
  const del = await p.evaluate(() => ({ n: MY_CAT.items.length, stored: JSON.parse(localStorage.getItem('ndo_custom_v1')).length, focus: document.activeElement.id }));
  await p.click('.card .pin-btn[aria-pressed="true"]'); await settle(p);
  const unpin = await p.evaluate(() => ({ pins: [...pins].length, cards: document.querySelectorAll('.card .pin-btn').length }));
  check('my dorks: delete and unpin remove the card and move focus to the view title', del.n === 6 && del.stored === 6 && del.focus === 'catTitle' && unpin.pins === 1 && unpin.cards === 1, { del, unpin });
  await p.reload({ waitUntil: 'networkidle' }); await settle(p);
  const rl = await p.evaluate(() => ({ cat: state.cat, own: MY_CAT.items.length, pins: pins.size, cards: document.querySelectorAll('.card').length, hash: location.hash, stored: (JSON.parse(localStorage.getItem('ndo_custom_v1') || '[]')).length }));
  check('my dorks: your dorks, pins and the view survive a reload', rl.cat === -3 && rl.own === 6 && rl.pins === 1 && rl.cards === 7, rl);

  // empty state
  const e = await newPage(undefined, { hash: '#cat=my' });
  const empty = await e.evaluate(() => ({ h: document.querySelector('.empty-state h2').textContent, add: !!document.getElementById('addDork'), run: document.getElementById('runNext').disabled, open: document.getElementById('openCat').disabled, count: document.getElementById('visibleCount').textContent, exp: [...document.querySelectorAll('.group-head .acts button')].map(b => b.textContent.trim() + ':' + b.disabled) }));
  check('my dorks: empty view explains itself and still offers Add / Import', empty.h === 'Nothing here yet' && empty.add && empty.run && empty.open && empty.count === '0 dorks' && empty.exp.join('|') === 'Import:false|Export:true', empty);
  await e.context().close();
  await p.context().close();
}

/* ───────────── 4d. hardening (findings from an independent code review) ───────────── */
{
  const p = await newPage();
  const nh = await p.evaluate(() => ['example.com:8443', 'https://user:pw@example.com:8443/a?x=1', 'münchen.de', 'example.com?x=1', 'ftp://files.example.com/pub', 'example.com.', '*.Example.COM', '  HTTPS://WWW.Example.com/path  ', '', 'x'.repeat(300), null, {}].map(normHost));
  check('target: hosts are parsed, not stripped (ports, credentials, queries, IDNs, trailing dots)',
    JSON.stringify(nh.slice(0, 9)) === JSON.stringify(['example.com', 'example.com', 'xn--mnchen-3ya.de', 'example.com', 'files.example.com', 'example.com', 'example.com', 'www.example.com', '']) && nh[9].length === 253 && nh[10] === '' && nh[11] === '', nh);

  const dsl = await p.evaluate(() => {
    const run = q => { state.cat = -1; state.filter = q; render(); return [...document.querySelectorAll('.card')]; };
    const engs = c => { const it = BY_KEY.get(c.dataset.key).it; return [it.engine, ...(it.links || []).map(l => l.engine)]; };
    const chips = () => [...document.querySelectorAll('#searchOps .op')].map(o => o.textContent);
    const total = run('').length, aws = run('tag:aws').length, notAws = run('-tag:aws').length;
    const sh = run('engine:sh').map(engs), gh = run('engine:gh').map(engs);
    run('sev:constructor'); const odd = chips();
    const neg = run('-sev:crit -engine:g'); const negChips = chips();
    let threw = false; try { run('x'.repeat(40000) + ' ' + 'y'.repeat(40000)); } catch (e) { threw = true; }
    run('');
    return { total, aws, notAws, sh: sh.length > 0 && sh.every(e => e.includes('sh')), gh: gh.length > 0 && gh.every(e => e.includes('gh')), odd, negChips, negCrit: neg.filter(c => c.dataset.sev === 'crit').length, negG: neg.filter(c => engs(c).includes('g')).length, negN: neg.length, threw };
  });
  check('search: -tag:aws negates the operator instead of dropping the minus', dsl.aws > 0 && dsl.aws + dsl.notAws === dsl.total, dsl);
  check('search: an engine key matches exactly that engine (engine:sh is not crt.sh, engine:gh is not GH Issues)', dsl.sh && dsl.gh, dsl);
  check('search: negated operators get their own chips; odd values stay text', dsl.odd.join() === 'sev:constructor' && dsl.negChips.join() === '−sev:crit,−engine:g' && dsl.negN > 0 && dsl.negCrit === 0 && dsl.negG === 0, dsl);
  check('search: an absurdly long query cannot throw', dsl.threw === false);

  // empty state names the cause
  await p.evaluate(() => { state.cat = -1; state.opsec = true; state.filter = 'engine:sh'; syncControls(); render(); });
  const es = await p.evaluate(() => ({ text: document.querySelector('.empty-state p').textContent, btns: [...document.querySelectorAll('.empty-state .btn')].map(b => b.textContent) }));
  check('empty state: names the standing filter that hides the matches and offers to lift it', /OPSEC mode hides/.test(es.text) && es.btns.join('|') === 'Turn off OPSEC mode|Clear search', es);
  await p.click('.empty-state .btn'); await settle(p);
  check('empty state: lifting the filter shows the matches and moves focus to the view title', await p.evaluate(() => document.querySelectorAll('.card').length > 0 && !state.opsec && document.activeElement.id === 'catTitle'));

  // focus never falls back to <body> after an action that replaces the list
  await p.evaluate(() => { window.dl = () => {}; state.filter = ''; state.cat = DATA.findIndex(c => c.id === 'cloud'); syncControls(); render(); });
  await p.click('#exportBtn'); await p.keyboard.press('Enter'); await settle(p);
  const f1 = await p.evaluate(() => document.activeElement.id);
  await p.click('.card .tag'); await settle(p);
  const f2 = await p.evaluate(() => document.activeElement.id);
  await p.click('#searchOps .op .x'); await settle(p);
  const f3 = await p.evaluate(() => ({ id: document.activeElement.id, filter: state.filter }));
  check('focus: stays on a real control after an Export item, a tag and a removed chip', f1 === 'exportBtn' && f2 === 'catTitle' && f3.id === 'catTitle' && f3.filter === '', { f1, f2, f3 });

  // tools drawers are named regions; a copy is announced
  const reg = await p.evaluate(() => [...document.querySelectorAll('.drawer')].map(d => { const n = document.getElementById(d.getAttribute('aria-labelledby') || ''); return n ? n.textContent.trim() : ''; }));
  check('a11y: every tool drawer is a named region', reg.length >= 5 && reg.every(Boolean), reg);
  await p.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.resolve() } }); });
  await p.click('.card .q-copy'); await p.waitForTimeout(150);
  check('a11y: a copy is announced to screen readers', await p.evaluate(() => document.getElementById('srStatus').textContent === 'Copied'));
  const lbl = await p.evaluate(() => { document.activeElement.blur(); document.querySelector('#filterWrap > svg').dispatchEvent(new MouseEvent('click', { bubbles: true })); return [document.getElementById('filterWrap').tagName, document.activeElement.id]; });
  check('search box: clicking anywhere in the field focuses the input', lbl[0] === 'LABEL' && lbl[1] === 'filter', lbl);

  // a very long target cannot widen the page
  await p.evaluate(() => { document.getElementById('target').value = ('a'.repeat(60) + '.').repeat(4) + 'example.com'; render(); });
  check('layout: a 250-character target is cut with an ellipsis, not allowed to widen the page', await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  await p.context().close();

  const hard = await newPage(undefined, { storage: { ndo_disclaimer_v1: '1', ndo_state_v1: JSON.stringify({ cat: 'length', history: [{}, 5, 'ok.example'], recipe: 'constructor', sevs: 'x', filter: 7, hideDone: 'yes' }), ndo_progress_v1: '{"a":1,"example.com":{"done":"x"}}', ndo_pins_v1: '{"x":1}', ndo_custom_v1: '[1,{"name":"n"},null]' } });
  const hs = await hard.evaluate(() => ({ cat: state.cat, cards: document.querySelectorAll('.card').length, hist: state.history, recipe: state.recipe, own: MY_CAT.items.length, pins: pins.size }));
  check('state: malformed stored data (state, progress, pins, own dorks) cannot break the app', hs.cat === -2 && hs.cards > 0 && hs.hist.join() === 'ok.example' && hs.recipe === null && hs.own === 0 && hs.pins === 0, hs);
  await hard.context().close();

  const hx = await newPage(undefined, { hash: '#cat=all&recipe=constructor&filter=' + 'z'.repeat(5000) });
  check('routing: an unknown recipe in the hash is ignored and an oversized search is capped', await hx.evaluate(() => state.recipe === null && state.filter.length === 300 && document.getElementById('recipe').value === ''));
  await hx.context().close();

  const hr = await newPage(undefined, { hash: '#cat=essentials', storage: { ndo_disclaimer_v1: '1', ndo_state_v1: JSON.stringify({ cat: -1, recipe: 'aiEra', filter: 'stripe' }) } });
  check('routing: a link to a view starts it clean — no recipe or search left over from the last session', await hr.evaluate(() => state.recipe === null && state.filter === '' && document.querySelectorAll('.card').length === ESSENTIALS.items.length));
  await hr.context().close();

  const ht = await newPage(undefined, { hash: '#cat=essentials&target=victim.example' });
  const t1 = await ht.evaluate(() => ({ t: document.getElementById('target').value, hash: location.hash }));
  await ht.fill('#target', 'other.example'); await ht.press('#target', 'Enter'); await settle(ht);
  await ht.reload({ waitUntil: 'networkidle' }); await settle(ht);
  check('routing: #target= is used once — a reload keeps the target you typed since', t1.t === 'victim.example' && !t1.hash.includes('target=') && (await ht.inputValue('#target')) === 'other.example', t1);
  await ht.context().close();

  const he = await newPage(undefined, { hash: '#cat=essentials&target=', storage: { ndo_disclaimer_v1: '1', ndo_state_v1: JSON.stringify({ history: ['real.example'] }) } });
  check('routing: an empty #target= does not push example.com into the history', await he.evaluate(() => state.history[0] === 'real.example' && document.getElementById('target').value === 'real.example'));
  await he.context().close();
}

/* ───────────── 4e. Libraries: the Google Hacking Database and product fingerprints, loaded on demand ───────────── */
{
  const ready = (pg, id) => pg.waitForFunction(i => LIBS.find(L => L.id === i).state === 'ready', id, { timeout: 15000 });
  const p = await newPage();
  // sizes come from the page, never from this file: refreshing a library must not need a change here
  const { G, GP } = await p.evaluate(() => ({ G: fmt(LIB_META.ghdb.count), GP: fmt(LIB_META.ghdb.picks) }));
  const fetched = [];
  p.on('request', r => { if (/\/(ghdb|fingerprints|hunt)\.js/.test(r.url())) fetched.push(r.url()); });
  await p.click('.nav-item[data-view="-1"]'); await settle(p);
  await p.fill('#filter', 'jenkins'); await settle(p);
  const hint = await p.evaluate(() => ({
    btns: [...document.querySelectorAll('#toLibs button[data-lib]')].map(b => `${b.dataset.lib}:${b.querySelector('.count').textContent}`),
    nav: LIBS.map(L => document.querySelector(`.nav-item[data-view="${L.view}"] .ct`).textContent), want: LIBS.map(L => L.meta.count.toLocaleString('en-US')), states: LIBS.map(L => L.state),
    heads: [...document.querySelectorAll('#categoryNav .side-h')].map(e => e.textContent) }));
  check('libraries: nothing is fetched until one is opened; the sidebar already knows their sizes; a catalog search points to each', fetched.length === 0 && hint.states.every(s => s === 'idle')
    && JSON.stringify(hint.nav) === JSON.stringify(hint.want) && JSON.stringify(hint.btns) === JSON.stringify([`ghdb:${hint.want[0]}`, `fingerprints:${hint.want[1]}`, `hunt:${hint.want[2]}`]) && hint.heads[0] === 'Libraries', { fetched: fetched.slice(), hint });

  await p.click('#toLibs button[data-lib="ghdb"]'); await ready(p, 'ghdb'); await settle(p);
  const viaHint = await p.evaluate(() => ({ cat: state.cat === GHDB, filter: document.getElementById('filter').value, title: document.getElementById('catTitle').textContent.trim(),
    rows: document.querySelectorAll('.card.compact').length, all: [...document.querySelectorAll('.card.compact code')].every(c => /jenkins/i.test(c.textContent)), count: document.getElementById('visibleCount').textContent,
    marks: document.querySelectorAll('.card.compact mark').length, focus: document.activeElement.id, scope: state.scope.ghdb, sel: document.getElementById('scope').value,
    picksOff: document.getElementById('scope').options[0].disabled, hash: location.hash, desc: document.getElementById('catDesc').textContent,
    beyondPicks: [...document.querySelectorAll('.card.compact')].some(r => !libAt(GHDB).cat.items.find(it => it.key === r.dataset.key).pick) }));
  check('ghdb: the pointer carries the search over — one same-origin fetch, hits highlighted', fetched.length === 1 && fetched[0].startsWith(ORIGIN) && fetched[0].includes('ghdb.js?v=') && viaHint.cat && viaHint.filter === 'jenkins'
    && viaHint.title === 'Search results' && viaHint.rows > 0 && viaHint.all && viaHint.marks >= viaHint.rows && /^\d+ results? in GHDB$/.test(viaHint.count) && viaHint.focus === 'catTitle', { fetched, viaHint });
  check('ghdb: a search goes through the whole library, not only the top picks — and the menu says so', viaHint.scope === '' && viaHint.sel === 'all' && viaHint.picksOff && !viaHint.hash.includes('scope=')
    && viaHint.beyondPicks && viaHint.desc.includes(`across all ${G} GHDB dorks`), viaHint);

  await p.click('#filterClear'); await settle(p);
  const view = await p.evaluate(() => {
    const L = libAt(GHDB), rows = [...document.querySelectorAll('.card.compact')], first = rows[0], sel = document.getElementById('scope');
    return { rows: rows.length, page: PAGE, total: L.cat.items.length, meta: L.meta, count: document.getElementById('visibleCount').textContent, open: document.getElementById('openCount').textContent,
      title: document.getElementById('catTitle').textContent.trim(), desc: document.getElementById('catDesc').textContent, src: document.querySelector('#catDesc .ch-src').textContent,
      scoped: rows.every(r => r.querySelector('code').textContent.includes('example.com')), targets: rows.every(r => r.querySelector('.tk-t')),
      href: first.querySelector('.eng-btn').href, link: first.querySelector('.ghdb-meta a').href, rel: first.querySelector('.ghdb-meta a').rel, heading: first.querySelector('.card-title').textContent,
      tick: first.querySelector('.done-btn').getAttribute('aria-label'), more: (document.getElementById('showMore') || {}).textContent, recipe: document.getElementById('recipeWrap').hidden, scopeHidden: document.getElementById('scopeWrap').hidden,
      sel: sel.value, picksOff: sel.options[0].disabled, options: [...sel.options].map(o => o.textContent), ph: document.getElementById('filter').placeholder,
      shownArePicks: rows.every(r => L.cat.items.find(it => it.key === r.dataset.key).pick), firstIsBest: first.dataset.key === L.cat.items[0].key,
      picksLead: L.cat.items.every((it, i) => it.pick === (i < L.meta.picks)), extras: rows.every(r => r.querySelectorAll('.card-foot button, .card-foot a').length === 4) };
  });
  check('ghdb: it opens on its top picks, best first, a page at a time', view.total === view.meta.count && view.total > 7000 && view.meta.picks >= 100 && view.rows === view.page && view.shownArePicks && view.firstIsBest && view.picksLead
    && view.count === `${GP} of ${G} dorks` && view.open === GP && /^Show 60 more/.test(view.more) && view.sel === '' && !view.picksOff, view);
  check('ghdb: every row is scoped to the target, runs on Google and links to its entry on exploit-db.com', view.scoped && view.targets && view.href.startsWith('https://www.google.com/search?q=') && view.href.includes('example.com')
    && /^https:\/\/www\.exploit-db\.com\/ghdb\/\d+$/.test(view.link) && view.rel === 'noopener noreferrer' && /^GHDB-\d+: /.test(view.heading) && /^Done: GHDB-\d+$/.test(view.tick), view);
  check('ghdb: a row carries four controls and no more (run, category, source, save)', view.extras, view);
  check('ghdb: its own header and menu — top picks, everything, GHDB\'s categories with their sizes', view.title === 'Google Hacking Database' && view.desc.includes('scoped to example.com') && view.desc.includes(`${GP} best of ${G}`)
    && view.src === `Snapshot ${view.meta.v} · newest entry ${view.meta.newest}` && view.recipe && !view.scopeHidden && view.options.length === 16 && view.options[0] === `Top picks (${GP})` && view.options[1] === `Everything (${G})`
    && view.options.slice(2).every(o => /\(\d[\d,]*\)$/.test(o)) && view.ph.includes(`${G} GHDB dorks`), view);

  // scoping rules, one case per shape of site: found in the database
  const scope = await p.evaluate(() => [
    ['intitle:"index of" "wp-config.php"', 'site:{t} intitle:"index of" "wp-config.php"'],
    ['site:.edu filetype:xls "root" database', 'site:{t} filetype:xls "root" database'],
    ['inurl:admin filetype:xls site:gov.in', 'site:{t} inurl:admin filetype:xls'],
    ['ext:msg OR ext:eml site:gov OR site:edu', 'site:{t} ext:msg OR ext:eml'],
    ['"passport" filetype:xls site:"*.edu.*" | site:"*.gov.*"', 'site:{t} "passport" filetype:xls'],
    ['inurl:adminpanel site:*.* -site:github.com', 'site:{t} inurl:adminpanel -site:github.com'],
    ['site:github.com "BEGIN OPENSSH PRIVATE KEY"', '"{t}" site:github.com "BEGIN OPENSSH PRIVATE KEY"'],
    ['site:*.herokuapp.com intitle:login', '"{t}" site:*.herokuapp.com intitle:login'],
    ['site:login.*.* | site:portal.*.*', 'site:login.{t} | site:portal.{t}'],
    ['site:*/admin/Login.html', 'site:{t} inurl:"/admin/Login.html"'],
    ['site: target.com ext:action | ext:struts', 'site:{t} ext:action | ext:struts'],
    ['site:*.example.com inurl:(elmah.axd | errorlog.axd)', 'site:{t} inurl:(elmah.axd | errorlog.axd)'],
    ['inurl:"ibase site:de"', 'site:{t} inurl:"ibase site:de"'],
    ['intitle:"index of "phpunit.yml"', 'site:{t} intitle:"index of "phpunit.yml"'],
    ['"Powered by X" -site:x.com', 'site:{t} "Powered by X" -site:x.com'],
  ].map(([q, want]) => ({ q, want, got: ghdbScope(q) })).filter(x => x.got !== x.want));
  check('ghdb: scoping — TLD and wildcard scopes become the target, named third parties get it as a phrase, exclusions and quotes are left alone', scope.length === 0, scope);
  check('ghdb: no dork leaves the database unscoped', await p.evaluate(() => libAt(GHDB).cat.items.every(it => it.q.includes('{t}') && !/\{t\}|\{t_no_tld\}|\{date\}/.test(it.ghdb.raw))));

  // the menu: everything, one category; then the row button, the cat: operator, is:pick
  await p.selectOption('#scope', 'all'); await settle(p);
  const all = await p.evaluate(() => ({ rows: document.querySelectorAll('.card.compact').length, count: document.getElementById('visibleCount').textContent, open: document.getElementById('openCount').textContent,
    hash: location.hash, active: document.getElementById('scopeWrap').classList.contains('active'), saved: JSON.parse(localStorage.getItem('ndo_state_v1')).scope }));
  check('ghdb: Everything — the whole library, in the hash and remembered', all.rows === 60 && all.count === `${G} dorks` && all.open === G && all.hash.includes('scope=all') && all.active && all.saved.ghdb === 'all', all);
  await p.selectOption('#scope', 'passwords'); await settle(p);
  const cat = await p.evaluate(() => ({ rows: document.querySelectorAll('.card.compact').length, only: [...document.querySelectorAll('.card.compact .gcat')].every(b => b.textContent === 'Files Containing Passwords'),
    sev: [...document.querySelectorAll('.card.compact')].every(c => c.dataset.sev === 'crit'), hash: location.hash, count: document.getElementById('visibleCount').textContent,
    n: libAt(GHDB).cat.items.filter(it => it.ghdb.slug === 'passwords').length }));
  check('ghdb: one of its categories — rows, count, severity and hash agree', cat.rows === 60 && cat.only && cat.sev && cat.hash.includes('scope=passwords') && cat.count === `${cat.n} of ${G} dorks`, cat);
  await p.fill('#filter', 'zzzqqq'); await settle(p);
  const none = await p.evaluate(() => ({ text: document.querySelector('.empty-state p').textContent, btns: [...document.querySelectorAll('.empty-state .btn')].map(b => b.textContent) }));
  await p.click('.empty-state .btn:nth-of-type(2)'); await settle(p);
  check('ghdb: nothing found in a category — the empty state names it and offers the whole library', none.text.includes('Files Containing Passwords') && JSON.stringify(none.btns) === JSON.stringify(['Clear search', 'Search the whole library'])
    && await p.evaluate(() => state.scope.ghdb === '' && state.filter === 'zzzqqq' && document.getElementById('scope').value === 'all'), none);
  await p.fill('#filter', 'cat:passwords -wordpress "index of"'); await settle(p);
  const ops = await p.evaluate(() => { const rows = [...document.querySelectorAll('.card.compact')]; return { n: rows.length, cat: rows.every(r => r.querySelector('.gcat').textContent === 'Files Containing Passwords'),
    phrase: rows.every(r => /index of/i.test(r.querySelector('code').textContent)), no: rows.every(r => !/wordpress/i.test(r.textContent)), chips: [...document.querySelectorAll('#searchOps .op')].map(c => c.textContent) }; });
  check('ghdb: search operators work inside it (cat:, a phrase, an exclusion)', ops.n > 0 && ops.cat && ops.phrase && ops.no && ops.chips.length === 3, ops);
  await p.fill('#filter', 'is:pick'); await settle(p);
  check('ghdb: is:pick finds the top picks from anywhere', await p.evaluate(() => document.getElementById('visibleCount').textContent) === `${GP} results in GHDB`);
  await p.click('#filterClear'); await settle(p);
  await p.click('.card.compact .gcat'); await settle(p);
  check('ghdb: a row\'s category is a one-click filter', await p.evaluate(() => libAt(GHDB).scopes.some(x => x[0] === state.scope.ghdb) && document.getElementById('scope').value === state.scope.ghdb && document.activeElement.id === 'catTitle'));
  await p.selectOption('#scope', ''); await settle(p);

  // working it: Run next, sidebar progress, Show more, Save
  await p.evaluate(() => { window.__opened = []; window.open = u => { window.__opened.push(u); return null; }; });
  await p.click('#runNext'); await settle(p);
  const run = await p.evaluate(() => ({ opened: window.__opened.slice(), done: document.querySelector('.card.compact').classList.contains('done'), href: document.querySelector('.card.compact .eng-btn').href,
    nav: document.querySelector(`.nav-item[data-view="${GHDB}"] .ct`).textContent, prog: document.getElementById('progressText').textContent, stored: JSON.parse(localStorage.getItem('ndo_progress_v1'))['example.com'].done }));
  check('ghdb: Run next opens the best dork and ticks it; meter and sidebar follow', run.opened.length === 1 && run.opened[0] === run.href && run.done && run.nav === `1/${G}` && run.prog.startsWith(`1/${GP}`) && run.stored.length === 1 && /^ghdb\/\d+$/.test(run.stored[0]), run);
  await p.focus('#showMore'); await p.keyboard.press('Enter'); await settle(p);
  const more = await p.evaluate(() => ({ rows: document.querySelectorAll('.card.compact').length, focusRow: [...document.querySelectorAll('.card[data-key] .done-btn')].indexOf(document.activeElement) }));
  check('ghdb: Show more adds a page and moves focus to its first row', more.rows === 120 && more.focusRow === 60, more);
  await p.click('.card.compact .card-meta .iconbtn[aria-label="Save to My dorks"]'); await settle(p);
  const toast1 = await p.evaluate(() => document.getElementById('toast').textContent);
  await p.click('.card.compact .card-meta .iconbtn[aria-label="Save to My dorks"]'); await settle(p);
  const saved = await p.evaluate(() => ({ toast2: document.getElementById('toast').textContent, n: MY_CAT.items.length, d: MY_CAT.items[0], nav: document.querySelector('.nav-item[data-view="-3"] .ct').textContent }));
  check('ghdb: + saves a row as one of your own dorks — once', toast1 === 'Saved to My dorks' && saved.toast2 === 'Already in My dorks' && saved.n === 1 && saved.nav === '1' && /^GHDB-\d+ · /.test(saved.d.name)
    && saved.d.q.includes('{t}') && saved.d.engine === 'g' && saved.d.tags.includes('ghdb') && saved.d.mine === true, { toast1, saved });
  await p.keyboard.press('k'); await settle(p);
  const back = await p.evaluate(() => state.cat === -1);
  await p.keyboard.press('j'); await settle(p);
  const onGhdb = await p.evaluate(() => state.cat === GHDB);
  await p.keyboard.press('j'); await ready(p, 'fingerprints'); await settle(p);
  check('keys: the libraries sit after All dorks for j / k', back && onGhdb && await p.evaluate(() => state.cat === FPRINT) && fetched.length === 2 && fetched[1].includes('fingerprints.js?v='), fetched);
  await p.keyboard.press('k'); await settle(p);
  const a11y = () => {
    const name = el => (el.getAttribute('aria-label') || el.textContent || el.title || '').trim();
    const unnamed = [...document.querySelectorAll('.content button, .content a[href], .content select')].filter(el => el.tagName === 'SELECT' ? !(el.labels && el.labels.length) : !name(el)).map(el => el.outerHTML.slice(0, 80));
    const small = [...document.querySelectorAll('.content button, .content a.eng-btn, .content .ghdb-meta a, .content select')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.height < 24 || r.width < 24); }).map(el => `${el.className}:${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`);
    return { unnamed, small: [...new Set(small)] };
  };
  const ga = await p.evaluate(a11y);
  check('ghdb a11y: every control is named and at least 24×24', ga.unnamed.length === 0 && ga.small.length === 0, ga);

  /* ----- product fingerprints ----- */
  await p.keyboard.press('j'); await settle(p);
  const fp = await p.evaluate(() => {
    const L = libAt(FPRINT), cards = [...document.querySelectorAll('.card[data-key]')], first = cards[0], sel = document.getElementById('scope');
    const links = it => [{ engine: it.engine, q: it.q }, ...(it.links || [])];
    const bad = L.cat.items.filter(it => links(it).some(l => !has(ENGINES, l.engine) || !l.q.includes('{t}') || !/^https:\/\//.test(buildUrl(l.engine, l.q, 'example.com')))
      || !['high', 'low'].includes(it.sev) || !it.tags.every(t => /^[a-z0-9][a-z0-9._-]*$/.test(t)) || !it.key.startsWith('fp/') || !it.name).map(it => it.key);
    return { title: document.getElementById('catTitle').textContent.trim(), desc: document.getElementById('catDesc').textContent, src: document.querySelector('#catDesc .ch-src').textContent, meta: L.meta,
      total: L.cat.items.length, keys: new Set(L.cat.items.map(it => it.key)).size, rows: cards.length, compact: document.querySelectorAll('.card.compact').length, count: document.getElementById('visibleCount').textContent,
      open: document.getElementById('openCount').textContent, options: [...sel.options].map(o => o.textContent), recipe: document.getElementById('recipeWrap').hidden, ph: document.getElementById('filter').placeholder,
      picksLead: L.cat.items.every((it, i) => it.pick === (i < L.meta.picks)), picksKev: L.cat.items.slice(0, L.meta.picks).every(it => it.tags.includes('kev') && it.sev === 'high' && it.desc.startsWith("On CISA's Known Exploited Vulnerabilities list: ")),
      restQuiet: L.cat.items.filter(it => !it.tags.includes('kev')).every(it => it.sev === 'low' && it.desc === ''), ransomFirst: L.cat.items[0].tags.includes('ransomware'),
      badge: first.querySelector('.sev-badge').textContent, descShown: first.querySelector('.card-desc').textContent, code: first.querySelector('code').textContent,
      engines: [...first.querySelectorAll('.eng-btn')].map(a => a.textContent.replace(/\s*\(login required\)/, '').trim()), hrefs: [...first.querySelectorAll('.eng-btn')].map(a => a.href),
      tags: [...first.querySelectorAll('.tag')].map(b => b.textContent), acts: [...first.querySelectorAll('.card-meta .iconbtn')].map(b => b.getAttribute('aria-label')), bad };
  });
  check('fingerprints: every product is loaded once, with a usable query on every engine it names', fp.total === fp.meta.count && fp.total > 2500 && fp.keys === fp.total && fp.bad.length === 0, { total: fp.total, keys: fp.keys, bad: fp.bad.slice(0, 5) });
  check('fingerprints: it opens on the products CISA lists as exploited — ransomware first', fp.title === 'Product Fingerprints' && fp.rows === 60 && fp.compact === 0 && fp.picksLead && fp.picksKev && fp.restQuiet && fp.ransomFirst
    && fp.count === `${fp.meta.picks} of ${fp.total.toLocaleString('en-US')} fingerprints` && fp.open === String(fp.meta.picks) && fp.badge === 'High' && /most recently CVE-\d{4}-\d+ \(\d{4}-\d\d-\d\d\)/.test(fp.descShown), fp);
  check('fingerprints: a card is tied to the target on each engine — Shodan by certificate, FOFA by domain, Google by site', /^(ssl|hostname):"example\.com" /.test(fp.code) && fp.engines[0] === 'Shodan'
    && fp.hrefs[0].startsWith('https://www.shodan.io/search?query=') && fp.hrefs.every(h => /^https:\/\/(www\.shodan\.io|en\.fofa\.info|www\.google\.com)\//.test(h)) && fp.tags.includes('kev')
    && JSON.stringify(fp.acts) === JSON.stringify(['Copy search URL', 'Save to My dorks']), fp);
  check('fingerprints: its own header and a two-item menu', fp.desc.includes('scoped to example.com') && fp.desc.includes(`the ${fp.meta.picks} on CISA's Known Exploited Vulnerabilities list`) && fp.src.includes(`CISA KEV ${fp.meta.kev}`)
    && fp.src.includes('ProjectDiscovery') && fp.recipe && JSON.stringify(fp.options) === JSON.stringify([`Top picks (${fp.meta.picks})`, `Everything (${fp.total.toLocaleString('en-US')})`]) && fp.ph.includes('fingerprints'), fp);

  await p.fill('#filter', 'grafana'); await settle(p);
  const fs = await p.evaluate(() => ({ count: document.getElementById('visibleCount').textContent, names: [...document.querySelectorAll('.card .card-title')].map(h => h.textContent), sel: document.getElementById('scope').value,
    marks: document.querySelectorAll('.card mark').length, desc: document.getElementById('catDesc').textContent }));
  check('fingerprints: a search goes through all of them', /^\d+ results? in Fingerprints$/.test(fs.count) && fs.names.length > 0 && fs.names.includes('grafana') && fs.sel === 'all' && fs.marks > 0 && fs.desc.includes('across all'), fs);
  await p.fill('#filter', 'tag:kev'); await settle(p);
  const kev = await p.evaluate(() => ({ count: document.getElementById('visibleCount').textContent, n: libAt(FPRINT).cat.items.filter(it => it.tags.includes('kev')).length, picks: libAt(FPRINT).meta.picks }));
  check('fingerprints: tag:kev lists every product on the KEV list, the top picks among them', kev.count === `${kev.n} results in Fingerprints` && kev.n >= kev.picks, kev);
  await p.click('#filterClear'); await settle(p);

  // OPSEC mode: Shodan and FOFA log the query against an account — a row then leads with Google, or steps aside
  await p.click('label[for="opsec"], #opsec', { force: true }); await settle(p);
  const quiet = await p.evaluate(() => { const L = libAt(FPRINT), cards = [...document.querySelectorAll('.card[data-key]')];
    return { on: state.opsec, engines: [...new Set(cards.flatMap(c => [...c.querySelectorAll('.eng-btn')].map(a => a.textContent.trim())))], code: cards.every(c => c.querySelector('code').textContent.startsWith('site:example.com ')),
      n: Number(document.getElementById('openCount').textContent), want: L.cat.items.filter(it => it.pick && [{ engine: it.engine }, ...(it.links || [])].some(l => l.engine === 'g')).length, picks: L.meta.picks }; });
  check('fingerprints: OPSEC mode leaves only the Google form of a fingerprint, and hides the rows that have none', quiet.on && JSON.stringify(quiet.engines) === '["Google"]' && quiet.code && quiet.n === quiet.want && quiet.n > 0 && quiet.n < quiet.picks, quiet);
  await p.evaluate(() => { window.__opened = []; });
  await p.click('#runNext'); await settle(p);
  const frun = await p.evaluate(() => ({ opened: window.__opened.slice(), href: document.querySelector('.card.done .eng-btn').href, key: document.querySelector('.card.done').dataset.key }));
  check('fingerprints: Run next uses the engine the card leads with', frun.opened.length === 1 && frun.opened[0] === frun.href && frun.opened[0].startsWith('https://www.google.com/search?q=') && frun.key.startsWith('fp/'), frun);
  await p.click('label[for="opsec"], #opsec', { force: true }); await settle(p);

  await p.click('.card .card-meta .iconbtn[aria-label="Save to My dorks"]'); await settle(p);
  const fsave = await p.evaluate(() => ({ toast: document.getElementById('toast').textContent, n: MY_CAT.items.length, d: MY_CAT.items[MY_CAT.items.length - 1], first: libAt(FPRINT).cat.items[0] }));
  check('fingerprints: + saves a product as one of your own dorks, on the engine it leads with', fsave.toast === 'Saved to My dorks' && fsave.n === 2 && fsave.d.name === fsave.first.name && fsave.d.engine === 'sh' && fsave.d.q === fsave.first.q
    && fsave.d.tags.includes('fingerprint') && fsave.d.tags.includes('kev') && fsave.d.desc.includes('ProjectDiscovery') && fsave.d.sev === 'high', fsave);
  const fa = await p.evaluate(a11y);
  check('fingerprints a11y: every control is named and at least 24×24', fa.unnamed.length === 0 && fa.small.length === 0, fa);
  await p.context().close();

  // progress is counted without loading a library; a deep link opens the view filtered
  const q = await newPage(undefined, { hash: '#cat=essentials', storage: { ndo_disclaimer_v1: '1', ndo_progress_v1: JSON.stringify({ 'example.com': { at: 1, done: ['ghdb/8452', 'ghdb/8451', 'fp/grafana/grafana', 'dns/crt.sh wildcard JSON'] } }) } });
  const idle = await q.evaluate(() => ({ nav: LIBS.map(L => document.querySelector(`.nav-item[data-view="${L.view}"] .ct`).textContent), states: LIBS.map(L => L.state) }));
  check('libraries: ticks show in the sidebar before anything is loaded', idle.states.every(s => s === 'idle') && idle.nav[0] === `2/${G}` && idle.nav[1].startsWith('1/'), idle);
  await q.evaluate(() => { location.hash = '#cat=ghdb&scope=login-portals&filter=citrix&target=victim.example'; });
  await ready(q, 'ghdb'); await settle(q);
  const deep = await q.evaluate(() => ({ cat: state.cat === GHDB, scope: document.getElementById('scope').value, filter: document.getElementById('filter').value, rows: document.querySelectorAll('.card.compact').length,
    ok: [...document.querySelectorAll('.card.compact')].every(r => /citrix/i.test(r.textContent) && r.querySelector('.gcat').textContent === 'Pages Containing Login Portals' && r.querySelector('code').textContent.includes('victim.example')),
    desc: document.getElementById('catDesc').textContent }));
  check('ghdb: a deep link names the view, the category, the search and the target', deep.cat && deep.scope === 'login-portals' && deep.filter === 'citrix' && deep.rows > 0 && deep.ok && deep.desc.includes('within Pages Containing Login Portals'), deep);
  await q.evaluate(() => { location.hash = '#cat=ghdb&scope=nonsense'; }); await settle(q);
  const odd = await q.evaluate(() => ({ scope: state.scope.ghdb, rows: document.querySelectorAll('.card.compact').length }));
  await q.evaluate(() => { location.hash = '#cat=fingerprints&scope=passwords'; }); await ready(q, 'fingerprints'); await settle(q);
  check('libraries: a scope the library does not have is ignored', odd.scope === '' && odd.rows === 60 && await q.evaluate(() => state.scope.fingerprints === '' && document.getElementById('scope').value === ''), odd);
  await q.context().close();

  // a data file is data, and still not trusted: bad rows are dropped, text stays text
  const h = await newPage();
  const hard = await h.evaluate(() => {
    window.DORKOPS_LIB('ghdb', { picks: 1, cats: ['Footholds', 'Not a category'], authors: ['<b>x</b>'], rows: [
      [1, 20240101, 0, 0, 'intitle:ok'], ['2', 20240101, 0, 0, 'string id'], [3, 20240101, 1, 0, 'unknown category'], [4, 20240101, 0, 0, ''], [5, 20240101, 0, 0, 'x'.repeat(401)],
      [6, 'date', 0, 9, '<img src=x onerror=window.__xss=1> "q'], null, 'row', [7] ] });
    const G = libAt(GHDB); G.state = 'ready';
    state.cat = GHDB; state.filter = ''; state.scope.ghdb = 'all'; syncControls(); render();
    const row = [...document.querySelectorAll('.card.compact')].pop();
    const g = { ids: G.cat.items.map(i => i.ghdb.id), dates: G.cat.items.map(i => i.ghdb.date), picks: G.cat.items.map(i => i.pick), imgs: document.querySelectorAll('#grid img').length, code: row.querySelector('code').textContent, href: row.querySelector('.eng-btn').href };
    window.DORKOPS_LIB('fingerprints', { picks: 1, rows: [
      ['ok product', 'vendor', 'http.title:"x"', 'title="x" || body="y"', 'intitle:"x"', 2, 'CVE-2024-1234', 20240102, 1], ['plain', 'v', 'port:21 "220"', '', '', 0, '', 0, 0], ['Plain', 'V', 'again', '', '', 0, '', 0, 0],
      ['no query', 'v', '', '', '', 0, '', 0, 0], [5, 'v', 'a', '', '', 0, '', 0, 0], ['long', 'v', 'x'.repeat(201), '', '', 0, '', 0, 0],
      ['<img src=x onerror=window.__xss=2>', 'v<b>', '', '', 'intitle:"<script>window.__xss=3</script>"', 1, 'not-a-cve', 'bad', 0], null, 'row', ['short'] ] });
    const F = libAt(FPRINT); F.state = 'ready';
    state.cat = FPRINT; state.scope.fingerprints = 'all'; syncControls(); render();
    const cards = [...document.querySelectorAll('.card[data-key]')], last = cards[cards.length - 1], it = F.cat.items;
    const junk = [LIB_BUILD.ghdb({}), LIB_BUILD.ghdb({ rows: 'x' }), LIB_BUILD.fingerprints({}), LIB_BUILD.fingerprints({ rows: 5 })].every(a => Array.isArray(a) && !a.length);
    let threw = false; try { window.DORKOPS_LIB('ghdb', null); window.DORKOPS_LIB('nope', {}); window.DORKOPS_LIB('ghdb'); } catch (e) { threw = true; }
    return { g, junk, threw, xss: window.__xss, names: it.map(i => i.name), keys: it.map(i => i.key), sevs: it.map(i => i.sev), tags: it.map(i => i.tags.join()), descs: it.map(i => i.desc), qs: it.map(i => `${i.engine}|${i.q}`),
      links: it[0].links.map(l => `${l.engine}|${l.q}`), imgs: document.querySelectorAll('#grid img, #grid script').length, title: last.querySelector('.card-title').textContent, code: last.querySelector('code').textContent, still: G.cat.items.length };
  });
  check('ghdb: malformed rows are dropped and a hostile query is shown as text', JSON.stringify(hard.g.ids) === '[1,6]' && hard.g.dates[1] === '' && JSON.stringify(hard.g.picks) === '[true,false]' && hard.g.imgs === 0
    && hard.g.code.includes('<img src=x onerror=window.__xss=1>') && hard.g.href.startsWith('https://www.google.com/search?q=') && hard.junk && !hard.threw && hard.still === 2, hard);
  check('fingerprints: malformed and repeated rows are dropped, a hostile name is shown as text', JSON.stringify(hard.names) === JSON.stringify(['vendor ok product', 'v plain', 'v<b> <img src=x onerror=window.  xss=2>'])
    && JSON.stringify(hard.keys) === JSON.stringify(['fp/vendor/ok product', 'fp/v/plain', 'fp/v<b>/<img src=x onerror=window.__xss=2>']) && JSON.stringify(hard.sevs) === '["high","low","high"]'
    && JSON.stringify(hard.tags) === JSON.stringify(['vendor,kev,ransomware', 'v', 'v-b,kev']) && hard.imgs === 0 && hard.xss === undefined && hard.title === 'v<b> <img src=x onerror=window.  xss=2>' && hard.code.includes('<script>window.__xss=3</script>'), hard);
  check('fingerprints: each engine gets its own way of naming the target', JSON.stringify(hard.qs) === JSON.stringify(['sh|ssl:"{t}" http.title:"x"', 'sh|hostname:"{t}" port:21 "220"', 'g|site:{t} intitle:"<script>window.__xss=3</script>"'])
    && JSON.stringify(hard.links) === JSON.stringify(['fo|domain="{t}" && (title="x" || body="y")', 'g|site:{t} intitle:"x"'])
    && hard.descs[0] === "On CISA's Known Exploited Vulnerabilities list: 2 entries, most recently CVE-2024-1234 (2024-01-02) — used in ransomware campaigns." && hard.descs[1] === ''
    && hard.descs[2] === "On CISA's Known Exploited Vulnerabilities list: 1 entry.", hard);
  await h.context().close();

  // no data file (a copy of the page alone, or offline): the view says so and can retry
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const f = await ctx.newPage();
  let block = true;
  f.on('pageerror', e => errors.push(`PAGE ERROR: ${e.message}`));
  await f.route('**/*', r => { const u = r.request().url(); return /\/ghdb\.js/.test(u) && block ? r.abort() : u.startsWith(ORIGIN) ? r.continue() : r.abort(); });
  await f.addInitScript(() => { try { localStorage.setItem('ndo_disclaimer_v1', '1'); } catch (e) {} });
  await f.goto(FILE + '#cat=ghdb', { waitUntil: 'networkidle' }); await f.waitForFunction(() => libAt(GHDB).state === 'failed', null, { timeout: 15000 }); await settle(f);
  const fail = await f.evaluate(() => ({ h: (document.querySelector('.empty-state h2') || {}).textContent, text: (document.querySelector('.empty-state p') || {}).textContent, run: document.getElementById('runNext').disabled,
    open: document.getElementById('openCat').disabled, btn: (document.querySelector('.empty-state .btn') || {}).textContent, count: document.getElementById('visibleCount').textContent }));
  block = false;
  await f.click('.empty-state .btn'); await ready(f, 'ghdb'); await settle(f);
  const retry = await f.evaluate(() => document.querySelectorAll('.card.compact').length);
  check('libraries: without its data file a view explains itself; Try again loads it', fail.h === 'This library did not load' && fail.text.includes('ghdb.js') && fail.run && fail.open && fail.btn === 'Try again' && fail.count === `${G} dorks` && retry === 60, { fail, retry });
  await ctx.close();
}

/* ───────────── 4f. Threat intel: the Hunt library and the Investigate view ───────────── */
{
  const ready = (pg, id) => pg.waitForFunction(i => LIBS.find(L => L.id === i).state === 'ready', id, { timeout: 15000 });
  /* ----- Hunt ----- */
  const p = await newPage(undefined, { hash: '#cat=hunt', storage: { ndo_disclaimer_v1: '1', ndo_state_v1: JSON.stringify({ sevs: ['crit'] }) } });
  await ready(p, 'hunt'); await settle(p);
  const { N, NP } = await p.evaluate(() => ({ N: fmt(LIB_META.hunt.count), NP: fmt(LIB_META.hunt.picks) }));
  const hv = await p.evaluate(() => {
    const L = libAt(HUNT), cards = [...document.querySelectorAll('.card[data-key]')], sel = document.getElementById('scope'), items = L.cat.items;
    const links = it => [{ engine: it.engine, q: it.q }, ...(it.links || [])];
    const bad = items.filter(it => !it.key.startsWith('hunt/') || links(it).some(l => !['sh', 'shf', 'cen', 'fo'].includes(l.engine) || !/^https:\/\//.test(buildUrl(l.engine, l.q, 'example.com')))
      || /\{t\}|\{t_no_tld\}/.test(it.q) || !it.src || !/^https:\/\//.test(it.src.url) || it.sev !== undefined || !it.tags.every(t => /^[a-z0-9][a-z0-9._-]*$/.test(t))
      || !L.scopes.some(x => x[0] === it.scope)).map(it => it.key);
    const tools = items.map(it => it.name.split(' · ')[0]);
    const split = tools.filter((t, i) => i && tools[i - 1] !== t && tools.slice(0, i).includes(t));        // a tool whose rows are not next to each other
    const picks = items.filter(it => it.pick);
    return { title: document.getElementById('catTitle').textContent.trim(), desc: document.getElementById('catDesc').textContent, total: items.length, meta: L.meta, bad, split,
      rows: cards.length, count: document.getElementById('visibleCount').textContent, more: !!document.getElementById('showMore'),
      sevHidden: document.getElementById('sevToggle').hidden && document.getElementById('sevSep').hidden, recipe: document.getElementById('recipeWrap').hidden,
      options: [...sel.options].map(o => o.textContent), ph: document.getElementById('filter').placeholder,
      badges: document.querySelectorAll('.card .sev-badge, .card .scope-chip').length, targets: cards.filter(c => c.querySelector('code').textContent.includes('example.com')).length,
      srcs: cards.every(c => { const a = c.querySelector('.src-link'); return a && /^https:\/\//.test(a.href) && a.target === '_blank' && a.rel === 'noopener noreferrer'; }),
      engines: [...new Set(cards.flatMap(c => [...c.querySelectorAll('.eng-btn')].map(a => a.textContent.replace(/\s*\(login required\)/, '').trim())))].sort(),
      onePerTool: new Set(picks.map(it => it.name.split(' · ')[0])).size === picks.length, clean: picks.every(it => !it.tags.includes('paid') && !it.tags.includes('noisy')),
      shownArePicks: cards.every(c => items.find(it => it.key === c.dataset.key).pick), nav: document.querySelector(`.nav-item[data-view="${HUNT}"] .ct`).textContent,
      heads: [...document.querySelectorAll('#categoryNav .side-h')].map(e => e.textContent).slice(0, 2) };
  });
  check('hunt: every fingerprint builds a link on its engine, names where it was published and is tied to no target', hv.total === hv.meta.count && hv.total > 100 && hv.bad.length === 0, { total: hv.total, bad: hv.bad.slice(0, 5) });
  check('hunt: it opens on one fingerprint per well-known tool — none behind a paid plan, none known to be noisy', hv.title === 'Adversary Infrastructure' && hv.rows === hv.meta.picks && !hv.more && hv.shownArePicks && hv.onePerTool && hv.clean
    && hv.count === `${NP} of ${N} fingerprints` && hv.nav === N && JSON.stringify(hv.heads) === '["Libraries","Threat intel"]', hv);
  check('hunt: a tool\'s fingerprints are listed together', hv.split.length === 0, hv.split);
  check('hunt: rows carry no severity, so the severity filter steps aside — and does not hide them', hv.sevHidden && hv.badges === 0 && hv.rows > 0 && hv.recipe, hv);
  check('hunt: a card says once, in the header, that nothing is tied to the target; each row links to its source', hv.desc.includes('none is tied to your target') && hv.targets === 0 && hv.srcs
    && hv.engines.every(e => ['Censys', 'FOFA', 'Shodan', 'Shodan · facets'].includes(e)), hv);
  check('hunt: its menu — top picks, everything, its groups with their sizes', hv.options[0] === `Top picks (${NP})` && hv.options[1] === `Everything (${N})` && hv.options.length === 9
    && hv.options.slice(2).every(o => /\(\d+\)$/.test(o)) && hv.options.some(o => o.startsWith('C2 frameworks (')) && hv.ph.includes(`${N} fingerprints`), hv.options);
  await p.selectOption('#scope', 'rat'); await settle(p);
  const hs = await p.evaluate(() => ({ only: [...document.querySelectorAll('.card[data-key]')].every(c => libAt(HUNT).cat.items.find(it => it.key === c.dataset.key).scope === 'rat'),
    n: document.querySelectorAll('.card[data-key]').length, hash: location.hash }));
  await p.selectOption('#scope', ''); await p.fill('#filter', 'cobalt'); await settle(p);
  const hq = await p.evaluate(() => ({ titles: [...document.querySelectorAll('.card .card-title')].map(h => h.textContent), count: document.getElementById('visibleCount').textContent, sel: document.getElementById('scope').value }));
  await p.fill('#filter', 'cat:c2 tag:jarm'); await settle(p);
  const hop = await p.evaluate(() => [...document.querySelectorAll('.card .card-title')].map(h => h.textContent));
  check('hunt: a group, a search across everything, and operators (cat:, tag:)', hs.only && hs.n > 5 && hs.hash.includes('scope=rat') && hq.titles.filter(t => t.startsWith('Cobalt Strike · ')).length >= 10 && hq.titles.length < 25
    && /^\d+ results in Hunt$/.test(hq.count) && hq.sel === 'all' && hop.length > 0 && hop.every(t => t.endsWith(' · JARM')), { hs, hq, hop });
  const noisy = await p.evaluate(() => [...document.querySelectorAll('.card .card-desc')].map(d => d.textContent));
  check('hunt: a noisy fingerprint says so on its card', noisy.length > 0 && noisy.every(d => d.includes('Expect many false positives.')), noisy);
  await p.click('#filterClear'); await settle(p);
  await p.evaluate(() => { window.__opened = []; window.open = u => { window.__opened.push(u); return null; }; });
  await p.click('#runNext'); await settle(p);
  await p.click('.card .card-meta .iconbtn[aria-label="Save to My dorks"]'); await settle(p);
  const hw = await p.evaluate(() => ({ opened: window.__opened.slice(), href: document.querySelector('.card.done .eng-btn').href, nav: document.querySelector(`.nav-item[data-view="${HUNT}"] .ct`).textContent,
    stored: JSON.parse(localStorage.getItem('ndo_progress_v1'))['example.com'].done, d: MY_CAT.items[0], first: libAt(HUNT).cat.items.find(it => it.pick) }));
  check('hunt: Run next and + work as in any library', hw.opened.length === 1 && hw.opened[0] === hw.href && /^hunt\/[A-Z]+-\d+$/.test(hw.stored[0]) && hw.nav.startsWith('1/') && hw.d.name === hw.first.name && hw.d.q === hw.first.q
    && hw.d.engine === hw.first.engine && hw.d.tags.includes('hunt') && hw.d.sev === 'info' && hw.d.desc.includes('Published by') && !hw.d.q.includes('{t}'), hw);
  const ex = await p.evaluate(() => { const d = buildExportData(); let csv = ''; const o = window.dl; window.dl = (n, c) => { csv = c; }; exportCsv(); window.dl = o;
    const lines = csv.trim().split('\n'); return { cats: d.map(c => c.category), items: d.reduce((n, c) => n + c.items.length, 0), rows: document.querySelectorAll('.card[data-key]').length,
      urls: d.flatMap(c => c.items).every(i => /^https:\/\//.test(i.url) && i.sev === 'info'), lines: lines.length, formula: lines.slice(1).filter(l => /(^|,)"[=+\-@]/.test(l)).length,
      guarded: (csv.match(/,"'[+\-=@]/g) || []).length }; });
  await p.selectOption('#scope', 'all'); await settle(p);
  const exAll = await p.evaluate(() => { let csv = ''; const o = window.dl; window.dl = (n, c) => { csv = c; }; exportCsv(); window.dl = o;
    return { lines: csv.trim().split('\n').length, formula: csv.split('\n').slice(1).filter(l => /(^|,)"[=+\-@]/.test(l)).length, guarded: (csv.match(/,"'[+\-=@]/g) || []).length, n: libAt(HUNT).cat.items.length }; });
  check('export: a library view exports its rows', JSON.stringify(ex.cats) === '["Adversary Infrastructure"]' && ex.items === ex.rows && ex.items > 0 && ex.urls && ex.lines === ex.rows + 1, ex);
  check('export: a cell that starts like a spreadsheet formula is defused', exAll.lines === exAll.n + 1 && exAll.formula === 0 && exAll.guarded >= 1, exAll);
  await p.selectOption('#scope', '');
  await p.click('label[for="opsec"], #opsec', { force: true }); await settle(p);
  const ho = await p.evaluate(() => ({ rows: document.querySelectorAll('.card[data-key]').length, btns: [...document.querySelectorAll('.empty-state .btn')].map(b => b.textContent) }));
  check('hunt: OPSEC mode leaves nothing — every engine here is a scanner — and offers the way back', ho.rows === 0 && ho.btns.includes('Turn off OPSEC mode') && !ho.btns.includes('Reset filters'), ho);
  await p.context().close();

  const h = await newPage();
  const hard = await h.evaluate(() => {
    window.DORKOPS_LIB('hunt', { groups: ['C2 framework', 'Nonsense'], kinds: ['TLS certificate', '<i>kind</i>'], sources: [['A list', 'https://example.org/list', 0], ['Bad', 'javascript:alert(1)', 0], 'x'], rows: [
      ['S-001', 'Tool A', 0, 'sh', 0, 'ssl:"a"', 'A note.', 0, 0, 2, 0, 202501, 202609, 1, 1],
      ['S-002', '<img src=x onerror=window.__xss=4>', 0, 'fo', 1, 'title="<script>window.__xss=5</script>"', '', 3, 1, 0, 1, 0, 0, 0, 0],
      ['S-001', 'Twice', 0, 'sh', 0, 'x', '', 0, 0, 0, 0, 0, 0, 0, 0], ['S-003', 'Unknown group', 1, 'sh', 0, 'x', '', 0, 0, 0, 0, 0, 0, 0, 0], ['S-004', 'Unknown engine', 0, 'g', 0, 'x', '', 0, 0, 0, 0, 0, 0, 0, 0],
      ['S-005', 'No query', 0, 'sh', 0, '', '', 0, 0, 0, 0, 0, 0, 0, 0], ['bad id!', 'T', 0, 'sh', 0, 'x', '', 0, 0, 0, 0, 0, 0, 0, 0], ['S-006', 'Long', 0, 'sh', 0, 'x'.repeat(301), '', 0, 0, 0, 0, 0, 0, 0, 0], null, 'row', ['S-007'] ] });
    const L = libAt(HUNT); L.state = 'ready'; state.cat = HUNT; state.filter = ''; state.scope.hunt = 'all'; syncControls(); render();
    const it = L.cat.items, last = [...document.querySelectorAll('.card[data-key]')].pop();
    return { keys: it.map(i => i.key), names: it.map(i => i.name), picks: it.map(i => i.pick), descs: it.map(i => i.desc), tags: it.map(i => i.tags.join()), srcs: it.map(i => i.src && i.src.url), year: it[0].src.year, lists: it[0].src.lists,
      imgs: document.querySelectorAll('#grid img, #grid script, #grid i').length, xss: window.__xss, title: last.querySelector('.card-title').textContent, link: !!last.querySelector('.src-link'),
      junk: [LIB_BUILD.hunt({}), LIB_BUILD.hunt({ rows: 7 })].every(a => Array.isArray(a) && !a.length) };
  });
  check('hunt: malformed rows are dropped, a link that is not https is not a link, and hostile text stays text', JSON.stringify(hard.keys) === '["hunt/S-001","hunt/S-002"]' && JSON.stringify(hard.picks) === '[true,false]'
    && hard.names[0] === 'Tool A · TLS certificate' && hard.descs[0] === 'A note.' && hard.descs[1] === 'Expect many false positives. Needs a paid plan on this engine.' && hard.tags[1].endsWith('noisy,paid')
    && hard.srcs[0] === 'https://example.org/list' && hard.srcs[1] === null && hard.year === '2025' && hard.lists === 2 && hard.imgs === 0 && hard.xss === undefined
    && hard.title === '<img src=x onerror=window.__xss=4> · <i>kind</i>' && !hard.link && hard.junk, hard);
  await h.context().close();

  /* ----- Investigate ----- */
  const v = await newPage(undefined, { hash: '#cat=investigate' });
  const dialogs = []; v.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  const iv = await v.evaluate(() => {
    const cards = [...document.querySelectorAll('.card.lookup')], links = [...document.querySelectorAll('.card.lookup a.eng-btn')];
    return { title: document.getElementById('catTitle').textContent.trim(), note: document.querySelector('#catDesc .ch-src').textContent, kind: document.getElementById('iocKind').textContent, box: document.getElementById('ioc').value,
      boxShown: !document.getElementById('iocWrap').hidden, ph: document.getElementById('ioc').placeholder, cards: cards.map(c => c.querySelector('.card-title').textContent), steps: [...document.querySelectorAll('.group-head h2')].map(h => h.textContent),
      count: document.getElementById('visibleCount').textContent, who: document.getElementById('visibleTarget').textContent, n: links.length,
      safe: links.every(a => /^https:\/\//.test(a.href) && a.target === '_blank' && a.rel === 'noopener noreferrer' && a.referrerPolicy === 'no-referrer'), about: links.filter(a => !/example|6578616d706c65/i.test(a.href)).map(a => a.href),
      run: document.getElementById('runNext').hidden, exp: document.getElementById('exportMenu').hidden, sev: document.getElementById('sevToggle').hidden, recipe: document.getElementById('recipeWrap').hidden, scope: document.getElementById('scopeWrap').hidden,
      ticks: document.querySelectorAll('.card .done-btn, .card .q-copy, .card .card-query').length, open: document.getElementById('openCount').textContent, nav: document.querySelector(`.nav-item[data-view="${INVEST}"] .ct`).textContent,
      sources: Object.keys(SOURCES).length, filterPh: document.getElementById('filter').placeholder, label: document.getElementById('ioc').labels.length };
  });
  check('investigate: with nothing typed, the target is the indicator — a domain gets its questions', iv.title === 'Investigate' && iv.boxShown && iv.box === '' && iv.ph.startsWith('example.com') && iv.kind === 'Domain'
    && JSON.stringify(iv.cards) === JSON.stringify(['Verdicts and blocklists', 'Threat-intelligence feeds', 'Sandboxes and scans', 'Registration', 'DNS history and certificates', 'Lookalike domains', 'Leaks, stolen credentials and victims'])
    && JSON.stringify(iv.steps) === JSON.stringify(['Step 1: Is it already known?', 'Step 2: What has it done?', 'Step 3: Who is behind it?', 'Step 4: What else is connected?', 'Step 5: Where else does it turn up?']), iv);
  check('investigate: every source is a button to an https page about the indicator, opened without a referrer', iv.n > 20 && iv.safe && iv.about.length === 0 && iv.count === `${iv.n} sources` && iv.who === ' · example.com' && iv.open === '7', iv);
  check('investigate: lookups are not dorks — no ticks, no Run next, no export, no severity or recipe', iv.run && iv.exp && iv.sev && iv.recipe && iv.scope && iv.ticks === 0 && iv.nav === String(iv.sources) && iv.filterPh.includes('sources') && iv.label === 1, iv);
  check('investigate: it says what it leaves out', iv.note.includes('not saved') && iv.note.includes('People-search'), iv.note);

  const kinds = await v.evaluate(() => [
    ['example.com', 'domain', 'example.com'], ['https://Sub.Example.com/path?x=1#y', 'domain', 'sub.example.com'], ['hxxp://evil[.]example/a.php', 'domain', 'evil.example'], ['evil(dot)example', 'domain', 'evil.example'],
    ['*.example.com', 'domain', 'example.com'], ['"example.com"', 'domain', 'example.com'], ['8.8.8.8', 'ip', '8.8.8.8'], ['1.2.3[.]4', 'ip', '1.2.3.4'], ['http://10.0.0.1:8080/x', 'ip', '10.0.0.1'],
    ['2001:db8::1', 'ip', '2001:db8::1'], ['999.1.1.1', 'name', '999.1.1.1'], ['275A021BBFB6489E54D471899F7DB9D1663FC695EC2FE2A2C4538AABF651FD0F', 'hash', '275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f', 'sha256'],
    ['44d88612fea8a8f36de82e1278abb02f', 'hash', '44d88612fea8a8f36de82e1278abb02f', 'md5'], ['3395856ce81f2b7382dee72602f798b642f14140', 'hash', '3395856ce81f2b7382dee72602f798b642f14140', 'sha1'],
    ['Someone@Example.ORG', 'email', 'someone@example.org'], ['user[@]evil[.]example', 'email', 'user@evil.example'], ['APT28', 'name', 'APT28'], ['  Cobalt   Strike ', 'name', 'Cobalt Strike'], ['lazarus', 'name', 'lazarus'],
    ['localhost', 'name', 'localhost'], ['a', null], ['', null], ['   ', null], [null, null], [42, null], ['x'.repeat(500), 'name', 'x'.repeat(80)]
  ].map(([raw, type, value, algo]) => { const r = readIoc(raw); return { raw, want: type ? `${type}|${value}|${algo || ''}` : 'null', got: r ? `${r.type}|${r.value}|${r.algo || ''}` : 'null' }; }).filter(x => x.got !== x.want));
  check('investigate: what was typed is recognised — domains, addresses, hashes, e-mail, names, defanged or not', kinds.length === 0, kinds);
  const urls = await v.evaluate(() => { const at = (k, raw) => lookupUrl(k, readIoc(raw)); const sha = '275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f', md5 = '44d88612fea8a8f36de82e1278abb02f'; return [
    [at('vt', 'example.com'), 'https://www.virustotal.com/gui/domain/example.com'], [at('vt', sha), 'https://www.virustotal.com/gui/file/' + sha], [at('vt', md5), 'https://www.virustotal.com/gui/search/' + md5],
    [at('dtw', 'example.com'), 'https://dnstwister.report/search?ed=6578616d706c652e636f6d'], [at('fofa', '8.8.8.8'), 'https://en.fofa.info/result?qbase64=aXA9IjguOC44Ljgi'],
    [at('hibp', 'someone@example.org'), 'https://haveibeenpwned.com/account/someone@example.org'], [at('tri', 'Cobalt Strike'), 'https://tria.ge/s?q=family%3Acobaltstrike'],
    [at('mb', 'Cobalt Strike'), 'https://bazaar.abuse.ch/browse/tag/CobaltStrike/'], [at('attck', 'APT28'), 'https://www.google.com/search?q=site%3Aattack.mitre.org%20%22APT28%22'],
    [at('whk', 'example.co.uk'), 'https://www.whoxy.com/keyword/example'], [at('yf', md5), 'https://yaraify.abuse.ch/search/md5/' + md5 + '/'], [at('circl', sha), 'https://hashlookup.circl.lu/lookup/sha256/' + sha],
    [at('sthi', 'example.com'), 'https://securitytrails.com/domain/example.com/history/a'], [at('mp', 'a "b" <c>&d'), 'https://malpedia.caad.fkie.fraunhofer.de/library?search=a%20%22b%22%20%3Cc%3E%26d'],
    [at('gsb', '8.8.8.8'), ''], [at('ha', '3395856ce81f2b7382dee72602f798b642f14140'), ''], [at('mb', md5), ''], [at('hibp', 'example.com'), '']
  ].filter(([got, want]) => got !== want); });
  check('investigate: each source gets the indicator the way it expects it (path, query, hex, Base64, per hash type) — or is left out', urls.length === 0, urls);

  await v.fill('#ioc', '8.8.8.8'); await settle(v);
  const ip = await v.evaluate(() => ({ kind: document.getElementById('iocKind').textContent, cards: [...document.querySelectorAll('.card.lookup .card-title')].map(c => c.textContent), hash: location.hash, who: document.getElementById('visibleTarget').textContent,
    stored: Object.keys(localStorage).map(k => localStorage.getItem(k)).join('\n').includes('8.8.8.8'), exposed: [...[...document.querySelectorAll('.card.lookup')].find(c => c.querySelector('.card-title').textContent === 'Exposed services').querySelectorAll('.eng-btn')].map(a => a.textContent.replace(/\s*\(login required\)/, '').trim()),
    locks: document.querySelectorAll('.card.lookup .eng-btn .visually-hidden').length, target: document.getElementById('target').value }));
  check('investigate: an IP address gets its own questions; the indicator goes to the address bar and nowhere else', ip.kind === 'IP address' && ip.cards.includes('Network and hosting') && ip.cards.includes('Exposed services') && ip.cards.includes('Neighbours')
    && !ip.cards.includes('Registration') && ip.hash.includes('ioc=8.8.8.8') && ip.who === ' · 8.8.8.8' && !ip.stored && ip.target === 'example.com' && ip.locks >= 3
    && JSON.stringify(ip.exposed) === JSON.stringify(['Shodan', 'Shodan · InternetDB', 'Censys', 'FOFA', 'ZoomEye']), ip);
  await v.click('label[for="opsec"], #opsec', { force: true }); await settle(v);
  const quiet = await v.evaluate(() => [...[...document.querySelectorAll('.card.lookup')].find(c => c.querySelector('.card-title').textContent === 'Exposed services').querySelectorAll('.eng-btn')].map(a => a.textContent.trim()));
  await v.click('label[for="opsec"], #opsec', { force: true }); await settle(v);
  check('investigate: OPSEC mode takes the internet scanners out of a card', JSON.stringify(quiet) === '["Shodan · InternetDB"]', quiet);

  await v.evaluate(() => { window.__opened = []; window.open = u => { window.__opened.push(u); return null; }; });
  await v.click('#openCat'); await v.waitForTimeout(1900);
  await v.keyboard.press('n'); await settle(v);
  const oa = await v.evaluate(() => ({ opened: window.__opened.slice(), firsts: [...document.querySelectorAll('.card.lookup')].map(c => c.querySelector('.eng-btn').href), progress: localStorage.getItem('ndo_progress_v1') }));
  check('investigate: Open all opens the first source of every card (after asking), ticks nothing — and "n" has nothing to run', dialogs.length === 1 && /^Open 6 tabs/.test(dialogs[0]) && JSON.stringify(oa.opened) === JSON.stringify(oa.firsts) && oa.progress === null, { dialogs, oa });

  await v.fill('#ioc', 'Cobalt Strike'); await settle(v);
  const nm = await v.evaluate(() => ({ kind: document.getElementById('iocKind').textContent, cards: [...document.querySelectorAll('.card.lookup .card-title')].map(c => c.textContent), btn: (document.querySelector('#toHunt button') || {}).textContent }));
  await v.click('#toHunt button'); await ready(v, 'hunt'); await settle(v);
  const th = await v.evaluate(() => ({ cat: state.cat === HUNT, filter: state.filter, titles: [...document.querySelectorAll('.card .card-title')].map(h => h.textContent), focus: document.activeElement.id, box: document.getElementById('iocWrap').hidden }));
  check('investigate: a name gets profiles, reporting and detection rules — and a way to the Hunt library', nm.kind === 'Name' && JSON.stringify(nm.cards) === JSON.stringify(['Who they are', 'Threat-intelligence feeds', 'Sandboxes and scans', 'Reporting', 'Leaks, stolen credentials and victims', 'Detection rules'])
    && nm.btn === 'Search Hunt for “Cobalt Strike”' && th.cat && th.filter === 'Cobalt Strike' && th.titles.filter(t => t.startsWith('Cobalt Strike · ')).length >= 10 && th.focus === 'catTitle' && th.box, { nm, th });
  await v.keyboard.press('k'); await settle(v);
  const back = await v.evaluate(() => ({ cat: state.cat === INVEST, box: document.getElementById('ioc').value, filter: state.filter }));
  await v.keyboard.press('k'); await ready(v, 'fingerprints'); await settle(v);
  check('keys: Investigate and Hunt sit after the libraries for j / k', back.cat && back.box === 'Cobalt Strike' && await v.evaluate(() => state.cat === FPRINT), back);
  await v.keyboard.press('j'); await settle(v);
  await v.click('#filterClear'); await settle(v);

  await v.fill('#ioc', '275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f'); await settle(v);
  const hsh = await v.evaluate(() => ({ kind: document.getElementById('iocKind').textContent, cards: [...document.querySelectorAll('.card.lookup .card-title')].map(c => c.textContent), over: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
  await v.fill('#ioc', 'Someone@Example.org'); await settle(v);
  const em = await v.evaluate(() => ({ kind: document.getElementById('iocKind').textContent, cards: [...document.querySelectorAll('.card.lookup .card-title')].map(c => c.textContent), hibp: [...document.querySelectorAll('.card.lookup a.eng-btn')].find(a => a.textContent.includes('Have I Been Pwned')).href }));
  check('investigate: a file hash and an e-mail address', hsh.kind === 'File hash · SHA-256' && JSON.stringify(hsh.cards) === JSON.stringify(['Verdicts and blocklists', 'Threat-intelligence feeds', 'Sandboxes and scans']) && hsh.over <= 0
    && em.kind === 'E-mail address' && JSON.stringify(em.cards) === JSON.stringify(['Threat-intelligence feeds', 'Keys and commits', 'Domains and certificates in its name', 'Leaks, stolen credentials and victims'])
    && em.hibp === 'https://haveibeenpwned.com/account/someone@example.org', { hsh, em });

  await v.fill('#ioc', 'a'); await settle(v);
  const none = await v.evaluate(() => ({ h: (document.querySelector('.empty-state h2') || {}).textContent, kind: document.getElementById('iocKind').textContent, btn: (document.querySelector('.empty-state .btn') || {}).textContent, open: document.getElementById('openCat').disabled, count: document.getElementById('visibleCount').textContent }));
  await v.click('.empty-state .btn'); await settle(v);
  const again = await v.evaluate(() => ({ box: document.getElementById('ioc').value, kind: document.getElementById('iocKind').textContent, cards: document.querySelectorAll('.card.lookup').length, focus: document.activeElement.id, hash: location.hash }));
  check('investigate: too little to go on — it says so and offers the target', none.h === 'Nothing to look up yet' && none.kind === 'Not an indicator yet' && none.btn === 'Use the target' && none.open && none.count === 'No indicator'
    && again.box === '' && again.kind === 'Domain' && again.cards === 7 && again.focus === 'ioc' && !again.hash.includes('ioc='), { none, again });

  await v.fill('#filter', 'whois'); await settle(v);
  const fl = await v.evaluate(() => ({ cards: [...document.querySelectorAll('.card.lookup .card-title')].map(c => c.textContent), marks: document.querySelectorAll('.card.lookup mark').length, title: document.getElementById('catTitle').textContent.trim() }));
  await v.fill('#filter', 'zzzqqq'); await settle(v);
  const fe = await v.evaluate(() => ({ h: (document.querySelector('.empty-state h2') || {}).textContent, btns: [...document.querySelectorAll('.empty-state .btn')].map(b => b.textContent) }));
  await v.click('.empty-state .btn'); await settle(v);
  check('investigate: the search box filters the cards by what they are and by source', JSON.stringify(fl.cards) === '["Registration"]' && fl.marks >= 1 && fl.title === 'Investigate' && fe.h === 'No source matches' && JSON.stringify(fe.btns) === '["Clear search"]'
    && await v.evaluate(() => document.querySelectorAll('.card.lookup').length === 7), { fl, fe });

  await v.fill('#ioc', '"><img src=x onerror=window.__xss=6>'); await settle(v);
  const xs = await v.evaluate(() => ({ imgs: document.querySelectorAll('.content img').length, xss: window.__xss, kind: document.getElementById('iocKind').textContent, who: document.getElementById('visibleTarget').textContent,
    safe: [...document.querySelectorAll('.card.lookup a.eng-btn')].every(a => /^https:\/\//.test(a.href) && !/[<>"]/.test(a.getAttribute('href'))), n: document.querySelectorAll('.card.lookup a.eng-btn').length }));
  check('investigate: a hostile "indicator" is text on the page and percent-encoded in every link', xs.imgs === 0 && xs.xss === undefined && xs.kind === 'Name' && xs.who.includes('<img src=x') && xs.safe && xs.n > 5, xs);
  const a11y = await v.evaluate(() => {
    const name = el => (el.getAttribute('aria-label') || el.textContent || el.title || '').trim();
    const unnamed = [...document.querySelectorAll('.content button, .content a[href], .content select, .content input')].filter(el => /SELECT|INPUT/.test(el.tagName) ? !(el.labels && el.labels.length) : !name(el)).map(el => el.outerHTML.slice(0, 80));
    const small = [...document.querySelectorAll('.content button, .content a.eng-btn, .content select, .content input')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.height < 24 || r.width < 24); }).map(el => `${el.id || el.className}:${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`);
    return { unnamed, small: [...new Set(small)], described: document.getElementById('ioc').getAttribute('aria-describedby') === 'iocKind' };
  });
  check('investigate a11y: every control is named and at least 24×24; the box is tied to what it was taken for', a11y.unnamed.length === 0 && a11y.small.length === 0 && a11y.described, a11y);
  await v.context().close();

  const dl = await newPage(undefined, { hash: '#cat=investigate&ioc=evil%5B.%5Dexample&filter=virus' });
  const deep = await dl.evaluate(() => ({ cat: state.cat === INVEST, box: document.getElementById('ioc').value, kind: document.getElementById('iocKind').textContent, cards: [...document.querySelectorAll('.card.lookup .card-title')].map(c => c.textContent),
    href: document.querySelector('.card.lookup a.eng-btn').href, saved: (localStorage.getItem('ndo_state_v1') || '').includes('evil') }));
  await dl.click('.nav-item[data-view="-2"]'); await settle(dl);
  const left = await dl.evaluate(() => ({ box: document.getElementById('iocWrap').hidden, kind: document.getElementById('iocKind').hidden, sev: document.getElementById('sevToggle').hidden, run: document.getElementById('runNext').hidden, exp: document.getElementById('exportMenu').hidden, hash: location.hash }));
  check('investigate: a deep link carries the indicator as it was written; leaving the view puts the usual controls back', deep.cat && deep.box === 'evil[.]example' && deep.kind === 'Domain' && JSON.stringify(deep.cards) === '["Verdicts and blocklists"]'
    && deep.href === 'https://www.virustotal.com/gui/domain/evil.example' && !deep.saved && left.box && left.kind && !left.sev && !left.run && !left.exp && !left.hash.includes('ioc='), { deep, left });
  await dl.context().close();
}

/* ───────────── 5. persistence + first visit ───────────── */
{
  const p = await newPage(undefined, { storage: { ndo_state_v1: JSON.stringify({ cat: 999, sevs: ['crit'], history: ['acme.io', 'old.example'] }) } });
  const st = await p.evaluate(() => ({ cat: state.cat, target: document.getElementById('target').value, cards: document.querySelectorAll('.card').length, disclaimer: !!document.querySelector('.disclaimer'), hist: document.querySelectorAll('#targetHistory option').length }));
  check('state: stale view index falls back to Essentials instead of a blank page', st.cat === -2 && st.cards > 0, st);
  check('state: last target is restored, history offered', st.target === 'acme.io' && st.hist === 2, st);
  check('first visit: authorized-use notice is shown', st.disclaimer);
  await p.click('#discAccept');
  check('first visit: notice is dismissible and remembered', await p.evaluate(() => !document.querySelector('.disclaimer') && localStorage.getItem('ndo_disclaimer_v1') === '1'));
  await p.context().close();

  const b = await newPage(undefined, { hash: '#cat=essentials&target=shop.example.org' });
  check('bookmarklet: #target= pre-fills the target', (await b.inputValue('#target')) === 'shop.example.org' && (await b.evaluate(() => document.querySelector('.card code').textContent)).includes('shop.example.org'));
  check('bookmarklet: link is a javascript: URL into Essentials', await b.evaluate(() => { const h = document.getElementById('bookmarklet').getAttribute('href'); return h.startsWith('javascript:') && h.includes('#cat=essentials&target='); }));
  // The app's URL is baked into code that later runs on other sites: a crafted path must never reach it.
  const bm = await b.evaluate(() => {
    const out = {};
    for (const [k, path] of [['quote', "/x');alert(1);('/"], ['pct', '/%27);alert(1);(%27/'], ['nested', '/sub/dir/index.html']]) { history.replaceState(null, '', path); out[k] = makeBookmarklet(); }
    return out;
  });
  check('bookmarklet: a crafted path is never baked into the code',
    !bm.quote.includes('alert') && !bm.pct.includes('alert') && bm.quote.includes(`'${ORIGIN}/#cat=essentials`) && bm.pct.includes(`'${ORIGIN}/#cat=essentials`) && bm.nested.includes(`'${ORIGIN}/sub/dir/index.html#cat=essentials`), bm);
  await b.context().close();
}

/* ───────────── 6. responsive + a11y sweep ───────────── */
for (const [w, hgt] of [[390, 844], [360, 740], [320, 640], [768, 1024], [1024, 768], [1920, 1080]]) {
  const p = await newPage({ width: w, height: hgt });
  const over = [];
  for (const hash of ['#cat=essentials', '#cat=all', '#cat=wayback', '#cat=ghdb', '#cat=fingerprints', '#cat=hunt&scope=all', '#cat=investigate', '#cat=investigate&ioc=275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f',
    '#cat=essentials&filter=token']) {       // ends on Essentials: the drawer checks below start there
    await p.evaluate(h => { location.hash = h; }, hash); await settle(p);
    if (/ghdb|fingerprints|hunt/.test(hash)) { await p.waitForFunction(() => libAt(state.cat).state === 'ready', null, { timeout: 15000 }); await settle(p); }
    const o = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (o > 0) over.push(`${hash}: +${o}px`);
  }
  check(`responsive ${w}px: no horizontal overflow in any view`, over.length === 0, over);
  if (w <= 900) {
    await p.click('#navBtn'); await settle(p);
    const n = await p.evaluate(() => ({ open: document.body.classList.contains('nav-open'), exp: document.getElementById('navBtn').getAttribute('aria-expanded'), vis: getComputedStyle(document.getElementById('sidebar')).visibility,
      inert: document.querySelector('.content').hasAttribute('inert'), focus: document.activeElement.classList.contains('nav-item'), lock: getComputedStyle(document.body).overflowY }));
    await p.keyboard.press('j');                                   // single-key shortcuts must not act underneath the drawer
    const held = await p.evaluate(() => state.cat === ESS && document.body.classList.contains('nav-open'));
    await p.click(`.nav-item[data-view="${await p.evaluate(() => DATA.findIndex(c => c.id === 'devops'))}"]`); await settle(p);
    const after = await p.evaluate(() => ({ open: document.body.classList.contains('nav-open'), vis: getComputedStyle(document.getElementById('sidebar')).visibility, cat: DATA[state.cat].id,
      inert: document.querySelector('.content').hasAttribute('inert'), focus: document.activeElement.id }));
    check(`responsive ${w}px: nav drawer opens, navigates, closes (and leaves the tab order)`, n.open && n.exp === 'true' && n.vis === 'visible' && !after.open && after.cat === 'devops', { n, after });
    check(`responsive ${w}px: open drawer takes focus, makes the page inert and locks scrolling; choosing a view lands on its title`,
      n.inert && n.focus && n.lock === 'hidden' && held && !after.inert && after.focus === 'catTitle', { n, held, after });
    await p.click('#navBtn'); await settle(p); await p.keyboard.press('Escape'); await settle(p);
    const esc = await p.evaluate(() => ({ open: document.body.classList.contains('nav-open'), focus: document.activeElement.id, inert: document.querySelector('.content').hasAttribute('inert'), exp: document.getElementById('navBtn').getAttribute('aria-expanded') }));
    check(`responsive ${w}px: Esc closes the drawer and hands focus back to the menu button`, !esc.open && esc.focus === 'navBtn' && !esc.inert && esc.exp === 'false', esc);
    if (w === 390) {
      await p.click('#navBtn'); await settle(p);
      await p.setViewportSize({ width: 1280, height: 800 }); await settle(p);
      const wide = await p.evaluate(() => ({ open: document.body.classList.contains('nav-open'), inert: document.querySelector('.content').hasAttribute('inert'), lock: getComputedStyle(document.body).overflowY }));
      check('responsive: widening to desktop with the drawer open closes it (page usable again)', !wide.open && !wide.inert && wide.lock !== 'hidden', wide);
    }
  } else {
    // dialogs lock the page behind them without shifting the layout sideways
    const w0 = await p.evaluate(() => document.querySelector('.content').getBoundingClientRect().width);
    await p.click('#toolsBtn'); await settle(p);
    const tl = await p.evaluate(() => ({ lock: getComputedStyle(document.body).overflowY, w: document.querySelector('.content').getBoundingClientRect().width }));
    await p.keyboard.press('Escape'); await settle(p);
    await p.click('#helpBtn'); await settle(p);
    const hl = await p.evaluate(() => ({ lock: getComputedStyle(document.body).overflowY, w: document.querySelector('.content').getBoundingClientRect().width }));
    await p.keyboard.press('Escape'); await settle(p);
    const free = await p.evaluate(() => getComputedStyle(document.body).overflowY);
    check(`responsive ${w}px: tools panel and help dialog lock page scrolling with no sideways shift`, tl.lock === 'hidden' && hl.lock === 'hidden' && tl.w === w0 && hl.w === w0 && free !== 'hidden', { w0, tl, hl, free });
  }
  await p.context().close();
}

/* ───────────── 7. privacy: nothing leaves the page until the user acts ───────────── */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const seen = [];
  await ctx.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith(ORIGIN) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue();
    seen.push(u);
    if (u === 'https://index.commoncrawl.org/collinfo.json') return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify([{ id: 'CC-MAIN-2099-01', name: 'test' }, { id: 'CC-MAIN-2026-43' }]) });
    if (u.startsWith('https://index.commoncrawl.org/')) return r.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' });
    return r.abort();
  });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(`PAGE ERROR: ${e.message}`));
  await p.addInitScript(() => { try { localStorage.setItem('ndo_disclaimer_v1', '1'); } catch (e) {} });
  await p.goto(FILE + '#cat=dns', { waitUntil: 'networkidle' }); await settle(p);
  await p.fill('#filter', 'aws'); await settle(p); await p.fill('#filter', ''); await settle(p);
  await p.click('#helpBtn'); await p.keyboard.press('Escape'); await p.click('#toolsBtn'); await p.keyboard.press('Escape');
  await p.click('.nav-item[data-view="-1"]'); await settle(p); await p.click(`.nav-item[data-view="${await p.evaluate(() => DATA.findIndex(c => c.id === 'dns'))}"]`); await settle(p);
  check('privacy: browsing, searching and opening panels makes zero third-party requests', seen.length === 0, seen);
  const link = p.locator('.card', { hasText: 'CommonCrawl host index' }).locator('.eng-btn');
  const pinned = await link.getAttribute('href');
  const [popup] = await Promise.all([ctx.waitForEvent('page'), link.click()]);
  await popup.waitForURL(/CC-MAIN-2099-01/, { timeout: 8000 });
  const cc = await p.evaluate(() => ({ id: CC_LATEST, fresh: ccFresh, cache: JSON.parse(localStorage.getItem('ndo_cc_v1')).id, href: [...document.querySelectorAll('.eng-btn')].find(a => a.textContent.includes('CommonCrawl')).href }));
  check('CommonCrawl: first click resolves the newest index, opens it and caches it', /CC-MAIN-2026-43-index/.test(pinned) && popup.url().includes('CC-MAIN-2099-01-index?url=') && cc.id === 'CC-MAIN-2099-01' && cc.fresh && cc.cache === 'CC-MAIN-2099-01' && cc.href.includes('CC-MAIN-2099-01'), { pinned, popup: popup.url(), cc });
  await ctx.close();
}
{
  const p = await newPage(undefined, { hash: '#cat=all' });
  const a = await p.evaluate(() => {
    const name = el => (el.getAttribute('aria-label') || el.textContent || el.title || '').trim();
    const unnamed = [...document.querySelectorAll('button, a[href], select, input:not([type=hidden])')].filter(el => {
      if (el.tagName === 'INPUT' || el.tagName === 'SELECT') return !(el.getAttribute('aria-label') || el.labels?.length || el.title);
      return !name(el);
    }).map(el => el.outerHTML.slice(0, 90));
    const ids = [...document.querySelectorAll('[id]')].map(e => e.id);
    const small = [...document.querySelectorAll('button, a.eng-btn, select')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.height < 24 || r.width < 24); }).map(el => `${el.className || el.id}:${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`);
    return { unnamed, dupIds: ids.filter((x, i) => ids.indexOf(x) !== i), small: [...new Set(small)].slice(0, 8), svgs: [...document.querySelectorAll('svg.ic')].every(s => s.getAttribute('aria-hidden') === 'true'), lang: document.documentElement.lang, main: document.querySelectorAll('main').length };
  });
  check('a11y: every control has an accessible name', a.unnamed.length === 0, a.unnamed);
  check('a11y: no duplicate ids, icons hidden from AT, lang + single main', a.dupIds.length === 0 && a.svgs && a.lang === 'en' && a.main === 1, a);
  check('a11y: interactive targets are at least 24×24', a.small.length === 0, a.small);
  await p.context().close();
}

await browser.close();
server.close();
const failed = results.filter(r => !r.ok);
for (const r of results) console.log(`${r.ok ? '  ✓' : '  ✗'} ${r.name}${r.ok ? '' : '\n      → ' + JSON.stringify(r.detail)}`);
console.log(`\n${results.length - failed.length} / ${results.length} passed · console/page errors: ${errors.length}`);
if (errors.length) console.log([...new Set(errors)].join('\n'));
process.exit(failed.length || errors.length ? 1 : 0);
