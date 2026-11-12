/** Local synthetic data only; all writes and external requests are blocked. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect as baseExpect } from '@playwright/test';
const expect = baseExpect.configure({ timeout: 15000 });

const base = process.argv[2] || 'http://localhost:3107';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const output = await mkdtemp(join(tmpdir(), 'supalens-oauth-feedback-'));
const browser = await chromium.launch({ headless: true });
const id = '00000000-0000-4000-8000-000000000001';
let views = 0;
try {
  for (const locale of ['ko', 'en', 'ja']) for (const theme of ['light', 'dark']) {
    const t = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8')).appRecovery;
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: base }]);
    await context.addInitScript(theme => localStorage.setItem('theme', theme), theme);
    let snapshot = { status: 'active', activeSources: 4 }, status = 200, reads = 0;
    const blocked = [], errors = [];
    await context.route('**/*', route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin === new URL(base).origin && url.pathname === '/api/connect-supabase/status' && req.method() === 'GET') {
        reads++;
        return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(snapshot) });
      }
      if (url.origin === new URL(base).origin && (!['GET', 'HEAD'].includes(req.method()) || url.pathname.startsWith('/api/'))) { blocked.push(url.pathname); return route.abort(); }
      if (url.origin !== new URL(base).origin) return route.abort();
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (/MISSING_MESSAGE|INVALID_MESSAGE|hydration/i.test(message.text())) errors.push(message.text()); });
    const card = page.locator('[data-oauth-phase]');
    const open = query => page.goto(`${base}/dev/monitors?mode=reauthorized&${query}`);
    await open(`recovery=authorized&supabaseConnection=${id}`);
    await expect(card).toHaveAttribute('data-oauth-phase', 'authorized');
    await expect(card).toContainText(t.feedback.authorizedTitle);
    await expect(page.locator('[data-awaiting-check=true]')).toHaveCount(1);
    await expect(page.getByRole('link', { name: t.reauthorize, exact: false })).toHaveCount(0);
    await expect(page.locator('[data-recovery-check]')).toBeDisabled();
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await expect(card).toBeVisible();
      if (locale === 'ko' && [1440, 390].includes(width)) await page.screenshot({ path: join(output, `${locale}-${theme}-${width}.png`), fullPage: true });
      views++;
    }
    // A refresh must not trigger a status-fetch/refresh loop.
    await page.waitForTimeout(400);
    assert(reads <= 3, `Unexpected metadata request loop: ${reads}`);
    await card.getByRole('button', { name: t.feedback.dismiss }).click();
    await expect(card).toHaveCount(0);
    // Stored authorization progress survives removal of callback parameters.
    await open('');
    await expect(page.locator('[data-awaiting-check=true]')).toHaveCount(1);
    await expect(card).toHaveCount(0);
    const before = reads;
    await open('recovery=authorized');
    await expect(card).toHaveAttribute('data-oauth-phase', 'unconfirmed');
    assert.equal(reads, before, 'No lookup without a validated connection id');
    for (const reason of ['cancelled', 'expired', 'projectMismatch', 'unconfirmed']) {
      await open(`recovery=${reason}`);
      await expect(card).toContainText(t.returns[reason]);
      await expect(card).toHaveAttribute('data-tone', 'warning');
    }
    status = 503;
    await open(`recovery=authorized&supabaseConnection=${id}`);
    await expect(card).toHaveAttribute('data-oauth-phase', 'unconfirmed');
    status = 200;
    await card.getByRole('button', { name: t.feedback.retry }).click();
    await expect(card).toHaveAttribute('data-oauth-phase', 'authorized');
    snapshot = { status: 'revoked', activeSources: 4 };
    await open(`recovery=authorized&supabaseConnection=${id}`);
    await expect(card).toHaveAttribute('data-oauth-phase', 'unavailable');
    snapshot = { status: 'active', activeSources: 0 };
    await open(`select=supabase&supabaseConnection=${id}`);
    await expect(card).toHaveAttribute('data-oauth-phase', 'select');
    await open(`connecting=supabase&supabaseConnection=${id}`);
    await expect(card).toHaveAttribute('data-oauth-phase', 'importing');
    snapshot = { status: 'active', activeSources: 1 };
    await expect(card).toHaveAttribute('data-oauth-phase', 'connected', { timeout: 10000 });
    // A new explicit authorization failure must restore the reauthorization action.
    await open('outcome=partial');
    await page.locator('[data-recovery-guide]').getByRole('checkbox').check();
    await page.locator('[data-recovery-check]').click();
    await expect(page.locator('[data-recovery-result=authorization]')).toHaveCount(1);
    await expect(page.getByRole('link', { name: t.reauthorize, exact: false })).toHaveCount(1);
    if (locale === 'ko' && theme === 'light') {
      // Virtual browser time exercises the full polling ceiling without a minute-long sleep.
      await page.clock.install();
      snapshot = { status: 'active', activeSources: 0 };
      await open(`connecting=supabase&supabaseConnection=${id}`);
      await expect(card).toHaveAttribute('data-oauth-phase', 'importing');
      for (let n = 0; n < 20; n++) {
        await page.clock.runFor(3500);
        await page.waitForTimeout(80);
      }
      await expect(card).toHaveAttribute('data-oauth-phase', 'delayed');
      const stopped = reads;
      await page.clock.runFor(30000);
      assert.equal(reads, stopped, 'Polling stops at the ceiling, leaving a visible next step');
    }
    assert.deepEqual(blocked, []);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`${locale}/${theme}: return states passed`);
  }
  console.log(JSON.stringify({ views, output, writes: 0 }));
} finally { await browser.close(); }
