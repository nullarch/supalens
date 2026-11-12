/** Actual manager with entirely local fixture actions. Never runs SQL or changes accounts. */
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';

const baseURL = process.argv[2] || 'http://localhost:3107';
assert(['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname));
const output = await mkdtemp(join(tmpdir(), 'supalens-monitor-manager-'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let renders = 0, interactions = 0;
try {
  for (const locale of ['en', 'ko', 'ja']) {
    const messages = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));
    const t = messages.appMonitors;
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 1000 } });
      await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: baseURL }]);
      await context.addInitScript(value => localStorage.setItem('theme', value), theme);
      const mutations = [], errors = [];
      await context.route('**/*', route => {
        const req = route.request(), url = req.url();
        if (url.startsWith(baseURL) && (new URL(url).pathname.startsWith('/api/') || !['GET', 'HEAD'].includes(req.method()))) {
          mutations.push(`${req.method()} ${url}`); return route.abort();
        }
        if (!url.startsWith(baseURL) && /posthog|sentry|google-analytics|googletagmanager|channel\.io/.test(url)) return route.abort();
        return route.continue();
      });
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error' && /MISSING_MESSAGE|INVALID_MESSAGE|DialogTitle|DialogDescription/.test(m.text())) errors.push(m.text()); });
      const open = async (mode = 'mixed', outcome = 'success', role = 'owner') => {
        const res = await page.goto(`${baseURL}/dev/monitors?mode=${mode}&outcome=${outcome}&role=${role}`, { waitUntil: 'domcontentloaded' });
        assert.equal(res.status(), 200); await page.evaluate(() => document.fonts.ready);
        await expect(page.locator('[data-fixture-ready]')).toHaveAttribute('data-fixture-ready', 'true');
      };
      const fit = async label => {
        for (const width of [1440, 768, 390, 320]) {
          await page.setViewportSize({ width, height: 1000 });
          await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
          const sizes = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, table: document.querySelector('table')?.scrollWidth }));
          assert.ok(sizes.scroll <= width + 1, `${label}: document ${sizes.scroll}/${width}`);
          if (width <= 820) assert.ok(sizes.table <= width - 39, `${label}: mobile table ${sizes.table}/${width}`);
          const dialog = page.getByRole('dialog');
          if (await dialog.count()) { const box = await dialog.boundingBox(); assert.ok(box.x >= 15 && box.x + box.width <= width - 15 && box.y >= 15 && box.y + box.height <= 985, 'Modal gutters'); }
          renders++;
          if (locale === 'en' && [1440, 320].includes(width) && ['mixed-owner', 'create', 'edit', 'history', 'delete-error'].includes(label)) await page.screenshot({ path: join(output, `${label}-${theme}-${width}.png`), fullPage: true });
        }
      };
      const row = id => page.locator(`[data-monitor-id="fixture-${id}"]`);
      const rowAction = async (target, label) => {
        await target.locator('button[aria-haspopup="menu"]').click();
        await target.getByRole('menuitem', { name: label, exact: true }).click();
      };
      const form = () => page.getByRole('region', { name: t.form.title, exact: true });
      // "+ New monitor" opens the goal composer; the create-method menu (KPI / Ask / SQL) sits on "Other ways"
      const menu = () => page.getByRole('button', { name: t.newMenu.other, exact: true });
      const createOpen = async () => {
        await menu().focus(); await page.keyboard.press('ArrowDown');
        await expect(page.getByRole('menuitem').first()).toBeFocused();
        await page.keyboard.press('End'); await expect(page.getByRole('menuitem').last()).toBeFocused();
        await page.keyboard.press('Enter'); await expect(form().getByLabel(t.edit.namePlaceholder, { exact: true })).toBeFocused();
      };
      const fillCreate = async () => {
        await form().getByLabel(t.edit.namePlaceholder, { exact: true }).fill('Sample operational metric');
        await form().getByLabel(t.form.sqlSummary, { exact: true }).fill('SELECT 0::numeric AS value');
        await form().getByLabel(t.form.thresholdPlaceholder, { exact: true }).fill('1');
      };
      const locked = async region => {
        assert.equal(await region.locator('input, textarea, button').evaluateAll(els => els.every(el => el.matches(':disabled'))), true, 'Form controls disabled during mutation');
      };

      // Narrow rerun for final copy/focus refinements without claiming an earlier matrix included them.
      if (process.argv.includes('--refinements')) {
        await open('healthy');
        await page.getByRole('main').evaluate(el => el.style.maxWidth = '760px');
        await expect(row('healthy')).toHaveCSS('display', 'grid');
        await page.getByRole('main').evaluate(el => el.style.maxWidth = '1400px');
        await expect(row('healthy')).toHaveCSS('display', 'table-row');
        await menu().focus(); await page.keyboard.press('ArrowUp'); await expect(page.getByRole('menuitem').last()).toBeFocused();
        await page.keyboard.press('Home'); await expect(page.getByRole('menuitem').first()).toBeFocused();
        await page.keyboard.press('Tab'); await expect(page.getByRole('menu')).toHaveCount(0);
        await rowAction(row('healthy'), t.btn.test);
        const expected = t.test.result.replace('{detail}', 'Sample value 3 ≥ 1; no production query was run').replace('{outcome}', t.test.met);
        await expect(page.getByRole('main').getByRole('status').first()).toHaveText(expected);
        await fit('test-result');
        await row('healthy').getByRole('button', { name: t.btn.edit, exact: true }).click();
        const editor = page.getByRole('group').filter({ has: page.getByLabel(t.detail.definition, { exact: true }) });
        await editor.getByLabel(t.form.thresholdPlaceholder, { exact: true }).fill('');
        await editor.getByRole('button', { name: t.cta.save, exact: true }).click();
        await expect(page.getByRole('main').getByRole('alert')).toContainText(t.form.fillAll);
        await editor.getByLabel(t.form.thresholdPlaceholder, { exact: true }).fill('0');
        await editor.getByRole('button', { name: t.cta.save, exact: true }).click();
        await expect(editor).toHaveCount(0);
        await expect(row('healthy').getByRole('button', { name: t.btn.edit, exact: true })).toBeFocused();
        await open('healthy', 'failure');
        await rowAction(row('healthy'), t.btn.delete);
        const dialog = page.getByRole('dialog');
        await dialog.getByRole('button', { name: t.btn.delete, exact: true }).click();
        await expect(dialog.getByRole('alert')).toBeVisible(); await page.keyboard.press('Tab'); await dialog.focus();
        // Tailwind's outline-none keeps a transparent solid outline for forced-color support.
        await expect(dialog).toHaveCSS('outline-color', 'rgba(0, 0, 0, 0)');
        const ring = await dialog.evaluate(el => {
          const probe = document.createElement('span'); probe.style.color = 'var(--clay)'; el.append(probe);
          const color = getComputedStyle(probe).color; probe.remove();
          return { color, shadow: getComputedStyle(el).boxShadow, keyboardFocus: el.matches(':focus-visible') };
        });
        assert.ok(ring.keyboardFocus && ring.shadow.includes(ring.color), `Visible focus uses the shared brand token: ${JSON.stringify(ring)}`);
        await fit('delete-focus');
        if (locale === 'en') await page.screenshot({ path: join(output, `final-dialog-${theme}.png`) });
        await page.goto(`${baseURL}/dev/operations?view=monitor&mode=empty`, { waitUntil: 'domcontentloaded' });
        await expect(page.getByText(t.health.pending, { exact: true })).toBeVisible();
        await expect(page.getByText(t.detail.nextCheck, { exact: true })).toBeVisible();
        for (const width of [1440, 320]) {
          await page.setViewportSize({ width, height: 1000 });
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); renders++;
        }
        interactions += 5;
        assert.deepEqual(mutations, []); assert.deepEqual(errors, []);
        await context.close(); console.log(`PASS final refinements ${locale}/${theme}`); continue;
      }

      for (const role of ['owner', 'viewer']) for (const mode of ['mixed', 'empty', 'paused', 'error', 'pending', 'healthy', 'incident', 'no-source', 'reconnect']) {
        await open(mode, 'success', role);
        const expected = mode === 'mixed' ? 'incident' : mode === 'reconnect' ? 'error' : ['empty', 'no-source'].includes(mode) ? 'empty' : mode;
        await expect(page.locator('[data-monitor-summary]')).toHaveAttribute('data-monitor-summary', expected);
        if (mode === 'error') { await expect(row('error').locator('[data-current-value]')).toHaveText('—'); await expect(row('error')).toContainText(`${t.detail.lastRecorded} · 17`); }
        if (mode === 'reconnect') {
          await expect(page.getByRole('region', { name: messages.appRecovery.heading })).toBeVisible();
          await expect(page.locator('[data-monitor-id]')).toHaveCount(4);
          await expect(page.locator('[data-current-value]')).toHaveText(['—', '—', '—', '—']);
          await page.locator('[data-recovery-kind=authorization] > summary').click();
          await expect(page.getByRole('link', { name: messages.appRecovery.reauthorize, exact: false })).toHaveCount(role === 'owner' ? 1 : 0);
          await page.locator('[data-recovery-kind=authorization] > summary').click();
        }
        if (mode === 'paused') await expect(row('paused')).toContainText(`${t.detail.lastRecorded} · 23`);
        if (role === 'viewer') { assert.equal(await page.getByRole('checkbox').count(), 0); assert.equal(await menu().count(), 0); }
        await fit(`${mode}-${role}`);
      }

      await open();
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.getByRole('main').evaluate(el => el.style.maxWidth = '760px');
      await expect(row('healthy')).toHaveCSS('display', 'grid');
      await page.getByRole('main').evaluate(el => el.style.maxWidth = '1400px');
      await expect(row('healthy')).toHaveCSS('display', 'table-row');
      interactions++;
      const filters = page.getByRole('group', { name: t.filter.aria }).getByRole('button');
      for (let i = 1; i < 6; i++) {
        await filters.nth(i).click(); await expect(filters.nth(i)).toHaveAttribute('aria-pressed', 'true');
        assert.equal(await page.locator('[data-monitor-id]').count(), 1);
      }
      await filters.first().click(); interactions++;
      await menu().click(); await page.keyboard.press('Escape'); await expect(menu()).toBeFocused(); await expect(page.getByRole('menu')).toHaveCount(0); interactions++;
      const more = row('healthy').locator('button[aria-haspopup="menu"]');
      await more.focus(); await page.keyboard.press('ArrowDown');
      await expect(row('healthy').getByRole('menuitem').first()).toBeFocused();
      await page.keyboard.press('End'); await expect(row('healthy').getByRole('menuitem').last()).toBeFocused();
      await page.keyboard.press('Home'); await expect(row('healthy').getByRole('menuitem').first()).toBeFocused();
      await page.keyboard.press('Escape'); await expect(more).toBeFocused();
      await expect(page.locator('[data-fixture-calls]')).toContainText('No sample requests');
      interactions++;

      await createOpen(); await fit('create'); await fillCreate();
      // Blank threshold must not silently become zero.
      await form().getByLabel(t.form.thresholdPlaceholder, { exact: true }).fill('');
      await form().getByRole('button', { name: t.form.create, exact: true }).click();
      await expect(page.getByRole('main').getByRole('alert')).toContainText(t.form.fillAll);
      await expect(page.locator('[data-fixture-calls]')).toContainText('No sample requests');
      await form().getByLabel(t.form.thresholdPlaceholder, { exact: true }).fill('0');
      await form().getByRole('button', { name: t.form.create, exact: true }).click(); await locked(form());
      await expect(form()).toHaveCount(0); await expect(page.locator('[data-monitor-id="fixture-created-1"]')).toContainText(t.health.pending); await expect(menu()).toBeFocused(); interactions++;

      for (const outcome of ['failure', 'throw']) {
        await open('healthy', outcome); await createOpen(); await fillCreate();
        await form().getByRole('button', { name: t.form.create, exact: true }).click(); await locked(form());
        await expect(page.getByRole('main').getByRole('alert')).toBeVisible();
        await expect(form().getByLabel(t.edit.namePlaceholder, { exact: true })).toHaveValue('Sample operational metric');
        await expect(form().getByLabel(t.form.thresholdPlaceholder, { exact: true })).toHaveValue('1');
        await form().getByRole('button', { name: t.btn.cancel, exact: true }).click();
        await expect(menu()).toBeFocused(); interactions++;
      }
      await open('healthy'); await createOpen(); await fillCreate();
      await form().getByRole('button', { name: t.form.anomaly, exact: true }).click();
      await form().getByLabel(t.form.vsNormal, { exact: true }).fill('2.5');
      await form().getByRole('button', { name: t.form.create, exact: true }).click(); await expect(form()).toHaveCount(0); interactions++;

      for (const outcome of ['success', 'failure', 'throw']) {
        await open('error', outcome); await row('error').getByRole('button', { name: t.btn.edit, exact: true }).click();
        const editor = page.getByRole('group').filter({ has: page.getByLabel(t.detail.definition, { exact: true }) });
        await editor.getByLabel(t.edit.namePlaceholder, { exact: true }).fill('Revised sample metric');
        await editor.getByLabel(t.detail.definition, { exact: true }).fill('A retained definition draft');
        if (outcome === 'success') await fit('edit');
        await editor.getByRole('button', { name: t.cta.save, exact: true }).click(); await locked(editor);
        if (outcome === 'success') { await expect(editor).toHaveCount(0); await expect(row('error')).toContainText('Revised sample metric'); await expect(row('error').getByRole('button', { name: t.btn.edit, exact: true })).toBeFocused(); }
        else { await expect(page.getByRole('main').getByRole('alert')).toBeVisible(); await expect(editor.getByLabel(t.detail.definition, { exact: true })).toHaveValue('A retained definition draft'); }
        interactions++;
      }

      for (const outcome of ['success', 'history-error', 'history-empty', 'throw']) {
        await open('healthy', outcome, 'viewer'); await row('healthy').getByRole('button', { name: t.btn.history, exact: true }).click();
        const history = page.getByRole('region', { name: t.history.title });
        await expect(history.getByRole('status')).toContainText(t.history.loading);
        if (['history-error', 'throw'].includes(outcome)) {
          await expect(history.getByRole('alert')).toContainText(t.history.failed);
          await expect(history).not.toContainText(t.history.empty);
          if (outcome === 'history-error') { await history.getByRole('button', { name: t.history.retry }).click(); await expect(history).toContainText('Three sample payments'); }
        } else if (outcome === 'history-empty') await expect(history).toContainText(t.history.empty);
        else { await expect(history).toContainText('Three sample payments'); await fit('history'); }
        interactions++;
      }

      for (const outcome of ['success', 'failure', 'throw']) {
        await open('healthy', outcome);
        await rowAction(row('healthy'), t.btn.test);
        await expect(row('healthy').locator('button[aria-haspopup="menu"]')).toBeDisabled();
        if (outcome === 'success') await expect(page.getByRole('status').first()).toContainText('Sample value');
        else await expect(page.getByRole('main').getByRole('alert')).toBeVisible();
        const toggle = row('healthy').locator('button[aria-pressed]');
        await toggle.click(); await expect(toggle).toBeEnabled();
        await expect(toggle).toHaveAttribute('aria-pressed', outcome === 'success' ? 'false' : 'true');
        interactions += 2;
      }
      for (const outcome of ['success', 'failure']) {
        await open('mixed', outcome); await page.getByRole('checkbox', { name: t.bulk.selectAll, exact: true }).check();
        await page.getByRole('button', { name: t.bulk.pause, exact: true }).click();
        await expect(page.getByRole('checkbox').first()).toBeDisabled();
        if (outcome === 'success') { await expect(page.locator('[data-monitor-summary]')).toHaveAttribute('data-monitor-summary', 'paused'); await expect(page.getByRole('toolbar')).toHaveCount(0); }
        else { await expect(page.getByRole('main').getByRole('alert')).toBeVisible(); await expect(page.getByRole('checkbox').first()).toBeChecked(); }
        interactions++;
      }
      for (const outcome of ['success', 'failure', 'throw']) {
        await open('healthy', outcome); const opener = row('healthy').locator('button[aria-haspopup="menu"]');
        await rowAction(row('healthy'), t.btn.delete); let dialog = page.getByRole('dialog');
        await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
        await rowAction(row('healthy'), t.btn.delete); dialog = page.getByRole('dialog');
        await dialog.getByRole('button', { name: t.btn.delete, exact: true }).click();
        await expect(dialog.getByRole('button', { name: messages.appCommon.close, exact: true })).toBeDisabled();
        await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
        if (outcome === 'success') { await expect(dialog).toHaveCount(0); await expect(row('healthy')).toHaveCount(0); await expect(menu()).toBeFocused(); }
        else { await expect(dialog.getByRole('alert')).toBeVisible(); await expect(row('healthy')).toHaveCount(1); if (outcome === 'failure') await fit('delete-error'); }
        interactions++;
      }
      assert.deepEqual(mutations, [], 'Fixture must never send API or server actions'); assert.deepEqual(errors, [], 'No runtime or localization errors');
      await context.close(); console.log(`PASS ${locale}/${theme}`);
    }
  }
  console.log(JSON.stringify({ renders, interactions, screenshots: output }, null, 2));
} catch (error) {
  // Report a failed assertion before browser cleanup; shutdown itself can stall on macOS.
  console.error(error);
  throw error;
} finally { await browser.close(); }
