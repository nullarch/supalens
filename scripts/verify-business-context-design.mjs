import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';

const base = process.argv[2] || 'http://localhost:3107';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const output = await mkdtemp(join(tmpdir(), 'supalens-business-context-'));
const browser = await chromium.launch({ headless: true });
let renders = 0, interactions = 0;
try {
  for (const locale of ['en', 'ko', 'ja']) {
    const { appBusinessModel: t } = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
      await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: base }]);
      await context.addInitScript(value => localStorage.setItem('theme', value), theme);
      const errors = [], mutations = [];
      await context.route('**/*', route => {
        const r = route.request(), url = r.url();
        if (url.startsWith(base) && (!['GET', 'HEAD'].includes(r.method()) || new URL(url).pathname.startsWith('/api/'))) { mutations.push(url); return route.abort(); }
        if (!url.startsWith(base) && !url.startsWith('https://fonts.')) return route.abort();
        return route.continue();
      });
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (/MISSING_MESSAGE|INVALID_MESSAGE|Encountered two children/.test(m.text())) errors.push(m.text()); });
      const visit = async (mode, view = 'detail') => {
        const response = await page.goto(`${base}/dev/business-model?mode=${mode}&view=${view}`);
        assert.equal(response.status(), 200, `${mode}/${view}`);
        await page.evaluate(() => document.fonts.ready);
      };
      async function fit(label) {
        for (const width of [1440, 768, 390, 320]) {
          await page.setViewportSize({ width, height: 1000 });
          await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), { message: `${label}/${locale}/${theme}/${width}` }).toBe(true);
          await expect.poll(() => page.locator('[role="tab"][aria-selected="true"]').evaluateAll(tabs => tabs.flatMap(tab => {
            const item = tab.getBoundingClientRect(), list = tab.parentElement.getBoundingClientRect();
            return item.left >= list.left - 1 && item.right <= list.right + 1 ? [] : [{ tab: tab.textContent, left: item.left, right: item.right, listLeft: list.left, listRight: list.right, scroll: tab.parentElement.scrollLeft }];
          })), { message: `Selected tab clipped: ${label}/${width}` }).toEqual([]);
          renders++;
        }
      }
      for (const mode of ['fresh', 'stale', 'generating', 'failed', 'none', 'long', 'invalid-time']) {
        await visit(mode);
        const previews = page.locator('[data-context-preview]');
        await expect(previews).toHaveCount(2);
        for (const tab of ['entities', 'rules', 'metrics', 'changes', 'raw']) {
          for (const preview of await previews.all()) {
            const button = preview.getByRole('tab', { name: new RegExp(t.tabs[tab].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });
            await button.click();
            await expect(button).toHaveAttribute('aria-selected', 'true');
            const panel = preview.getByRole('tabpanel');
            await expect(panel).toHaveAttribute('aria-labelledby', await button.getAttribute('id'));
            await expect(panel).toHaveAttribute('id', await button.getAttribute('aria-controls'));
            assert.equal(await preview.locator('[role="tab"][tabindex="0"]').count(), 1);
            if (tab === 'changes') {
              const title = mode === 'generating' ? t.state.generating : mode === 'none' ? t.state.none : mode === 'failed' ? t.changes.failedTitle : mode === 'fresh' ? t.changes.freshTitle : t.changes.staleTitle;
              await expect(panel.getByRole('heading', { name: title, exact: true })).toBeVisible();
              if (['generating', 'none'].includes(mode)) await expect(panel.getByText(t.changes.freshTitle, { exact: true })).toHaveCount(0);
              if (mode === 'generating') await expect(panel.getByRole('button', { name: t.changes.regenerating, exact: true })).toBeDisabled();
              if (mode === 'invalid-time') await expect(panel.getByText(t.changes.timeUnavailable, { exact: true })).toBeVisible();
              else if (mode !== 'none') await expect(panel.locator('time')).toContainText('UTC');
            }
            if (tab === 'metrics') {
              for (const summary of await panel.locator('summary').all()) { await summary.focus(); await summary.press('Enter'); }
              for (const link of await panel.getByRole('link').all()) await expect(link).toHaveAttribute('href', /\/app\/sources\/sample-context-\d\/kpis/);
            }
            if (mode === 'none' && ['entities', 'rules', 'metrics', 'raw'].includes(tab)) await expect(panel).toContainText(t[tab].empty);
          }
          await fit(`${mode}-${tab}`);
          if (locale === 'en' && mode === 'long' && ['rules', 'metrics', 'changes'].includes(tab)) await page.screenshot({ path: join(output, `${theme}-${tab}-320.png`), fullPage: true });
        }
      }
      // Actual keyboard tabs and nested scroll regions, at a narrow viewport.
      await visit('long'); await page.setViewportSize({ width: 320, height: 640 });
      const first = page.locator('[data-context-preview]').first();
      const tabs = first.getByRole('tab');
      await tabs.first().focus(); await tabs.first().press('ArrowRight'); await expect(tabs.nth(1)).toBeFocused();
      await tabs.nth(1).press('End'); await expect(tabs.last()).toBeFocused();
      await tabs.last().press('ArrowRight'); await expect(tabs.first()).toBeFocused();
      await tabs.first().press('ArrowLeft'); await expect(tabs.last()).toBeFocused();
      await tabs.last().press('Home'); await expect(tabs.first()).toBeFocused();
      const table = first.locator('[role="region"]'); await table.focus(); await table.press('ArrowRight');
      await expect.poll(() => table.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
      await tabs.last().click(); const raw = first.locator('pre'); await raw.focus(); await raw.press('PageDown');
      await expect.poll(() => raw.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
      interactions += 7;

      for (const mode of ['success', 'failure', 'throw', 'limit', 'quota', 'running', 'malformed']) {
        await visit(mode);
        const previews = page.locator('[data-context-preview]');
        for (let index = 0; index < 2; index++) {
          const preview = previews.nth(index);
          await preview.getByRole('tab', { name: t.tabs.changes, exact: true }).click();
          const submit = preview.locator('button.dx-btn');
          await submit.click(); await expect(submit).toBeDisabled();
          await submit.dispatchEvent('click');
          await expect(preview.locator('[data-requests]')).toHaveText('1');
          await expect(submit).toBeEnabled();
          if (mode !== 'success') {
            const key = { limit: 'errorLimit', quota: 'errorQuota', running: 'errorRunning' }[mode] || 'errorGeneric';
            await expect(preview.getByRole('alert')).toContainText(t.changes[key]);
            await expect(preview.locator('[data-refreshes]')).toHaveText('0');
            if (['limit', 'quota'].includes(mode)) await expect(preview.getByRole('link', { name: t.changes.billing + ' →' })).toHaveAttribute('href', '/app/settings/billing');
            await fit(`${mode}-${index}-error`);
            await preview.getByRole('button', { name: 'Restore sample responses' }).click();
            await submit.click(); await expect(submit).toBeEnabled();
            await expect(preview.locator('[data-requests]')).toHaveText('2');
          }
          await expect(preview.getByRole('status')).toHaveText(index ? t.changes.completed : t.changes.started);
          await expect(preview.locator('[data-refreshes]')).toHaveText('1');
          await preview.getByRole('button', { name: t.changes.refresh, exact: true }).click();
          await expect(preview.locator('[data-refreshes]')).toHaveText('2');
          await fit(`${mode}-${index}-confirmed`);
          interactions += mode === 'success' ? 3 : 4;
        }
      }
      for (const mode of ['fresh', 'none', 'long', 'invalid-time']) {
        await visit(mode, 'index'); await fit(`index-${mode}`);
        if (mode === 'none') await expect(page.getByRole('link', { name: t.emptyCta })).toHaveAttribute('href', '/app/sources');
        else { await expect(page.locator('a[href^="/app/business-model/"]')).toHaveCount(4); await expect(page.locator('a[href="/app/sources"]')).toHaveCount(1); }
      }
      assert.deepEqual(errors, []); assert.deepEqual(mutations, []);
      console.log(`PASS ${locale}/${theme}`);
      await context.close();
    }
  }
  console.log(JSON.stringify({ viewportCases: renders, localInteractions: interactions, output }));
} finally { await browser.close(); }
