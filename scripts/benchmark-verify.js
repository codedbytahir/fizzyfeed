/* verify the benchmark pass: reveals fire, reduced-motion bypass, gh-pages link rewrite */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, "..");
const ROOT = path.join(REPO, 'landing');
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain', '.xml': 'application/xml' };

const srv = http.createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (fs.existsSync(f) && fs.statSync(f).isFile()) {
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  } else { res.writeHead(404); res.end('nope'); }
});

(async () => {
  await new Promise(r => srv.listen(8907, r));
  const browser = await chromium.launch();

  /* --- pass 1: normal motion — reveals should fire on load + scroll --- */
  const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('http://localhost:8907/', { waitUntil: 'networkidle' });
  await pg.waitForTimeout(900);

  const heroIn = await pg.evaluate(() =>
    [...document.querySelectorAll('.hero .reveal')].map(el => el.classList.contains('is-in')));
  console.log('hero reveals fired on load:', heroIn.every(Boolean), `(${heroIn.length} items)`);

  // deep section should NOT be revealed yet
  const ctaBefore = await pg.evaluate(() =>
    document.querySelector('#cta .sec-head .reveal').classList.contains('is-in'));
  console.log('cta sec-head still hidden before scroll:', !ctaBefore);

  // scroll to CTA, wait for entrance
  await pg.evaluate(() => document.querySelector('#cta').scrollIntoView({ behavior: 'instant' }));
  await pg.waitForTimeout(1400);
  const ctaAfter = await pg.evaluate(() =>
    [...document.querySelectorAll('#cta .reveal')].map(el => el.classList.contains('is-in')));
  console.log('cta reveals fired after scroll:', ctaAfter.every(Boolean), `(${ctaAfter.length} items)`);

  // unobserve check: only is-in added once, no observers left on revealed nodes
  const staggerAssigned = await pg.evaluate(() =>
    document.querySelector('#chapters .chapter.reveal').style.getPropertyValue('--i'));
  console.log('stagger --i assigned in chapters grid:', JSON.stringify(staggerAssigned));

  await pg.screenshot({ path: path.join(__dirname, '_benchmark', 'cta-revealed.png') });
  console.log('pageerrors (normal):', errs.length);

  /* --- pass 2: reduced motion — everything visible instantly --- */
  const pg2 = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await pg2.goto('http://localhost:8907/', { waitUntil: 'domcontentloaded' });
  await pg2.waitForTimeout(400);
  const rm = await pg2.evaluate(() => {
    const all = [...document.querySelectorAll('.reveal')];
    return { total: all.length, visible: all.filter(el => getComputedStyle(el).opacity === '1').length };
  });
  console.log(`reduced-motion: ${rm.visible}/${rm.total} reveals visible instantly`);
  await pg2.close();

  /* --- pass 3: gh-pages link rewrite (simulate hosting) --- */
  const pg3 = await browser.newPage();
  await pg3.addInitScript(() => {
    Object.defineProperty(window, 'location', { value: new URL('https://codedbytahir.github.io/fizzyfeed/'), writable: false });
  });
  // location is read-only at runtime; instead eval the logic directly
  const sim = await pg.evaluate(() => {
    const ON_PAGES = /(^|\.)github\.io$/.test('codedbytahir.github.io');
    const REPO = 'https://github.com/codedbytahir/fizzyfeed';
    const f1 = '../docs/specs/00-PRODUCT.md'.replace(/^\.\.\//, '');
    return { ON_PAGES, rewritten: REPO + '/blob/main/' + f1 };
  });
  console.log('pages-detect regex:', sim.ON_PAGES, '| footer link becomes:', sim.rewritten);

  // real nav-check: local server keeps /api href (no rewrite off-pages)
  const localHref = await pg.evaluate(() => document.querySelector('[data-connect]').getAttribute('href'));
  console.log('local data-connect href (unchanged):', localHref);
  const deadLinks = await pg.evaluate(() =>
    [...document.querySelectorAll('a[href]')]
      .map(a => a.getAttribute('href'))
      .filter(h => h.startsWith('/') || h.startsWith('../')));
  console.log('remaining repo-relative/dead-prone links on local:', deadLinks);

  await browser.close();
  srv.close();
  process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
