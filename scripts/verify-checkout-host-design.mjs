import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';

const base = process.argv[2] || 'http://localhost:3107';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const source = await readFile('src/app/dev/checkout-host/page.tsx', 'utf8');
const modes = JSON.parse(source.match(/const CHECKOUT_HOST_MODES = (\[[^\]]+\])/)[1].replaceAll("'", '"'));
const output = await mkdtemp(join(tmpdir(), 'supalens-checkout-host-'));
const browser = await chromium.launch({ channel: 'chrome' });
let renders = 0, interactions = 0;
try {
  for (const locale of ['en', 'ko', 'ja']) for (const theme of ['light', 'dark']) {
    console.log(`Checkout host: ${locale}/${theme}`);
    const { proxyCheckout: t } = JSON.parse(await readFile(`messages/${locale}.json`, 'utf8'));
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: base }]);
    await context.addInitScript(theme => localStorage.setItem('theme', theme), theme);
    const errors = [], unexpected = [];
    await context.route('**/*', route => {
      const r = route.request(), url = new URL(r.url());
      if (url.origin !== new URL(base).origin) {
        if (/paddle/i.test(url.hostname)) unexpected.push(`Provider request ${url.hostname}`);
        const font = ['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)
          || (url.hostname === 'cdn.jsdelivr.net' && url.pathname.startsWith('/gh/orioncactus/pretendard@v1.3.9/'));
        return font && r.method() === 'GET' ? route.continue() : route.abort();
      }
      if (r.method() !== 'GET' || /^\/(api|auth|app|proxy)(\/|$)/.test(url.pathname)) {
        unexpected.push(`${r.method()} ${url.pathname}`); return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (/MISSING_MESSAGE|INVALID_MESSAGE/.test(m.text())) errors.push(m.text()); });
    const host = page.locator('[data-checkout-host]');
    const calls = async () => JSON.parse(await page.locator('[data-checkout-calls]').textContent());
    const opens = async () => (await calls()).filter(c => c.action === 'open');
    const navigations = async () => (await calls()).filter(c => c.action === 'navigate');
    const fit = async () => {
      for (const width of [1440, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        for (const el of await host.locator('h1, p, a, button').all()) {
          if (!await el.isVisible()) continue;
          assert(await el.evaluate(e => e.scrollWidth <= e.clientWidth + 1), 'Internal text overflow');
        }
        for (const el of await host.locator('button, a').all()) {
          const b = await el.boundingBox(); assert(b.height >= 44); assert((await el.innerText()).trim());
        }
        assert(!await host.innerText().then(text => text.includes('PRIVATE_')));
        for (const notice of await host.locator('[role=alert], [role=status]').all()) {
          const contrast = await notice.evaluate(el => {
            const style = getComputedStyle(el);
            const luminance = rgb => rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0);
            const a = luminance(style.color), b = luminance(style.backgroundColor);
            return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
          });
          assert(contrast >= 4.5, `Notice contrast ${contrast}`);
        }
        renders++;
      }
    };
    for (const mode of modes) {
      await page.goto(`${base}/dev/checkout-host?mode=${mode}`);
      const expected = ['error', 'undefined', 'open-throw'].includes(mode) ? 'error' : mode === 'navigation-failed' ? 'completed' : ['long', 'stale'].includes(mode) ? 'open' : mode;
      await expect(host).toHaveAttribute('data-phase', expected);
      await expect(host.getByRole('heading', { level: 1 })).toContainText(mode === 'long' ? 'Northstar国際' : 'Northstar');
      await expect(host.getByText(t.states[expected].title, { exact: true })).toBeVisible();
      for (const call of await opens()) {
        assert.equal(call.settings.transactionId, 'txn_sampleA');
        assert.equal(call.settings.settings.locale, locale);
        assert.equal(call.settings.settings.theme, theme);
        assert.equal(call.settings.settings.displayMode, 'overlay');
        assert.equal(call.settings.customer.email, 'sample@example.invalid');
        assert.equal(call.settings.items, undefined, 'Must not create another checkout from items');
      }
      await fit();
      if (['long', 'navigation-failed', 'error'].includes(mode)) await host.screenshot({ path: join(output, `${locale}-${theme}-${mode}-320.png`) });
      if (mode === 'navigation-failed' || mode === 'completed') {
        assert.equal((await navigations()).length, 1);
        await page.getByRole('button', { name: 'Complete sample', exact: true }).click();
        await page.getByRole('button', { name: 'Close sample', exact: true }).click();
        await page.getByRole('button', { name: 'Error sample', exact: true }).click();
        await expect(host).toHaveAttribute('data-phase', 'completed');
        assert.equal((await navigations()).length, 1);
        assert.equal((await opens()).length, 1);
        await host.getByRole('link').click();
        assert.equal((await navigations()).length, 2);
        assert.equal((await opens()).length, 1);
        assert((await navigations()).every(c => c.url === 'https://partner.example.invalid/success?sample=A'));
        interactions += 4;
      }
      if (mode === 'open' || mode === 'long') {
        await page.getByRole('button', { name: 'Unrelated sample', exact: true }).click();
        assert.equal((await navigations()).length, 0);
        await page.getByRole('button', { name: 'Close sample', exact: true }).click();
        await expect(host).toHaveAttribute('data-phase', 'closed');
        await fit();
        const reopen = host.getByRole('button', { name: t.reopen, exact: true });
        await reopen.focus(); await page.keyboard.press('Enter');
        await expect(host).toHaveAttribute('data-phase', 'open');
        assert.equal((await opens()).length, 2);
        await expect(host.getByRole('status')).toBeFocused();
        await page.getByRole('button', { name: 'Close sample', exact: true }).click();
        await host.getByRole('link').click();
        assert.deepEqual(await navigations(), [{ action: 'navigate', url: 'https://partner.example.invalid/canceled?sample=A' }]);
        interactions += 5;
      }
      if (mode === 'stale') {
        await page.getByRole('button', { name: 'Change transaction', exact: true }).click();
        await expect.poll(async () => (await opens()).length).toBe(2);
        await page.getByRole('button', { name: 'Old sample callback', exact: true }).click();
        assert.equal((await navigations()).length, 0);
        await page.getByRole('button', { name: 'Complete sample', exact: true }).click();
        assert.deepEqual(await navigations(), [{ action: 'navigate', url: 'https://partner.example.invalid/success?sample=B' }]);
        interactions += 3;
      }
    }
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    await context.close();
  }
} finally { await browser.close(); }
console.log(JSON.stringify({ modes: modes.length, renders, interactions, output }));
