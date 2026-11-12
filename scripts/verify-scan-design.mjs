/** Actual scan controller/view with local responses. Never starts a real job or analytics event. */
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';

const base = process.argv[2] || 'http://localhost:3107';
const output = await mkdtemp(join(tmpdir(), 'supalens-scan-'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let renders = 0, interactions = 0;
try {
  for (const locale of ['en', 'ko', 'ja']) {
    const t = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8')).appSetup.scan;
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 1000 } });
      await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: base }]);
      await context.addInitScript(value => localStorage.setItem('theme', value), theme);
      const unexpected = [], errors = [];
      await context.route('**/*', route => {
        const r = route.request(), url = r.url();
        if (url.startsWith(base) && (new URL(url).pathname.startsWith('/api/') || !['GET', 'HEAD'].includes(r.method()))) { unexpected.push(`${r.method()} ${url}`); return route.abort(); }
        if (!url.startsWith(base) && /posthog|sentry|google-analytics|googletagmanager|channel\.io/.test(url)) return route.abort();
        return route.continue();
      });
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error' && /MISSING_MESSAGE|INVALID_MESSAGE/.test(m.text())) errors.push(m.text()); });
      const panel = () => page.getByRole('region', { name: t.title, exact: true });
      const status = () => panel().getByRole('status');
      const refresh = () => panel().getByRole('button', { name: t.refresh, exact: true });
      const requests = async () => JSON.parse(await page.locator('[data-scan-calls]').innerText());
      const open = async mode => {
        const res = await page.goto(`${base}/dev/setup-scan${mode ? `?mode=${mode}` : ''}`, { waitUntil: 'domcontentloaded' });
        assert.equal(res.status(), 200); await page.evaluate(() => document.fonts.ready);
      };
      const fit = async label => {
        for (const width of [1440, 768, 390, 320]) {
          await page.setViewportSize({ width, height: 1000 });
          await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}/${locale}/${theme}/${width} document overflow`);
          for (const value of await page.locator('[data-metric]').all()) assert.ok(await value.evaluate(el => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1), 'Measured value is fully visible');
          renders++;
          if (locale === 'en' && [1440, 320].includes(width) && ['kpi', 'overflow', 'read-error', 'post-repository', 'waiting', 'zero'].includes(label)) await page.screenshot({ path: join(output, `${label}-${theme}-${width}.png`), fullPage: true });
        }
      };
      if (process.argv.includes('--status-copy')) {
        for (const mode of ['read-error', 'read-throw', 'read-malformed']) {
          await open(mode); await refresh().click();
          await expect(status()).toHaveAttribute('data-state', 'unavailable');
          await expect(panel().getByRole('button').first()).toHaveText(t.unconfirmed);
          await expect(panel().getByRole('button').first()).toBeDisabled();
          await fit(mode); interactions++;
        }
        assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
        await context.close(); console.log(`PASS scan status copy ${locale}/${theme}`); continue;
      }
      for (const mode of ['idle', 'schema-only', 'schema', 'context', 'kpi', 'failed', 'ready', 'zero', 'skipped', 'overflow']) {
        await open(mode);
        await expect(page.locator('[data-metric]')).toHaveCount(4);
        if (['idle', 'schema-only'].includes(mode)) {
          assert.deepEqual(await page.locator('[data-metric]').allTextContents(), ['—', '—', '—', '—']);
          if (mode === 'schema-only') await expect(panel()).toContainText(t.bodySchemaOnly);
        }
        if (mode === 'zero') { await expect(status()).toHaveAttribute('data-state', 'empty'); await expect(page.locator('[data-metric="kpis"]')).toHaveText('0'); await expect(panel()).toContainText(t.emptyDone); }
        if (['kpi', 'overflow'].includes(mode)) {
          await panel().locator('summary').filter({ hasText: t.reveal.rules }).click();
          await expect(panel()).toContainText('confirm these inferred rules with the business owner before approving the KPI definition.');
        }
        await fit(mode);
      }
      await open(); await fit('gallery');
      assert.equal(await page.locator('[data-scan-reports]').count(), 0, 'Static gallery has no controller effects');

      for (const [mode, key] of [['post-limit', 'limit'], ['post-quota', 'quota'], ['post-repository', 'repository'], ['post-installation', 'repository'], ['post-denied', 'permission'], ['post-failed', 'failed'], ['post-throw', 'failed']]) {
        await open(mode); await panel().getByRole('button').first().click();
        await expect(status()).toHaveAttribute('data-state', 'submitting'); await expect(panel().getByRole('button').first()).toBeDisabled();
        await expect(panel().getByRole('alert')).toContainText(t[key]); await expect(panel().getByRole('button').first()).toBeEnabled();
        assert.equal((await requests()).filter(x => x.startsWith('POST')).length, 1);
        if (key === 'repository') { await expect(panel().getByRole('alert')).not.toContainText(t.conflict); assert.equal((await requests()).filter(x => x.startsWith('GET')).length, 0); }
        await fit(mode); interactions++;
      }
      await open('post-conflict'); await panel().getByRole('button').first().click(); await expect(status()).toHaveAttribute('data-state', 'running');
      await expect(panel().getByRole('button').first()).toBeDisabled(); await fit('post-conflict'); interactions++;

      for (const mode of ['read-error', 'read-throw', 'read-malformed']) {
        await open(mode); await refresh().click(); await expect(status()).toHaveAttribute('data-state', 'unavailable');
        await expect(panel().getByRole('button').first()).toHaveText(t.unconfirmed);
        await expect(page.locator('[data-metric="tables"]')).toHaveText('42'); await expect(panel().getByRole('button').first()).toBeDisabled();
        await fit(mode); await page.getByRole('button', { name: 'Restore sample reads', exact: true }).click();
        await refresh().click(); await expect(status()).toHaveAttribute('data-state', 'running');
        assert.equal((await requests()).filter(x => x.startsWith('POST')).length, 0); interactions++;
      }
      await open('waiting'); await panel().getByRole('button').first().click(); await expect(status()).toHaveAttribute('data-state', 'waiting');
      assert.deepEqual(await page.locator('[data-metric]').allTextContents(), ['—', '—', '—', '—']);
      await fit('waiting');
      await page.getByRole('button', { name: 'Complete sample scan', exact: true }).click(); await refresh().click();
      await expect(status()).toHaveAttribute('data-state', 'ready');
      await expect(page.locator('[data-scan-reports]')).toContainText('business_scan_completed:fixture-scan');
      await refresh().click(); await expect(refresh()).toBeEnabled();
      assert.equal((await page.locator('[data-scan-reports]').innerText()).split('business_scan_completed:').length - 1, 1, 'Completion reported once'); interactions++;

      await open('done-response'); await panel().getByRole('button').first().click(); await expect(status()).toHaveAttribute('data-state', 'ready');
      await expect(page.locator('[data-metric="kpis"]')).toHaveText('3'); await fit('done-response'); interactions++;
      await open('failed'); await panel().getByRole('button').first().click(); await expect(status()).toHaveAttribute('data-state', 'submitting');
      await expect(status()).toHaveAttribute('data-state', 'running'); interactions++;

      if (locale === 'en' && theme === 'light') {
        await open('slow'); await refresh().click();
        await page.waitForTimeout(3400); assert.equal((await requests()).length, 1, 'Polling never overlaps a pending status request');
        await page.getByRole('button', { name: 'Switch sample source', exact: true }).click();
        await page.waitForTimeout(4100);
        assert.deepEqual(await page.locator('[data-metric]').allTextContents(), ['—', '—', '—', '—']);
        assert.equal((await requests()).length, 1, 'Old source polling is cleaned up'); interactions++;
        await open('timeout'); await refresh().click();
        await expect(status()).toHaveAttribute('data-state', 'unavailable', { timeout: 18000 });
        await expect(refresh()).toBeEnabled(); interactions++;
      }
      assert.deepEqual(unexpected, [], 'No real API, job or server action requests'); assert.deepEqual(errors, []);
      await context.close(); console.log(`PASS scan ${locale}/${theme}`);
    }
  }
  console.log(JSON.stringify({ renders, interactions, screenshots: output }, null, 2));
} catch (error) { console.error(error); throw error; } finally { await browser.close(); }
