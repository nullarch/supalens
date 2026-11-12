/** Local synthetic fixtures only. All mutations and provider requests are blocked. */
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';

const base = process.argv[2] || 'http://localhost:3107';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const output = await mkdtemp(join(tmpdir(), 'supalens-recovery-'));
const browser = await chromium.launch({ headless: true });
let views = 0, flows = 0;
const requestedLocale = process.argv.find(arg => arg.startsWith('--locale='))?.split('=')[1];
assert(!requestedLocale || ['en', 'ko', 'ja'].includes(requestedLocale));
try {
  for (const locale of requestedLocale ? [requestedLocale] : ['en', 'ko', 'ja']) for (const theme of ['light', 'dark']) {
    const t = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8')).appRecovery;
    const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 1000 } });
    await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: base }]);
    await context.addInitScript(theme => localStorage.setItem('theme', theme), theme);
    const errors = [], blocked = [];
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === new URL(base).origin && (!['GET', 'HEAD'].includes(request.method()) || url.pathname.startsWith('/api/'))) { blocked.push(request.url()); return route.abort(); }
      if (url.origin !== new URL(base).origin && !['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'].includes(url.hostname)) return route.abort();
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (/MISSING_MESSAGE|INVALID_MESSAGE|hydration|cannot be a descendant/i.test(message.text())) errors.push(message.text()); });
    const open = async (query = '') => {
      assert.equal((await page.goto(`${base}/dev/monitors?mode=reconnect${query}`)).status(), 200);
      await expect(page.locator('[data-fixture-ready]')).toHaveAttribute('data-fixture-ready', 'true');
      await page.evaluate(() => document.fonts.ready);
      const group = page.locator('[data-recovery-kind=authorization]');
      if (!(await group.getAttribute('open'))) {
        if (!(await group.evaluate(el => el.open))) await group.locator('summary').click();
      }
    };
    const guide = page.locator('[data-recovery-guide]');
    const check = guide.locator('[data-recovery-check]');
    const consent = guide.getByRole('checkbox');
    await open('&outcome=partial&recovery=authorized');
    await expect(page.locator('[data-recovery-return=authorized]')).toContainText(t.feedback.unconfirmedBody);
    await expect(guide.locator('[data-recovery-kind=authorization]')).toHaveCount(1);
    await expect(guide.locator('[data-recovery-result]')).toHaveCount(4);
    const target = new URL(await guide.getByRole('link', { name: t.reauthorize, exact: false }).getAttribute('href'), base);
    assert.equal(target.searchParams.get('connectionId'), '00000000-0000-4000-8000-000000000001');
    assert.equal(target.searchParams.get('returnTo'), '/app/monitors/fixture-reconnect-0');
    await expect(check).toBeDisabled();
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await expect(guide).toBeVisible();
      if (locale === 'ko' && [1440, 390].includes(width)) await page.screenshot({ path: join(output, `${locale}-${theme}-${width}.png`), fullPage: true });
      views++;
    }
    await consent.check(); await check.click();
    await expect(consent).toBeDisabled(); await expect(check).toBeDisabled();
    await expect(guide.locator('[data-recovery-result=verified]')).toHaveCount(3, { timeout: 12000 });
    await expect(guide.locator('[data-recovery-result=authorization]')).toHaveCount(1);
    await expect(consent).not.toBeChecked();
    await expect(guide).toContainText(t.incidentPreserved);
    await expect(guide).toContainText(t.verifiedCondition.replace('{value}', '2'));
    await consent.check(); await check.click();
    await expect(consent).not.toBeChecked({ timeout: 5000 });
    const calls = await page.locator('[data-fixture-calls]').innerText();
    assert.equal((calls.match(/recovery:fixture-reconnect-1/g) || []).length, 2);
    assert.equal((calls.match(/recovery:fixture-reconnect-0/g) || []).length, 1);
    flows++;
    for (const outcome of ['success', 'failure', 'throw', 'malformed']) {
      await open(`&outcome=${outcome}`); await consent.check(); await check.click();
      await expect(guide.locator(`[data-recovery-result=${outcome === 'success' ? 'verified' : outcome === 'failure' ? 'authorization' : 'unconfirmed'}]`)).toHaveCount(4, { timeout: 12000 });
      await expect(check).toHaveCount(outcome === 'success' ? 0 : 1);
      flows++;
    }
    await open('&role=viewer');
    await expect(check).toHaveCount(0);
    await expect(guide.getByRole('link', { name: t.reauthorize, exact: false })).toHaveCount(0);
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Sample clipboard denial'); } } }));
    await guide.getByRole('button', { name: t.copyRequest, exact: true }).click();
    await expect(guide.getByRole('textbox', { name: t.copyRequest })).toBeVisible();
    await expect(guide).toContainText(t.copyFailed);
    flows++;
    for (const reason of ['cancelled', 'expired', 'projectMismatch', 'cleanupPending', 'unconfirmed']) {
      await open(`&recovery=${reason}`);
      await expect(page.locator('[data-recovery-return]')).toContainText(t.returns[reason]);
      await expect(guide.locator('[data-recovery-result=verified]')).toHaveCount(0);
      flows++;
    }
    assert.deepEqual(blocked, [], 'No server action, OAuth, provider or customer query request');
    assert.deepEqual(errors, [], 'No runtime, hydration or translation errors');
    await context.close();
    console.log(`${locale}/${theme}: recovery flows passed`);
  }
  console.log(JSON.stringify({ views, flows, output, writes: 0 }));
} finally { await browser.close(); }
