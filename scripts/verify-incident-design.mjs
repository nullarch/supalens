import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';

const base = process.argv[2] || 'http://localhost:3107';
const output = await mkdtemp(join(tmpdir(), 'supalens-incident-design-'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let renders = 0, interactions = 0;
try {
  for (const locale of ['en', 'ko', 'ja']) {
    const { appIncidents: t } = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
      await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: base }]);
      await context.addInitScript(value => localStorage.setItem('theme', value), theme);
      const errors = [], mutations = [];
      await context.route('**/*', route => {
        const r = route.request(), url = r.url();
        if (url.startsWith(base) && (!['GET', 'HEAD'].includes(r.method()) || new URL(url).pathname.startsWith('/api/'))) { mutations.push(url); return route.abort(); }
        if (!url.startsWith(base) && /posthog|sentry|channel\.io|google-analytics|googletagmanager/.test(url)) return route.abort();
        return route.continue();
      });
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (/MISSING_MESSAGE|INVALID_MESSAGE/.test(m.text())) errors.push(m.text()); });
      const visit = async (mode, status = 'all') => {
        assert.equal((await page.goto(`${base}/dev/incidents?mode=${mode}&status=${status}`)).status(), 200);
        await page.evaluate(() => document.fonts.ready);
      };
      async function fit(label) {
        for (const width of [1440, 768, 390, 320]) {
          await page.setViewportSize({ width, height: 1000 });
          await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), { message: `${label}/${locale}/${theme}/${width}` }).toBe(true);
          renders++;
          if (locale === 'en' && width === 320 && ['long', 'resolved', 'feedback-failure', 'feedback-throw'].includes(label)) await page.screenshot({ path: join(output, `${label}-${theme}.png`), fullPage: true });
        }
      }
      for (const mode of ['success', 'failure', 'throw', 'viewer', 'legacy', 'empty', 'long', 'pending', 'resolved']) {
        await visit(mode); await fit(mode);
        const triage = page.locator('[data-triage-preview]');
        await expect(triage).toHaveCount(['viewer', 'legacy'].includes(mode) ? 0 : 1);
        if (mode === 'pending') await expect(triage.getByRole('textbox')).toHaveCount(0);
        if (mode === 'empty') await expect(page.getByText(t.table.empty, { exact: true })).toBeVisible();
        else {
          // The queue restacks its rows below table width instead of scrolling sideways.
          const queue = page.getByRole('region', { name: t.table.region });
          await expect(queue).toBeVisible();
          await expect.poll(() => queue.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true); interactions++;
          await expect(queue.locator('caption')).toContainText('Asia/Seoul');
        }
        const sql = page.locator('summary').filter({ hasText: t.detail.showSql });
        await sql.focus(); await page.keyboard.press('Enter');
        await expect(page.locator('details[open] pre')).toContainText('select sum(total_amount)');
        interactions++;
      }
      for (const status of ['openish', 'open', 'investigating', 'resolved', 'all']) {
        await visit('success', status);
        const current = page.locator('nav a[aria-current="page"]');
        // The queue is the 감시 screen's second view, so its filter links stay on /app/monitors.
        await expect(current).toHaveAttribute('href', status === 'openish' ? '/app/monitors?view=incidents' : `/app/monitors?view=incidents&status=${status}`);
        interactions++;
      }
      for (const mode of ['success', 'failure', 'throw']) {
        for (const action of ['ack', 'feedback', 'snooze']) {
          await visit(mode);
          const triage = page.locator('[data-triage-preview]');
          const calls = () => triage.locator('[data-triage-calls]').textContent().then(JSON.parse);
          const textbox = triage.getByRole('textbox', { name: t.feedback.correctionLabel });
          await textbox.fill('Retained correction / ' + 'sample_'.repeat(25));
          const button = triage.getByRole('button', { name: action === 'ack' ? t.actions.ack : action === 'feedback' ? t.feedback.wrong : t.actions.snooze1h, exact: true });
          await button.click(); await expect(textbox).toBeDisabled();
          if (mode !== 'success') {
            await expect(triage.getByRole('alert')).toHaveText(t.actions.unconfirmed);
            await expect(textbox).toHaveValue('Retained correction / ' + 'sample_'.repeat(25));
            assert.equal((await calls()).filter(c => c === 'refresh').length, 0);
            if (action === 'feedback') await expect(triage.getByRole('button', { name: t.feedback.partial, exact: true })).toHaveAttribute('aria-pressed', 'true');
            await fit(`${action}-${mode}`);
            await triage.getByRole('button', { name: 'Restore sample responses' }).click(); await button.click();
          }
          await expect(triage.getByRole('status')).toHaveText(t.feedback.saved);
          await expect(textbox).toBeEnabled();
          if (action === 'ack') {
            await triage.getByRole('button', { name: t.actions.unack, exact: true }).click();
            await expect(triage.getByRole('button', { name: t.actions.ack, exact: true })).toBeVisible();
          } else if (action === 'snooze') {
            await expect(triage.getByText(/2099/)).toBeVisible();
            await triage.getByRole('button', { name: t.actions.unsnooze, exact: true }).click();
            await expect(triage.getByRole('button', { name: t.actions.snooze24h, exact: true })).toBeVisible();
          } else await expect(triage.getByRole('button', { name: t.feedback.wrong, exact: true })).toHaveAttribute('aria-pressed', 'true');
          await fit(`saved-${action}-${mode}`); interactions++;
        }
      }
      assert.deepEqual(errors, []); assert.deepEqual(mutations, []);
      await context.close(); console.log(`PASS incidents ${locale}/${theme}`);
    }
  }
  console.log(JSON.stringify({ renders, interactions, screenshots: output }, null, 2));
} finally { await browser.close(); }
