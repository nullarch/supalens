/** Actual public chrome, landing evidence and docs copy states. All clipboard writes are local fakes. */
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect } from '@playwright/test';

const base = process.argv[2] || 'http://localhost:3107';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const output = await mkdtemp(join(tmpdir(), 'supalens-public-finishing-'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let renders = 0, interactions = 0;
const commands = ['https://mcp.supalens.ai/mcp', 'claude mcp add --transport http supalens https://mcp.supalens.ai/mcp',
  `curl https://mcp.supalens.ai/mcp \\\n  -H "Authorization: Bearer sl_..." \\\n  -H "Content-Type: application/json" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`];
try {
  for (const locale of ['en', 'ko', 'ja']) for (const theme of ['light', 'dark']) {
    const m = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: base }]);
    await context.addInitScript(theme => {
      localStorage.setItem('theme', theme);
      window.__copyMode = 'success'; window.__copyCalls = [];
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: text => {
        window.__copyCalls.push(text);
        if (window.__copyMode === 'failed') return Promise.reject(new Error('Local clipboard rejection'));
        if (window.__copyMode === 'pending') return new Promise(resolve => { window.__resolveCopy = resolve; });
        return Promise.resolve();
      } } });
    }, theme);
    const errors = [], unexpected = [];
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== new URL(base).origin && !/^(fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net)$/.test(url.hostname)) return route.abort();
      if (url.origin === new URL(base).origin && (url.pathname.startsWith('/api/') || !['GET', 'HEAD'].includes(request.method()))) {
        unexpected.push(`${request.method()} ${url.pathname}`); return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    page.on('pageerror', e => errors.push(e.message));
    const prefix = locale === 'en' ? '' : `/${locale}`;
    for (const path of ['', '/supabase', '/docs/mcp']) {
      assert.equal((await page.goto(base + (prefix + path || '/'))).status(), 200);
      await page.evaluate(() => document.fonts.ready);
      for (const width of [1440, 1080, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        if (path !== '/docs/mcp') {
          const menu = page.locator('button[aria-controls="cx-mobile-menu"]');
          if (await menu.isVisible()) {
            const box = await menu.boundingBox(); assert.ok(box.width >= 44 && box.height >= 44);
            await menu.click();
            await page.locator('#cx-mobile-menu a').first().focus();
            await page.keyboard.press('Escape');
            await expect(menu).toBeFocused(); await expect(menu).toHaveAttribute('aria-expanded', 'false'); interactions++;
          }
          assert.deepEqual(await page.locator('header a[href^="#"], footer a[href^="#"]').evaluateAll(links =>
            links.map(link => link.getAttribute('href')).filter(href => !document.getElementById(href.slice(1)))), [], 'No abandoned section anchors');
          if (width === 320) {
            await page.locator('footer a[href="#why-code"]').click();
            await expect.poll(() => page.evaluate(() => document.getElementById('why-code').getBoundingClientRect().top >= document.querySelector('header').getBoundingClientRect().bottom)).toBe(true);
            interactions++;
          }
          const footer = page.locator('footer');
          await expect(footer.getByRole('navigation')).toHaveCount(5);
          for (const route of ['/supabase', '/demo', '/docs/mcp', '/privacy', '/terms', '/refund']) await expect(footer.locator(`a[href="${prefix}${route}"]`)).toHaveCount(1);
          const ctas = page.locator('a[href="/login?next=%2Fapp%2Fsources%3Fconnect%3Dsupabase"]');
          for (const cta of await ctas.all()) if (await cta.isVisible()) {
            // Editorial pages (home, /supabase) use the reference's 10px button radius.
            assert.equal(await cta.evaluate(el => getComputedStyle(el).borderRadius), '10px');
          }
          {
            const hero = page.locator('section[aria-labelledby="hero-title"]');
            assert.ok(await hero.locator('h1').evaluate(el => parseFloat(getComputedStyle(el).fontSize)) >= 34);
            for (const label of await hero.locator('[class*="issue"], [class*="healthy"], dt').all()) assert.ok(await label.evaluate(el => parseFloat(getComputedStyle(el).fontSize)) >= 12);
          }
        } else {
          for (const pre of await page.locator('pre[role="region"]').all()) {
            await pre.focus(); await expect(pre).toBeFocused();
            assert.notEqual(await pre.evaluate(el => getComputedStyle(el).outlineStyle), 'none');
            if (await pre.evaluate(el => el.scrollWidth > el.clientWidth + 1)) {
              await pre.evaluate(el => { el.scrollLeft = 0; }); await pre.press('ArrowRight');
              await expect.poll(() => pre.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
            }
            const block = pre.locator('..'), button = block.getByRole('button');
            assert.equal(await block.evaluate(el => getComputedStyle(el).borderRadius), '8px');
            assert.equal(await button.evaluate(el => getComputedStyle(el).borderRadius), '6px');
            assert.ok((await button.boundingBox()).height >= 44);
          }
          const cta = page.getByRole('link', { name: m.legal.connectCta, exact: true });
          assert.equal(await cta.evaluate(el => getComputedStyle(el).borderRadius), '6px');
          assert.ok((await cta.boundingBox()).height >= 44);
        }
        renders++;
      }
      if (path === '/docs/mcp') {
        await expect(page.locator('pre code')).toHaveText(commands);
        for (const mode of ['success', 'failed', 'pending']) {
          await page.evaluate(value => { window.__copyMode = value; window.__copyCalls = []; }, mode);
          for (const [index, pre] of (await page.locator('pre').all()).entries()) {
            const block = pre.locator('..'), button = block.getByRole('button');
            await button.focus(); await page.keyboard.press('Enter');
            if (mode === 'pending') {
              await expect(button).toBeDisabled();
              await expect(block.getByRole('status')).toHaveText(m.docsMcp.copying);
              await button.evaluate(el => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
              assert.equal((await page.evaluate(() => window.__copyCalls)).length, index + 1);
              await page.evaluate(() => window.__resolveCopy());
            }
            await expect(block.getByRole('status')).toHaveText(mode === 'failed' ? m.docsMcp.copyFailed : m.docsMcp.copied);
            await expect(button).toBeEnabled();
            await expect(pre.locator('code')).toHaveText(commands[index]); interactions++;
          }
          assert.deepEqual(await page.evaluate(() => window.__copyCalls), commands);
        }
        await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: undefined }); });
        const block = page.locator('pre').first().locator('..');
        await block.getByRole('button').click();
        await expect(block.getByRole('status')).toHaveText(m.docsMcp.copyFailed); interactions++;
        await block.screenshot({ path: join(output, `copy-fallback-${locale}-${theme}-320.png`) });
      } else {
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({ path: join(output, `${path ? 'supabase' : 'home'}-${locale}-${theme}-320.png`) });
      }
    }
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    await context.close(); console.log(`PASS ${locale}/${theme}`);
  }
  console.log(JSON.stringify({ renders, interactions, output }));
} finally { await browser.close(); }
