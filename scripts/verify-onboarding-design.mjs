/** Real onboarding UI, dummy credentials and locally resolved Slack actions only. */
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect } from '@playwright/test';

const baseURL = process.argv[2] || 'http://localhost:3107';
assert(['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname));
const output = await mkdtemp(join(tmpdir(), 'supalens-onboarding-'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let renders = 0, interactions = 0;
const field = (scope, label) => scope.getByLabel(new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\*?$'));

async function fit(page) {
  await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 1);
  const dialog = page.getByRole('dialog');
  if (await dialog.count()) {
    const box = await dialog.boundingBox(), viewport = page.viewportSize();
    assert.ok(box.x >= 15 && box.x + box.width <= viewport.width - 15, `Dialog horizontal fit: ${JSON.stringify(box)}`);
    assert.ok(box.y >= 15 && box.y + box.height <= viewport.height - 15, `Dialog vertical fit: ${JSON.stringify(box)}`);
    // Responsive chart containers settle on the next resize-observer tick.
    await expect.poll(() => dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), { message: `No horizontal overflow inside wizard at ${viewport.width}px` }).toBe(true);
    const replayValue = dialog.locator('[class*="replayStat"] [class*="bigValue"]');
    if (await replayValue.count()) await expect.poll(() => replayValue.evaluate(el => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1), { message: 'The full sample metric remains visible' }).toBe(true);
  }
}

try {
  for (const locale of ['en', 'ko', 'ja']) {
    const m = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));
    const w = m.appWizard, s = m.appSetup.slack, f = m.appSources.form;
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ reducedMotion: 'reduce' });
      context.setDefaultTimeout(12000);
      await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: baseURL }]);
      await context.addInitScript(value => {
        localStorage.setItem('theme', value);
        localStorage.removeItem('supalens.wizard.dismissed.design-fixture');
      }, theme);
      const errors = [], unexpected = [];
      let expectConnection = false, held = null;
      await context.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== new URL(baseURL).origin && !['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) return route.abort();
        if (request.url().startsWith(baseURL) && url.pathname.startsWith('/api/')) {
          if (expectConnection && url.pathname === '/api/data-sources' && request.method() === 'POST') { held = route; return; }
          if (request.method() !== 'GET' || url.pathname.includes('/authorize')) unexpected.push(`${request.method()} ${url.pathname}`);
          return route.fulfill({ status: 200, json: {} });
        }
        if (!['GET', 'HEAD'].includes(request.method())) {
          if (request.url().startsWith(baseURL)) unexpected.push(`${request.method()} ${url.pathname}`);
          return route.abort();
        }
        return route.continue();
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => {
        if (/MISSING_MESSAGE|INVALID_MESSAGE|requires a.*Title|Missing.*Description/.test(message.text())) errors.push(message.text());
      });
      const dialog = page.getByRole('dialog');
      async function matrix(name) {
        await page.evaluate(() => document.fonts.ready);
        for (const width of [1440, 768, 390, 320]) {
          await page.setViewportSize({ width, height: 900 });
          await fit(page);
          renders++;
        }
        if (locale === 'en') await page.screenshot({ path: join(output, `${name}-${theme}-mobile.png`), fullPage: true });
        console.log(`PASS ${name}/${locale}/${theme}`);
      }
      async function wizard(query = '') {
        assert.equal((await page.goto(`${baseURL}/dev/wizard${query}`)).status(), 200);
        await expect(dialog).toBeVisible();
        await expect(dialog).toHaveAccessibleName(w.aria);
      }
      async function slack(mode) {
        assert.equal((await page.goto(`${baseURL}/dev/wizard?view=slack&state=${mode}`)).status(), 200);
        await expect(page.getByRole('heading', { name: s.title })).toBeVisible();
      }

      await wizard();
      await expect(dialog.getByText(w.act1.a, { exact: true })).toBeVisible();
      await matrix('wizard-replay');
      await expect.poll(() => dialog.locator('[class*="replayStat"] [class*="bigValue"]').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      // Modal background is not focusable, even at the two ends of the tab order.
      for (const key of [...Array(20).fill('Tab'), ...Array(20).fill('Shift+Tab')]) {
        await page.keyboard.press(key);
        assert.ok(await dialog.evaluate(el => el.contains(document.activeElement)));
      }
      await page.mouse.click(2, 2);
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      const opener = page.getByRole('button', { name: 'Open wizard preview', exact: true });
      await opener.click();
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(opener).toBeFocused();
      assert.ok(await page.evaluate(() => localStorage.getItem('supalens.wizard.dismissed.design-fixture')));
      assert.notEqual(await page.locator('body').evaluate(el => getComputedStyle(el).overflow), 'hidden');
      interactions++;

      await wizard('?resume=1');
      await expect(dialog.getByRole('heading', { name: w.act2.title })).toBeVisible();
      await matrix('wizard-connect');
      for (const engine of ['postgres', 'mysql', 'firestore']) {
        await dialog.getByRole('button', { name: w.act2[engine], exact: true }).click();
        await matrix(`wizard-${engine}`);
        if (engine === 'firestore') {
          await dialog.locator('input[type="file"]').setInputFiles({ name: 'sample.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ type: 'service_account', project_id: 'fixture-project', client_email: 'sample@example.invalid', private_key: 'NOT_A_REAL_PRIVATE_KEY' })) });
        } else {
          for (const [label, value] of [[f.name, 'Fixture only'], [f.host, 'database.example.invalid'], [f.database, 'sample'], [f.user, 'fixture_reader'], [f.password, 'NOT_A_REAL_PASSWORD']]) await field(dialog, label).fill(value);
        }
        expectConnection = true; held = null;
        await dialog.getByRole('button', { name: f.submit, exact: true }).click();
        await expect.poll(() => !!held).toBe(true);
        for (const name of [w.close, w.act2.back, w.act2.later, w.act2.next]) await expect(dialog.getByRole('button', { name, exact: true })).toBeDisabled();
        await page.keyboard.press('Escape');
        await expect(dialog).toBeVisible();
        await held.fulfill({ status: 503, json: { message: 'Sample connection failed. No external database was contacted.' } });
        held = null; expectConnection = false;
        await expect(dialog.getByRole('alert')).toContainText('Sample connection failed');
        await expect(field(dialog, f.name)).toHaveValue(engine === 'firestore' ? 'fixture-project' : 'Fixture only');
        await fit(page);
        await dialog.getByRole('button', { name: w.act2.back, exact: true }).click();
        interactions++;
      }
      await dialog.getByRole('button', { name: w.act2.later, exact: true }).click();
      await expect(dialog.getByRole('heading', { name: w.act4.titleSample })).toBeVisible();
      await expect(dialog).toBeFocused();
      await matrix('wizard-samples');
      await page.keyboard.press('Escape');
      await wizard('?connected=1&resume=1');
      await expect(dialog.getByRole('heading', { name: w.act3.title })).toBeVisible();
      await matrix('wizard-code');
      await dialog.getByRole('button', { name: w.act3.later, exact: true }).click();
      await expect(dialog).toBeFocused();
      await expect(dialog.getByRole('button', { name: w.act4.startExtract, exact: true })).toBeEnabled();
      await matrix('wizard-extract');
      await page.keyboard.press('Escape'); // Never start a job or stamp completion.
      await wizard('?mode=tour');
      await expect(dialog.getByRole('button', { name: w.act1.startTour, exact: true })).toBeVisible();
      await matrix('wizard-tour');
      await page.keyboard.press('Escape');

      for (const mode of ['fresh', 'review', 'complete', 'complete-slack']) {
        assert.equal((await page.goto(`${baseURL}/dev/wizard?view=setup&state=${mode}`)).status(), 200);
        await expect(page.locator('h1')).toHaveText(mode.startsWith('complete') ? m.appSetup.complete.title : m.appSetup.title);
        if (mode.startsWith('complete')) await expect(page.getByText(m.appSetup.complete.nextHours.replace('{hours}', '2'), { exact: true })).toBeVisible();
        if (mode === 'complete-slack') {
          const headings = await page.locator('h1,h2').allTextContents();
          assert.equal(headings[0], m.appSetup.complete.title, 'Completion summary precedes optional Slack setup');
          assert.ok(headings.includes(s.title));
        }
        await matrix(`setup-${mode}`);
      }

      for (const mode of ['success', 'viewer', 'empty', 'unselected', 'unconfigured', 'disconnected']) {
        await slack(mode);
        await matrix(`slack-${mode}`);
        if (mode === 'viewer') {
          await expect(page.getByRole('button', { name: s.channelLabel, exact: true })).toBeDisabled();
          await expect(page.getByRole('button', { name: s.test, exact: true })).toHaveCount(0);
          await expect(page.getByText(s.readOnly, { exact: true })).toBeVisible();
        }
      }
      // Save failure/exception restore the last confirmed destination; success persists it.
      for (const mode of ['success', 'failed', 'throws']) {
        await slack(mode);
        const picker = page.getByRole('button', { name: s.channelLabel, exact: true });
        await picker.click();
        await page.getByRole('option').filter({ hasText: 'international-subscription' }).getByRole('button').click();
        await expect(picker).toBeDisabled();
        await expect(page.getByRole('main').getByRole('status')).toHaveText(s.saving);
        await expect(page.getByRole('button', { name: s.test, exact: true })).toBeDisabled();
        await page.getByRole('button', { name: 'Resolve sample request' }).click();
        await expect(picker).toBeEnabled();
        await expect(picker).toContainText(mode === 'success' ? 'international-subscription' : '#general');
        await expect(page.getByRole('main').getByRole(mode === 'success' ? 'status' : 'alert')).toContainText(mode === 'success' ? s.saved : s.saveFailed);
        await expect(page.locator('[data-fixture-refresh]')).toHaveAttribute('data-fixture-refresh', mode === 'success' ? '1' : '0');
        await fit(page);
        interactions++;
      }
      // Both / channel-only / email-only / neither / server rejection / network exception.
      for (const mode of ['success', 'partial', 'email-only', 'failed', 'rejected', 'throws']) {
        await slack(mode);
        await page.getByRole('button', { name: s.test, exact: true }).click();
        await expect(page.getByRole('button', { name: s.testing, exact: true })).toBeDisabled();
        await expect(page.getByRole('button', { name: s.channelLabel, exact: true })).toBeDisabled();
        await page.getByRole('button', { name: 'Resolve sample request' }).click();
        const notice = page.getByRole('main').getByRole(mode === 'success' ? 'status' : 'alert');
        await expect(notice).toBeVisible();
        if (['rejected', 'throws'].includes(mode)) await expect(notice).toHaveText(s.testFailed);
        else {
          await expect(notice).toContainText(['success', 'partial'].includes(mode) ? s.channelsAccepted : s.channelsUnconfirmed);
          await expect(notice).toContainText(['success', 'email-only'].includes(mode) ? s.emailAccepted : s.emailUnconfirmed);
        }
        await expect(notice).toHaveAttribute('data-kind', mode === 'success' ? 'ok' : ['partial', 'email-only'].includes(mode) ? 'warning' : 'err');
        await matrix(`slack-test-${mode}`);
        interactions++;
      }
      if (locale === 'en') {
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.setViewportSize({ width: 1440, height: 1000 });
        await wizard();
        await expect(dialog.getByText(w.act1.a, { exact: true })).toBeVisible({ timeout: 15000 });
        await fit(page);
        await page.screenshot({ path: join(output, `wizard-replay-${theme}-desktop.png`) });
        await page.keyboard.press('Escape');
        interactions++;
      }
      assert.deepEqual(unexpected, [], 'No external mutations or OAuth requests');
      assert.deepEqual(errors, [], 'No client, translation or modal-accessibility errors');
      await context.close();
    }
  }
  console.log(JSON.stringify({ renders, interactions, screenshots: output }, null, 2));
} finally { await browser.close(); }
