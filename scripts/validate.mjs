import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { apiFixture } from '../tests/api-fixture.mjs';

const require = createRequire(process.env.SQUEEK_DEPENDENCY_MANIFEST || new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const root = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const out = resolve('test/scratch/interaction');
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/preview\/?/, '');
  const file = resolve(root, path || 'index.html');
  if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
  try { const body = await readFile(file); res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}/preview/`;
const launch = { headless: true, ...(process.env.SQUEEK_CHROMIUM_PATH ? { executablePath: process.env.SQUEEK_CHROMIUM_PATH } : {}) };
const results = [];
let browser;
async function check(name, fn) {
  try { const detail = await fn(); results.push({ name, passed: true, detail: detail ?? '' }); console.log(`PASS ${name}${detail ? `: ${detail}` : ''}`); }
  catch (error) { results.push({ name, passed: false, detail: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}
const pause = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, timeout = 8000) {
  const start = Date.now();
  while (!await fn()) { if (Date.now() - start > timeout) throw new Error('Timed out waiting for expected state'); await pause(80); }
}
const save = page => page.evaluate(() => JSON.parse(localStorage.getItem('squeek-terminal.game.v1')));
const current = s => s.players.find(p => p.id === s.activePlayer);

try {
  browser = await chromium.launch(launch);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
  if (process.env.SQUEEK_API_BRIDGE === '1') {
    // Test-only transport bridge for renderers that cannot reach external hosts.
    // These are actual public API responses; production always fetches directly.
    const run = promisify(execFile);
    await context.route('https://api.squeekchain.com/v1/**', async route => {
      try {
        const { stdout } = await run('curl', ['--fail', '--silent', '--show-error', '--max-time', '20', route.request().url()], { maxBuffer: 4 * 1024 * 1024 });
        await route.fulfill({ status: 200, contentType: 'application/json', body: stdout });
      } catch { await route.abort('failed'); }
    });
    console.log('Transport: test-only curl bridge to real public API');
  }
  const page = await context.newPage();
  const errors = [], missing = [], consoleMessages = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) consoleMessages.push({ type: message.type(), text: message.text() }); });
  page.on('response', r => { if (r.url().startsWith(url) && r.status() >= 400) missing.push(`${r.status()} ${r.url()}`); });
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  await check('real API connection or explicit recoverable failure', async () => {
    await until(async () => !(await page.locator('.feed-status').innerText()).includes('Connecting'), 35000);
    const status = await page.locator('.feed-status').innerText();
    assert.match(status, /connected|unavailable|stale/);
    if (!status.includes('connected')) assert.ok(await page.locator('.notice').count());
    return `${status}; ${await page.locator('.feed-meta').innerText()}`;
  });
  await page.screenshot({ path: `${out}/desktop-live.png`, fullPage: true });
  await check('relative assets work under /preview/ and local fonts load', async () => {
    assert.deepEqual(missing, []); assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => document.fonts.check('14px Geist') && document.fonts.check('14px "Geist Mono"')), true);
    for (const asset of ['favicon.svg', 'social-card.png']) { const response = await context.request.get(url + asset); assert.equal(response.status(), 200, asset); }
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${out}/mobile-live.png`, fullPage: true });
  await check('product and primary action appear on first 390px screen', async () => {
    const h1 = await page.locator('h1').boundingBox(), cta = await page.locator('.lock-prediction').boundingBox();
    assert.ok(h1.y >= 0 && h1.y + h1.height <= 844);
    assert.ok(cta.y >= 0 && cta.y + cta.height <= 844, `Primary action ends at ${cta.y + cta.height}px`);
    return `Primary action ends at ${Math.round(cta.y + cta.height)}px`;
  });
  await page.getByRole('button', { name: 'Practice', exact: true }).click();
  await check('practice prediction, reservation, locking and settlement', async () => {
    await page.locator('label.direction-option.short').click();
    await page.getByLabel('Virtual stake', { exact: true }).fill('100');
    await page.getByRole('button', { name: 'Lock Short prediction', exact: true }).click();
    await until(async () => current(await save(page)).practice.positions.length === 1);
    let a = current(await save(page)).practice;
    assert.equal(a.balance, 900); assert.equal(a.positions[0].status, 'pending'); assert.equal(a.positions[0].direction, 'short');
    assert.ok(await page.locator('.lock-prediction').isDisabled());
    await page.screenshot({ path: `${out}/mobile-pending.png`, fullPage: true });
    await page.getByRole('button', { name: 'Fast-forward round' }).click();
    await until(async () => current(await save(page)).practice.positions[0].status !== 'pending');
    a = current(await save(page)).practice;
    assert.equal(a.balance, 1000 + a.positions[0].pnl);
    assert.ok(['won', 'lost'].includes(a.positions[0].status));
    assert.equal(a.positions[0].work >= a.positions[0].target, a.positions[0].status === 'lost');
    assert.match(await page.locator('.settlement-note').innerText(), /You (won|lost)/);
    return `${a.positions[0].status}, PnL ${a.positions[0].pnl} SQK`;
  });
  await check('stake validation prevents a bad entry and supports presets', async () => {
    await page.getByLabel('Virtual stake', { exact: true }).fill('9');
    await page.getByRole('button', { name: /Lock .* prediction/ }).click();
    assert.match(await page.locator('#stake-error').innerText(), /10 to 250/);
    assert.equal(await page.getByLabel('Virtual stake', { exact: true }).getAttribute('aria-invalid'), 'true');
    await page.getByRole('button', { name: '50', exact: true }).click();
    assert.equal(await page.getByLabel('Virtual stake', { exact: true }).inputValue(), '50');
  });
  await check('position receipts label simulated results and show locked values', async () => {
    await page.getByRole('button', { name: 'View result for round 50' }).click();
    assert.match(await page.getByRole('dialog').innerText(), /simulated wheel units/);
    assert.match(await page.getByRole('dialog').innerText(), /Fixed target/);
    assert.match(await page.getByRole('dialog').innerText(), /AI’s locked call/);
    await page.getByRole('button', { name: 'Close dialog' }).click();
  });
  await check('chart filters, style, keyboard inspection and data disclosure', async () => {
    await page.locator('#chart').getByRole('button', { name: '4h', exact: true }).click();
    const chart = page.locator('#chart .chart-canvas');
    const before = await chart.getAttribute('aria-label');
    await chart.focus(); await page.keyboard.press('Home');
    assert.notEqual(await chart.getAttribute('aria-label'), before);
    await page.locator('#chart').getByRole('button', { name: 'Show line chart' }).click();
    assert.equal(await page.locator('#chart .chart-line').count(), 1);
    await page.locator('#chart summary').click(); assert.ok(await page.locator('#chart table').isVisible());
    await page.locator('#chart summary').click();
    await page.locator('#chart').getByRole('button', { name: '24h', exact: true }).click();
    await page.locator('#chart').getByRole('button', { name: 'Show candlesticks' }).click();
  });
  await check('native dialog traps focus, closes with Escape and restores focus', async () => {
    const trigger = page.getByRole('button', { name: 'How to play', exact: true });
    await trigger.click(); assert.ok(await page.getByRole('dialog').isVisible());
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => !!document.activeElement.closest('dialog')), true, 'Focus stays inside the modal');
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 0); assert.equal(await trigger.evaluate(el => el === document.activeElement), true, 'Focus returns to the opener');
    await page.screenshot({ path: `${out}/focus-return.png` });
  });
  await check('expanded chart and round-history view work', async () => {
    await page.getByRole('button', { name: 'Expand chart' }).click();
    assert.ok(await page.getByRole('dialog').isVisible());
    await until(async () => (await page.locator('.expanded-chart .chart-canvas').boundingBox()).width > 200);
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await page.getByRole('button', { name: 'Round history', exact: true }).click();
    assert.ok(await page.locator('#activity').getByRole('table').isVisible());
    assert.equal(await page.locator('#activity tbody tr').count(), 10);
    await page.getByRole('button', { name: /My positions/ }).click();
  });
  await check('new local player starts separately and can switch back', async () => {
    await page.locator('.profile-button').click();
    await page.getByRole('button', { name: 'Create trader' }).click();
    assert.match(await page.locator('#name-error').innerText(), /1–24/);
    await page.getByLabel('New trader name').fill('Wheel watcher');
    await page.getByRole('button', { name: 'Create trader' }).click();
    assert.equal(current(await save(page)).name, 'Wheel watcher');
    assert.equal(current(await save(page)).practice.positions.length, 0);
    await page.locator('.profile-button').click();
    await page.locator('.player-list').getByRole('button', { name: 'You', exact: true }).click();
    assert.equal(current(await save(page)).practice.positions.length, 1);
  });
  await check('CSV export contains actual result and PnL', async () => {
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export positions as CSV' }).click();
    const download = await downloadPromise; assert.equal(download.suggestedFilename(), 'squeek-practice-positions.csv');
    await download.saveAs(`${out}/positions.csv`);
    const csv = await readFile(`${out}/positions.csv`, 'utf8'); assert.equal(csv.split('\n').length, 2); assert.match(csv, /50,short/);
  });
  await check('live and practice ledgers stay separate; records survive reload', async () => {
    await page.getByRole('button', { name: 'Live API', exact: true }).click();
    assert.equal(current(await save(page)).live.positions.length, 0); assert.equal(current(await save(page)).live.balance, 1000);
    await page.reload(); await page.getByRole('button', { name: 'Practice', exact: true }).click();
    assert.equal(current(await save(page)).practice.positions.length, 1);
    assert.equal((await save(page)).players.length, 2);
  });
  await check('responsive layouts at 320, 390, 768 and 1440px', async () => {
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const m = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
      assert.ok(m.scroll <= m.width + 1, `${width}px overflows to ${m.scroll}px`);
      const transform = await page.locator('#chart .chart-canvas>svg').evaluate(svg => ({ scale: svg.getScreenCTM().a, label: getComputedStyle(svg.querySelector('.chart-time')).fontSize }));
      assert.ok(Math.abs(transform.scale - 1) < 0.02, 'Chart text must not be scaled down');
      assert.equal(transform.label, '12px');
      await page.screenshot({ path: `${out}/practice-${width}.png`, fullPage: true });
    }
    const rendered = await page.evaluate(() => {
      const css = (selector, prop) => getComputedStyle(document.querySelector(selector)).getPropertyValue(prop);
      return {
        background: css('#chart', 'background-color'),
        primary: css('.panel-heading h2', 'color'),
        secondary: css('.ticket-round .muted', 'color'),
        muted: css('.chart-time', 'fill'),
        control: css('.stake-input', 'border-top-color'),
        positive: css('.candle-up rect:last-child', 'fill'),
        negative: css('.candle-down rect:last-child', 'fill'),
        volumeOpacity: Number(css('.candle-down rect:last-child', 'opacity')),
      };
    });
    const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
    const luminance = c => c.map(x => x / 255).map(x => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4).reduce((a, x, i) => a + x * [0.2126, 0.7152, 0.0722][i], 0);
    const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
    const bg = rgb(rendered.background);
    const ratios = Object.fromEntries(['primary', 'secondary', 'muted', 'control'].map(key => [key, contrast(rgb(rendered[key]), bg)]));
    for (const key of ['positive', 'negative']) ratios[`${key}Volume`] = contrast(rgb(rendered[key]).map((n, i) => n * rendered.volumeOpacity + bg[i] * (1 - rendered.volumeOpacity)), bg);
    for (const key of ['primary', 'secondary', 'muted']) assert.ok(ratios[key] >= 4.5, key);
    for (const key of ['control', 'positiveVolume', 'negativeVolume']) assert.ok(ratios[key] >= 3, key);
    await writeFile(`${out}/rendered-colors.json`, JSON.stringify({ rendered, ratios }, null, 2) + '\n');
  });
  await check('API failure is explicit and practice remains playable', async () => {
    const offline = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await offline.route('https://api.squeekchain.com/**', route => route.abort('failed'));
    const p = await offline.newPage(); await p.goto(url);
    await until(async () => (await p.locator('.feed-status').innerText()).includes('unavailable'));
    assert.ok(await p.locator('.notice').isVisible()); assert.ok(await p.locator('.lock-prediction').isDisabled());
    await p.getByRole('button', { name: 'Practice', exact: true }).click(); assert.ok(await p.locator('.lock-prediction').isEnabled());
    await p.screenshot({ path: `${out}/offline-practice.png`, fullPage: true }); await offline.close();
  });
  await check('live lifecycle: stale, retry, lock, frozen target, confirmed settlement', async () => {
    const fixtureContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const fixed = Math.floor(Date.now() / 1000) * 1000;
    const fixture = apiFixture(fixed);
    fixture.state.stale = true;
    await fixtureContext.route('https://api.squeekchain.com/v1/**', route => fixture.state.fail ? route.fulfill({ status: 503, body: '{}' }) : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture.respond(route.request().url())) }));
    const p = await fixtureContext.newPage();
    await p.clock.install({ time: new Date(fixed) });
    await p.clock.pauseAt(new Date(fixed));
    await p.goto(url);
    await until(async () => (await p.locator('.feed-status').innerText()).includes('stale'));
    assert.ok(await p.locator('.lock-prediction').isDisabled());
    fixture.state.stale = false;
    await p.getByRole('button', { name: 'Refresh live feed' }).click();
    await until(async () => (await p.locator('.feed-status').innerText()).includes('connected'));
    await p.getByRole('button', { name: 'Lock Long prediction', exact: true }).click();
    await until(async () => current(await save(p)).live.positions.length === 1);
    const locked = current(await save(p)).live.positions[0];
    assert.equal(locked.round, 12); assert.equal(locked.target, 120);
    fixture.state.fail = true;
    await p.getByRole('button', { name: 'Refresh live feed' }).click();
    await until(async () => await p.locator('.notice').count() > 0);
    assert.match(await p.locator('.notice').innerText(), /Last good values are retained/);
    assert.equal(current(await save(p)).live.positions[0].target, locked.target);
    fixture.state.fail = false; fixture.state.through = 12; fixture.state.now = fixed + 16 * 60_000;
    await p.clock.setSystemTime(new Date(fixture.state.now));
    await p.getByRole('button', { name: 'Refresh live feed' }).click();
    await p.clock.runFor(1100);
    await until(async () => current(await save(p)).live.positions[0].status === 'won');
    const account = current(await save(p)).live;
    assert.equal(account.balance, 1050); assert.equal(account.positions[0].work, 200); assert.equal(account.positions[0].target, 120);
    assert.equal(account.positions[0].aiDirection, locked.aiDirection);
    await fixtureContext.close();
    return 'Simulated API fixture; browser clock advanced, no real-time wait';
  });
  await check('practice settles automatically on its timer', async () => {
    const timerContext = await browser.newContext();
    await timerContext.route('https://api.squeekchain.com/**', r => r.abort('failed'));
    const p = await timerContext.newPage();
    await p.clock.install();
    await p.goto(url);
    await p.getByRole('button', { name: 'Practice', exact: true }).click();
    await p.getByRole('button', { name: 'Lock Long prediction', exact: true }).click();
    await until(async () => current(await save(p)).practice.positions.length === 1);
    await p.clock.fastForward(21_000);
    await until(async () => current(await save(p)).practice.positions[0].status !== 'pending');
    assert.ok(['won', 'lost'].includes(current(await save(p)).practice.positions[0].status));
    await timerContext.close();
    return '21s advanced by browser clock';
  });
  await check('corrupt and unavailable browser storage have clear recovery states', async () => {
    for (const blocked of [false, true]) {
      const c = await browser.newContext();
      await c.route('https://api.squeekchain.com/**', r => r.abort('failed'));
      await c.addInitScript(flag => {
        if (flag) Storage.prototype.setItem = () => { throw new Error('Storage disabled in validation'); };
        else localStorage.setItem('squeek-terminal.game.v1', '{broken');
      }, blocked);
      const p = await c.newPage(); await p.goto(url);
      await until(async () => await p.locator('.notice').filter({ hasText: blocked ? 'storage is unavailable' : 'saved game could not be read' }).count() > 0);
      await p.getByRole('button', { name: 'Practice', exact: true }).click(); assert.ok(await p.locator('.lock-prediction').isEnabled());
      await c.close();
    }
  });
  await check('no script/console errors or missing local resources during interactions', async () => {
    assert.deepEqual(errors, []); assert.deepEqual(missing, []);
    assert.deepEqual(consoleMessages.filter(m => m.type === 'error'), []);
    await writeFile(`${out}/console.json`, JSON.stringify(consoleMessages, null, 2) + '\n');
  });
  console.log(`Browser: ${browser.version()}`);
  await context.close();
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
  await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2) + '\n');
}
if (results.some(r => !r.passed)) process.exitCode = 1;
