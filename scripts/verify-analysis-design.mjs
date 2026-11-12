import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { localFixtureOrigin, guardDesignFixture } from './lib/design-fixture.mjs';

const base = localFixtureOrigin(process.argv[2]);
const output = await mkdtemp(join(tmpdir(), 'supalens-analysis-'));
const browser = await chromium.launch({ headless: true });
let renders = 0, interactions = 0;
const views = process.argv.includes('--refinements') ? { stream: ['mixed', 'empty', 'error'], composer: ['mixed'] } : {
  history: ['mixed', 'empty', 'filtered', 'error', 'legacy', 'page2', 'invalid'],
  run: ['succeeded', 'failed', 'cancelled', 'queued', 'running', 'unknown', 'empty', 'charts-only', 'invalid'],
  shared: ['mixed', 'empty', 'charts-only', 'invalid'],
  stream: ['mixed', 'empty', 'error', 'thinking'],
  composer: ['mixed'],
};
try {
  for (const locale of ['en', 'ko', 'ja']) {
    const messages = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));
    const t = messages.appAsk;
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
      await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: base }]);
      await context.addInitScript(value => localStorage.setItem('theme', value), theme);
      const errors = [], requests = [];
      await guardDesignFixture(context, base, requests);
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (/MISSING_MESSAGE|INVALID_MESSAGE|ENVIRONMENT_FALLBACK/.test(message.text())) errors.push(message.text()); });
      async function visit(view, mode) {
        const response = await page.goto(`${base}/dev/analysis?view=${view}&mode=${mode}`, { waitUntil: 'domcontentloaded' });
        assert.equal(response.status(), 200); await page.evaluate(() => document.fonts.ready);
      }
      async function fit(label) {
        for (const width of [1440, 768, 390, 320]) {
          await page.setViewportSize({ width, height: 1000 });
          await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
          await expect(page.getByRole('status', { name: messages.appDashboards.widget.loading, exact: true })).toHaveCount(0);
          await expect.poll(() => page.locator('.recharts-responsive-container').evaluateAll(nodes => nodes.every(node => {
            const svg = node.querySelector('svg.recharts-surface');
            return svg && Math.abs(svg.getBoundingClientRect().width - node.getBoundingClientRect().width) < 2;
          })), { message: `${label}: chart finished measuring the current viewport` }).toBe(true);
          // ChartFrame intentionally debounces ResizeObserver by 80 ms. Wait for the
          // measured SVG to settle; a persistent overflow must still fail this assertion.
          await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
            { timeout: 3000, message: `${locale}/${theme}/${label}/${width}: document overflow` }).toBe(true);
          renders++;
          if (locale === 'en' && [1440, 320].includes(width)) await page.screenshot({ path: join(output, `${label}-${theme}-${width}.png`), fullPage: true });
        }
      }
      for (const [view, modes] of Object.entries(views)) {
        for (const mode of modes) {
          await visit(view, mode);
          if (['run', 'shared'].includes(view) && !['empty', 'invalid'].includes(mode)) {
            await expect(page.locator('.recharts-line-curve')).toHaveCount(1);
          }
          await fit(`${view}-${mode}`);
          if (view === 'history') {
            if (mode === 'error') { await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText(t.history.loadFailed); await expect(page.getByText(t.history.empty, { exact: true })).toHaveCount(0); }
            if (mode === 'filtered') {
              await expect(page.getByRole('link', { name: t.history.next, exact: true })).toHaveAttribute('href', '/app/ask/history?origin=incident&page=2');
              await expect(page.getByRole('link', { name: t.history.viewIncident, exact: true })).toHaveAttribute('href', '/app/incidents/sample-incident');
            }
            if (mode === 'legacy') await expect(page.getByRole('navigation', { name: t.history.filter.label })).toHaveCount(0);
            if (mode === 'page2') await expect(page.getByRole('link', { name: t.history.prev, exact: true })).toHaveAttribute('href', '/app/ask/history?page=1');
            if (mode === 'mixed') {
              await expect(page.getByText(t.history.status.unknown, { exact: true })).toBeVisible();
              await expect(page.getByRole('link', { name: 'failed: sample question', exact: true })).toHaveAttribute('href', '/app/ask/history/sample-3');
              await expect(page.getByText(t.history.timezone, { exact: false })).toBeVisible();
              await expect(page.locator('time').first()).toHaveAttribute('datetime', '2026-09-07T12:05:00.000Z');
            }
          }
          if (['run', 'shared'].includes(view)) {
            await expect(page.getByRole('button', { name: messages.appDashboards.saveToReport, exact: true })).toHaveCount(0);
            if (mode === 'charts-only') await expect(page.getByText(t.run.noAnswer, { exact: true })).toHaveCount(0);
            if (mode === 'empty') await expect(page.getByText(t.run.noAnswer, { exact: true })).toBeVisible();
            if (view === 'run' && mode === 'failed') await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText('Sample failure');
            if (view === 'run' && ['queued', 'running'].includes(mode)) await expect(page.locator(`[role="status"][data-state="${mode}"]`)).toContainText(t.run.recordedProgress);
            if (view === 'shared') {
              const home = locale === 'en' ? '/' : `/${locale}`;
              await expect(page.getByRole('link', { name: 'supalens', exact: true })).toHaveAttribute('href', home);
              await expect(page.locator('footer a')).toHaveAttribute('href', home);
              await expect(page.getByText(t.run.snapshot, { exact: true })).toBeVisible();
            }
          }
          if (view === 'stream') {
            if (mode === 'error') {
              const alert = page.locator('[role="alert"]:not(#__next-route-announcer__)');
              await expect(alert).toHaveText(t.view.interrupted);
              assert.ok(await alert.evaluate(element => {
                const probe = document.createElement('span'); probe.style.color = 'var(--intent-negative)'; element.append(probe);
                const expected = getComputedStyle(probe).color; probe.remove(); return getComputedStyle(element).color === expected;
              }), 'stream error must use independent negative intent');
            }
            if (mode === 'thinking') await expect(page.getByRole('status')).toHaveText(t.chat.thinking);
            if (mode === 'mixed') {
              const summary = page.locator('summary').filter({ hasText: t.chat.sqlSteps.replace('{count}', '1') });
              await summary.focus(); await page.keyboard.press('Enter'); await expect(page.locator('pre')).toBeVisible();
              await fit('stream-sql-open'); interactions++;
            }
          }
        }
      }
      await visit('source', 'mixed');
      await expect(page.locator('[data-source-ready]')).toHaveAttribute('data-source-ready', 'true');
      for (const width of [1440, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 640 });
        const trigger = page.getByRole('button', { name: t.chat.sourceLabel, exact: true });
        await trigger.focus(); await page.keyboard.press('ArrowDown');
        const options = page.getByRole('option');
        await expect(options).toHaveCount(3); await expect(page.getByRole('option', { selected: true })).toBeFocused();
        await page.keyboard.press('End'); await expect(options.nth(2)).toBeFocused();
        await page.keyboard.press('Home'); await expect(options.nth(0)).toBeFocused();
        await page.keyboard.press('ArrowDown'); await expect(options.nth(1)).toBeFocused();
        const box = await page.getByRole('listbox').boundingBox();
        assert.ok(box.x >= 15 && box.x + box.width <= width - 15 && box.y >= 15 && box.y + box.height <= 625, 'source menu viewport containment');
        assert.ok(await page.getByRole('listbox').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'source options inner overflow');
        await page.keyboard.press('Enter'); await expect(page.locator('[data-source-value]')).toHaveText('sample-b'); await expect(trigger).toBeFocused();
        await page.keyboard.press('ArrowDown'); await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
        await page.keyboard.press('ArrowDown'); await page.keyboard.press('Tab'); await expect(page.getByRole('listbox')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'After picker', exact: true })).toBeFocused();
        await page.getByRole('textbox', { name: t.chat.questionLabel }).fill('Retained sample question');
        await expect(page.getByRole('textbox')).toHaveValue('Retained sample question'); interactions++;
      }
      await fit('source');
      assert.deepEqual(errors, []); assert.deepEqual(requests, []);
      await context.close(); console.log(`PASS analysis ${locale}/${theme}`);
    }
  }
  console.log(JSON.stringify({ renders, interactions, screenshots: output }, null, 2));
} finally { await browser.close(); }
