/** Actual extraction modal and SourcesClient with all API calls intercepted locally. */
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';

const base = process.argv[2] || 'http://localhost:3107';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const output = await mkdtemp(join(tmpdir(), 'supalens-kpi-extraction-'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let renders = 0, interactions = 0;
try {
  for (const locale of ['en', 'ko', 'ja']) for (const theme of ['light', 'dark']) {
    const m = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8')).appSources;
    const t = m.kpi.modal;
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: base }]);
    await context.addInitScript(value => localStorage.setItem('theme', value), theme);
    const unexpected = [], errors = [], posts = [];
    let responseMode = 'none', readMode = 'running', pendingRoute;
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === new URL(base).origin && (url.pathname.startsWith('/api/') || !['GET', 'HEAD'].includes(request.method()))) {
        if (responseMode !== 'none' && url.pathname === '/api/data-sources/fixture-extract-source/kpis/extract' && request.method() === 'POST') {
          posts.push(request.postDataJSON());
          if (responseMode === 'pending') { pendingRoute = route; return; }
          if (responseMode === 'abort') return route.abort('failed');
          const [status, json] = {
            invalid: [409, { error: 'repo_invalid' }], busy: [409, { error: 'extraction_in_progress' }],
            quota: [402, { error: 'quota_exceeded', reason: 'RAW_PRIVATE_PROVIDER_DETAIL' }],
            malformed: [200, { ok: true }], accepted: [200, { ok: true, extractionId: 'fixture-run', tier: 1 }],
          }[responseMode];
          return route.fulfill({ status, json });
        }
        if (responseMode !== 'none' && url.pathname === '/api/data-sources/fixture-extract-source/kpis' && request.method() === 'GET') {
          if (readMode === 'malformed') return route.fulfill({ json: {} });
          if (readMode === 'missing') return route.fulfill({ json: { extraction: null, kpis: [] } });
          if (readMode === 'failed') return route.fulfill({ status: 503, json: { error: 'unavailable' } });
          return route.fulfill({ json: { extraction: { status: 'running', createdAt: new Date().toISOString() }, kpis: [{ status: 'proposed' }, { status: 'proposed' }] } });
        }
        unexpected.push(`${request.method()} ${url.pathname}`); return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    const dialog = page.getByRole('dialog');
    const visit = async mode => {
      assert.equal((await page.goto(`${base}/dev/kpis?variant=extract&mode=${mode}`)).status(), 200, `${locale}/${theme}/${mode}`);
      await expect(dialog).toBeVisible();
    };
    const start = () => dialog.getByRole('button', { name: t.startCount.replace('{count}', '5'), exact: true });
    for (const mode of ['picker', 'repo', 'pending', 'quota', 'rejected', 'unknown', 'completed', 'partial', 'failed']) {
      await visit(mode);
      if (!['picker', 'repo'].includes(mode)) await start().click();
      if (mode === 'completed' || mode === 'partial') await expect(dialog.getByRole('button', { name: t.review, exact: true })).toBeVisible();
      if (mode === 'failed') await expect(dialog.getByText(t.failedTitle, { exact: true })).toBeVisible();
      if (mode === 'unknown') await expect(dialog.getByRole('link', { name: t.reload })).toHaveAttribute('href', '/app/sources');
      for (const width of [1440, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${mode} ${locale} ${width}: dialog overflow`);
        for (const control of await dialog.locator('button, a').all()) {
          const box = await control.boundingBox(); assert.ok(box.height >= 44, `${mode}: control height ${box.height}`);
        }
        if (['picker', 'repo'].includes(mode)) {
          await expect(dialog.locator('button[aria-pressed]')).toHaveCount(mode === 'repo' ? 6 : 5);
          assert.equal(await dialog.locator('button[aria-pressed]').first().evaluate(el => getComputedStyle(el).borderRadius), '16px');
        }
        if (width === 320) await page.screenshot({ path: join(output, `${mode}-${locale}-${theme}.png`), fullPage: true });
        renders++;
      }
    }
    await visit('picker');
    await dialog.getByRole('button', { name: t.clearAll, exact: true }).click();
    await expect(dialog.getByRole('button', { name: t.startCount.replace('{count}', '0'), exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: t.selectAll, exact: true }).click();
    await expect(start()).toBeEnabled(); interactions += 2;
    for (const mode of ['pending', 'missing-status']) {
      await visit(mode); await page.clock.install(); await start().click();
      await page.clock.fastForward(35000);
      await expect(dialog.getByText(t.awaitingTitle, { exact: true })).toBeVisible();
      await expect(dialog.getByRole('listitem')).toHaveCount(3);
      await expect(dialog.locator('[aria-current="step"], [role="progressbar"]')).toHaveCount(0);
      await expect(page.getByTestId('extract-calls')).toHaveText('1');
      interactions++;
      // Resume timers before navigating to the next case.
      await page.clock.resume();
    }
    await visit('throw'); await start().click();
    await expect(dialog.getByText(t.unconfirmedTitle, { exact: true })).toBeVisible(); interactions++;

    for (const mode of ['invalid', 'quota', 'busy', 'accepted', 'malformed', 'abort', 'pending']) {
      responseMode = mode; readMode = 'running'; posts.length = 0;
      await page.goto(`${base}/dev/kpis?variant=extract&mode=controller`);
      await page.getByRole('button', { name: m.pipeline.monNone }).click();
      await start().click();
      if (['invalid', 'quota'].includes(mode)) {
        await expect(start()).toBeVisible();
        await expect(dialog.getByRole('alert')).toBeVisible();
        assert.ok(!(await page.locator('body').innerText()).includes('RAW_PRIVATE_PROVIDER_DETAIL'));
      } else if (mode === 'pending') {
        await expect.poll(() => posts.length).toBe(1);
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: m.pipeline.monNone }).click();
        await start().click();
        await expect(dialog.getByText(t.awaitingTitle, { exact: true })).toBeVisible();
        await pendingRoute.fulfill({ json: { ok: true, extractionId: 'fixture-run', tier: 1 } });
        await expect(dialog.getByText(t.runningTitle, { exact: true })).toBeVisible();
      } else if (['busy', 'accepted'].includes(mode)) {
        await expect(dialog.getByText(t.runningTitle, { exact: true })).toBeVisible();
        if (mode === 'accepted') {
          await page.clock.fastForward(5000);
          await expect(dialog.getByText(t.catalogCount.replace('{count}', '2'), { exact: true })).toBeVisible();
          for (const failure of ['malformed', 'failed', 'missing']) {
            readMode = failure; await page.clock.fastForward(5000);
            await expect(dialog.getByText(t.statusUnavailable, { exact: true })).toBeVisible();
            await expect(dialog.getByText(t.catalogCount.replace('{count}', '2'), { exact: true })).toBeVisible();
            await expect(dialog.getByText(t.awaitingTitle, { exact: true })).toBeVisible();
            readMode = 'running'; await page.clock.fastForward(5000);
            await expect(dialog.getByText(t.statusUnavailable, { exact: true })).toHaveCount(0);
            await expect(dialog.getByText(t.runningTitle, { exact: true })).toBeVisible();
            interactions++;
          }
        }
      } else {
        await expect(dialog.getByText(t.unconfirmedTitle, { exact: true })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await page.getByRole('button', { name: m.pipeline.monNone }).click();
        await expect(dialog.getByText(t.unconfirmedTitle, { exact: true })).toBeVisible();
        await expect(dialog.getByRole('link', { name: t.reload })).toHaveAttribute('href', '/app/sources');
        await expect(start()).toHaveCount(0);
        await page.route(`${base}/app/sources`, route => {
          assert.equal(route.request().method(), 'GET');
          return route.fulfill({ contentType: 'text/html', body: '<main>Local reload destination</main>' });
        });
        await dialog.getByRole('link', { name: t.reload }).click();
        await expect(page.getByText('Local reload destination')).toBeVisible();
        await page.unroute(`${base}/app/sources`);
      }
      assert.deepEqual(posts, [{ categories: ['growth', 'revenue', 'engagement', 'ops', 'funnel'] }]);
      interactions++;
    }
    await context.close(); assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
    console.log(`PASS ${locale}/${theme}`);
  }
  console.log(JSON.stringify({ renders, interactions, output }, null, 2));
} finally { await browser.close(); }
