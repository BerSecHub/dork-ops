// DorkOps UI regression suite — drives the real page in headless Chromium.
//
//   npm i -D playwright && npx playwright install chromium     (once)
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
catch (e) { console.error('Playwright is not installed: run  npm i -D playwright && npx playwright install chromium'); process.exit(2); }

// Serve the repo over HTTP like production does (file:// localStorage is flaky across reloads in headless Chromium).
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.xml': 'application/xml', '.txt': 'text/plain' };
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
    const sevs = new Set(['crit', 'high', 'med', 'low', 'info']);
    const bad = [], dupNames = [];
    DATA.forEach(c => {
      const seen = new Set();
      c.items.forEach(it => {
        if (!it.name || !it.desc || !sevs.has(it.sev) || !Array.isArray(it.tags) || !it.tags.length || !ENGINES[it.engine] || !it.q) bad.push(`${c.id}/${it.name}`);
        if (seen.has(it.name)) dupNames.push(`${c.id}/${it.name}`); seen.add(it.name);
      });
    });
    const icons = DATA.map(c => c.icon);
    const refs = ESSENTIAL_STEPS.flatMap(s => s.refs);
    const usedEngines = new Set(DATA.flatMap(c => c.items.map(i => i.engine)));
    return {
      dorks: DATA.reduce((n, c) => n + c.items.length, 0), cats: DATA.length, engines: Object.keys(ENGINES).length,
      bad, dupNames, dupIcons: icons.filter((x, i) => icons.indexOf(x) !== i),
      essRefs: refs.length, essResolved: ESSENTIALS.items.length, essUnique: new Set(ESSENTIALS.items).size,
      recipesEmpty: Object.keys(RECIPES).filter(k => { state.recipe = k; const n = DATA.reduce((a, c) => a + c.items.filter(i => itemMatchesRecipe(i, c.id)).length, 0); state.recipe = null; return n === 0; }),
      recipeNoMeta: Object.keys(RECIPES).filter(k => !RECIPES[k].label || !RECIPES[k].desc),
      crtUsed: usedEngines.has('crt'),
      urlsOk: DATA.every(c => c.items.every(i => /^https:\/\//.test(buildUrl(i.engine, i.q, 'example.com')))),
      unresolved: DATA.flatMap(c => c.items.filter(i => /\{(t|t_no_tld|date|org|target)\}/.test(applyTemplate(i.q, 'example.com') + applyTemplate(i.desc, 'example.com'))).map(i => i.name)),
    };
  });
  check('catalog: 232 dorks / 18 categories / 39 engines', d.dorks === 232 && d.cats === 18 && d.engines === 39, d);
  check('catalog: every item is well-formed', d.bad.length === 0, d.bad);
  check('catalog: dork names unique per category', d.dupNames.length === 0, d.dupNames);
  check('catalog: category icons are unique', d.dupIcons.length === 0, d.dupIcons);
  check('catalog: every dork builds an https URL', d.urlsOk);
  check('catalog: no unresolved {placeholders} in query or description', d.unresolved.length === 0, d.unresolved);
  check('essentials: all refs resolve, no duplicates', d.essRefs === 15 && d.essResolved === 15 && d.essUnique === 15, d);
  check('recipes: each has label + desc and matches something', d.recipeNoMeta.length === 0 && d.recipesEmpty.length === 0, d);
  check('engines: crt.sh dorks use the crt engine', d.crtUsed);

  const e = await p.evaluate(() => ({
    ze: ENGINES.ze.url('x'), ghdb: ENGINES.ghdb.url('zzz'), ghr: ENGINES.ghr.url('org:x'), cen: ENGINES.cen.name,
    auth: [ENGINES.gn.auth, ENGINES.vt.auth, ENGINES.lx.auth], opsec: [ENGINES.hh, ENGINES.nl, ENGINES.oy, ENGINES.be].map(x => x.opsec),
    cc: ENGINES.cc.url('x').includes(CC_LATEST + '-index'),
    crt: buildUrl('crt', DATA.find(c => c.id === 'dns').items[0].q, 'example.com'),
    s3: DATA.find(c => c.id === 'cloud').items.find(i => i.name === 'S3 by bucket name').q,
    yaml: DATA.find(c => c.id === 'raw-gh').items.some(i => i.q.includes('filetype:yaml OR filetype:yml')),
    shodan: DATA.find(c => c.id === 'net').items.find(i => i.name === 'Shodan org').q,
    saml: DATA.find(c => c.id === 'attack').items.find(i => i.name === 'SAML metadata exposed').q,
    sg: DATA.find(c => c.id === 'code').items.find(i => i.name === 'Sourcegraph multi-lang').q,
    orgEnum: DATA.find(c => c.id === 'code').items.find(i => i.name === 'GitHub org enum').engine,
  }));
  check('engines: ZoomEye on .ai', e.ze.includes('zoomeye.ai'), e.ze);
  check('engines: GHDB opens the searchable DB', e.ghdb === 'https://www.exploit-db.com/google-hacking-database', e.ghdb);
  check('engines: GitHub Repos engine', e.ghr.includes('type=repositories'), e.ghr);
  check('engines: Censys flagged legacy', /legacy/i.test(e.cen), e.cen);
  check('engines: auth flags on GreyNoise / VirusTotal / LeakIX', e.auth.every(x => x === true), e.auth);
  check('engines: OPSEC flags on Hunter.how / Netlas / Onyphe / BinaryEdge', e.opsec.every(x => x === false), e.opsec);
  check('engines: CommonCrawl uses the resolved crawl id', e.cc);
  check('engines: crt.sh URL', e.crt === 'https://crt.sh/?q=%25.example.com&output=json', e.crt);
  check('dorks: S3 matches bucket names (no negation)', e.s3.includes('"{t_no_tld}-backup"') && !e.s3.includes('-backup OR'), e.s3);
  check('dorks: YAML covers .yml', e.yaml);
  check('dorks: Shodan org uses the org label', e.shodan === 'org:"{t_no_tld}"', e.shodan);
  check('dorks: SAML is single-level', e.saml === 'site:{t} (inurl:"/saml/metadata" OR "EntityDescriptor")', e.saml);
  check('dorks: Sourcegraph parenthesised', e.sg.includes('(lang:yaml OR lang:dotenv)'), e.sg);
  check('dorks: org enum on GitHub Repos', e.orgEnum === 'ghr', e.orgEnum);
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
  check('home: 15 cards in 4 numbered steps, each with its category', home.cards === 15 && home.groups === 4 && home.steps === 4 && home.pills === 15, home);
  check('home: counter + Open-all agree', home.count.startsWith('15 dorks') && home.open === '15', home);
  check('home: nav has Essentials + My dorks + All + every category', home.nav === 3 + (await p.evaluate(() => DATA.length)), home.nav);
  check('home: exactly one h1, live placeholder count', home.h1 === 1 && home.placeholder.includes('232'), home);

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
  const eg = await p.evaluate(() => [...new Set([...document.querySelectorAll('.card .eng-btn')].map(a => a.textContent.trim()))]);
  check('search: engine:g means Google only', eg.length === 1 && eg[0].startsWith('Google'), eg);

  await p.fill('#filter', 'zzzzqqq'); await settle(p);
  const empty = await p.evaluate(() => ({ t: document.querySelector('.empty-state h2')?.textContent, btns: [...document.querySelectorAll('.empty-state .btn')].map(b => b.textContent), open: document.getElementById('openCat').disabled }));
  check('search: empty state with a way out, Open-all disabled', empty.t === 'No dorks match' && empty.btns.includes('Clear search') && empty.open === true, empty);
  await p.click('.empty-state .btn'); await settle(p);
  check('search: Clear search restores the view', (await p.locator('.card').count()) === 15);

  // XSS probe through the search box and the hash
  await p.fill('#filter', '"<img src=x onerror=window.__xss=1>" <svg/onload=window.__xss=1>'); await settle(p);
  check('security: search input is rendered inert', await p.evaluate(() => !window.__xss && !document.querySelector('#grid img, #searchOps img, #grid svg[onload]')));
  await p.fill('#filter', ''); await settle(p);

  // all dorks
  await p.click('.nav-item[data-view="-1"]'); await settle(p);
  const all = await p.evaluate(() => ({ cards: document.querySelectorAll('.card').length, heads: document.querySelectorAll('.group-head').length, count: document.getElementById('visibleCount').textContent, y: window.scrollY, hash: location.hash }));
  check('all: 232 cards under 18 category headings', all.cards === 232 && all.heads === 18 && all.count.startsWith('232 dorks') && all.hash.includes('cat=all'), all);
  await p.click('.group-head h2 button'); await settle(p);
  check('all: a heading opens its category', (await p.evaluate(() => location.hash)).includes('cat=raw-gh') && (await p.locator('.card').count()) === 16);

  // severity
  await p.click('.sev-pill[data-sev="crit"]'); await settle(p);
  const sev = await p.evaluate(() => ({ pressed: document.querySelector('.sev-pill[data-sev="crit"]').getAttribute('aria-pressed'), crit: document.querySelectorAll('.card[data-sev="crit"]').length, count: document.getElementById('visibleCount').textContent, hash: location.hash }));
  check('filters: severity toggle (aria-pressed, counter "x of y", hash)', sev.pressed === 'false' && sev.crit === 0 && / of 16 dorks/.test(sev.count) && !/sev=[^&]*crit/.test(sev.hash), sev);
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
  check('recipes: select lists all 5 (+ none)', rec.options === 6, rec.options);
  check('recipes: becomes a named view over All dorks, capped per category', rec.title.endsWith('Bug Bounty Triage') && rec.active && rec.nav === 'All dorks' && rec.maxPerCat <= 4 && rec.cards > 0 && rec.hash.includes('recipe=bbTriage'), rec);
  check('export: exactly the visible dorks (recipe + cap respected)', rec.exported === rec.cards, rec);
  await p.click('.nav-item[data-view="-2"]'); await settle(p);
  check('recipes: going to Essentials clears the recipe', await p.evaluate(() => state.recipe === null && document.getElementById('recipe').value === '' && document.querySelectorAll('.card').length === 15));

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
    const re = find('secrets', 'AWS Access Key ID (AKIA)'); const a = { re: !!re.querySelector('.tk-re'), brk: re.querySelector('code').classList.contains('brk') };
    const url = find('wayback', 'All historical URLs'); const b = { brk: url.querySelector('code').classList.contains('brk'), t: url.querySelectorAll('.tk-t').length, o: url.querySelectorAll('.tk-o').length, btn: url.querySelector('.eng-btn').textContent.trim() };
    const fofa = find('cdn', 'FOFA body + not-cloudflare'); const c = { o: [...fofa.querySelectorAll('.tk-o')].map(x => x.textContent), k: [...fofa.querySelectorAll('.tk-k')].map(x => x.textContent), lock: !!fofa.querySelector('.eng-btn .visually-hidden') };
    const crt = find('dns', 'crt.sh wildcard JSON'); const d = { btn: crt.querySelector('.eng-btn').textContent.trim(), code: crt.querySelector('code').textContent, desc: crt.querySelector('.card-desc').textContent };
    return { a, b, c, d };
  });
  check('query: regex dorks get the regex style', tk.a.re && tk.a.brk, tk.a);
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
  check('help: opens at the top with focus on Close, lists 39 engines', h.open && h.top === 0 && h.focus === 'hmClose' && h.engines === 39 && h.inView, h);
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
  check('tools: modal panel with 8 tools, background inert, focus moved in', t.open && !t.inert && t.bg && t.focus === 'toolsClose' && t.tools === 8 && t.aria, t);
  await p.click('.dt[data-drawer="perm"]');
  await p.evaluate(() => { document.getElementById('target').value = 'app.example.co.uk'; });
  await p.click('#permGo'); await settle(p);
  const pm = await p.evaluate(() => ({ exp: document.querySelector('.dt[data-drawer="perm"]').getAttribute('aria-expanded'), chips: [...document.querySelectorAll('#permChips .chip')].map(c => c.tagName + ':' + c.textContent) }));
  check('tools: permutations handle subdomain + multi-level TLD targets', pm.exp === 'true' && pm.chips.length > 40 && pm.chips.every(c => c.startsWith('BUTTON')) && pm.chips.some(c => c.endsWith(':example-dev.co.uk')) && !pm.chips.some(c => /\.ple\.|\.\./.test(c)), pm.chips.slice(0, 6));
  await p.click('.dt[data-drawer="patterns"]');
  check('tools: secret patterns moved in (15 one-click hunts)', (await p.locator('#patterns .pat').count()) === 15);
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
  check('export: Essentials exports its 15 dorks under their real categories', ex.items === 15 && ex.cats >= 5 && ex.md && ex.desc, ex);

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
  check('brand: click returns to a clean Essentials', await p.evaluate(() => state.cat === ESS && state.filter === '' && state.recipe === null && document.getElementById('filter').value === '' && document.querySelectorAll('.card').length === 15));
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
for (const [w, hgt] of [[390, 844], [360, 740], [768, 1024], [1024, 768], [1920, 1080]]) {
  const p = await newPage({ width: w, height: hgt });
  const over = [];
  for (const hash of ['#cat=essentials', '#cat=all', '#cat=wayback', '#cat=essentials&filter=token']) {
    await p.evaluate(h => { location.hash = h; }, hash); await settle(p);
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
    await p.click('.nav-item[data-view="3"]'); await settle(p);
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
  await p.click('.nav-item[data-view="-1"]'); await settle(p); await p.click('.nav-item[data-view="6"]'); await settle(p);
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
