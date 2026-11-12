/** Real connection UI; synthetic credentials and intercepted requests only. */
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect } from '@playwright/test';

const baseURL = process.argv[2] || 'http://localhost:3107';
assert(['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname));
const output = await mkdtemp(join(tmpdir(), 'supalens-connections-'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let renders = 0, interactions = 0;
const field = (scope, label) => scope.getByLabel(new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\*?$'));

async function fit(page) {
  await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 1);
  const dialog = page.getByRole('dialog');
  if (await dialog.count()) {
    const box = await dialog.boundingBox();
    const viewport = page.viewportSize();
    assert.ok(box.x >= 15 && box.x + box.width <= viewport.width - 15);
    assert.ok(box.height <= viewport.height - 31);
  }
}

try {
  for (const locale of ['en', 'ko', 'ja']) {
    const m = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));
    const t = m.appSources, tp = m.appSetup.projects;
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ reducedMotion: 'reduce' });
      context.setDefaultTimeout(10000);
      const unexpected = [], errors = [];
      let expectedPath = null, held = null, payload = null;
      await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: baseURL }]);
      await context.addInitScript(value => localStorage.setItem('theme', value), theme);
      await context.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== new URL(baseURL).origin && !['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) return route.abort();
        if (request.url().startsWith(baseURL) && url.pathname.startsWith('/api/')) {
          if (url.pathname === expectedPath && ['POST', 'PATCH'].includes(request.method())) {
            held = route;
            payload = request.postDataJSON();
            return; // Test observes the busy state, then fulfills a synthetic failure.
          }
          if (request.method() !== 'GET' || url.pathname.includes('/authorize')) unexpected.push(`${request.method()} ${url.pathname}`);
          return route.fulfill({ status: 200, json: { sources: [], jobs: [], projects: [] } });
        }
        if (!['GET', 'HEAD'].includes(request.method())) {
          // No analytics or other writes leave this fixture browser either.
          if (request.url().startsWith(baseURL)) unexpected.push(`${request.method()} ${url.pathname}`);
          return route.abort();
        }
        return route.continue();
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (/MISSING_MESSAGE|INVALID_MESSAGE/.test(message.text())) errors.push(message.text()); });
      for (const [view, modes] of [
        ['form', ['postgres', 'mysql', 'firestore']],
        ['repo', ['empty', 'list', 'attached']],
        ['projects', ['choose', 'viewer', 'pending', 'error', 'empty', 'reconnect']],
      ]) {
        for (const mode of modes) {
          assert.equal((await page.goto(`${baseURL}/dev/connections?view=${view}&mode=${mode}`)).status(), 200);
          await page.evaluate(() => document.fonts.ready);
          if (view === 'repo') {
            const smallText = page.locator('[class*="repoBranch"], [class*="scopeCode"], [class*="scopeNote"]');
            assert.ok(await smallText.count(), 'Repository permissions/branch explanation is present');
            assert.deepEqual(await smallText.evaluateAll(nodes => nodes.filter(node => parseFloat(getComputedStyle(node).fontSize) < 12).map(node => node.textContent)), [], 'Repository explanations stay at least 12px');
          }
          for (const width of [1440, 768, 390, 320]) {
            await page.setViewportSize({ width, height: 900 });
            await fit(page);
            renders++;
          }
          if (locale === 'en' && ['firestore', 'list', 'choose'].includes(mode)) await page.screenshot({ path: join(output, `${view}-${mode}-${theme}.png`), fullPage: true });
          if (view === 'projects' && mode === 'viewer') {
            const enabled = await page.getByRole('checkbox').evaluateAll(es => es.filter(e => !e.disabled).length);
            assert.equal(enabled, 0);
          }
          if (view === 'projects' && mode === 'reconnect') await expect(page.getByRole('link', { name: tp.reconnectCta, exact: true })).toHaveAttribute('href', /connect-supabase\/authorize/);
          console.log(`PASS ${view}/${mode}/${locale}/${theme}`);
        }
      }

      // Source list: a card grid — two columns at desktop content width, one on tablets and phones;
      // pipeline rows that lead somewhere stay real touch targets; a connect tile closes the grid.
      assert.equal((await page.goto(`${baseURL}/dev/connections?view=list`)).status(), 200);
      await page.evaluate(() => document.fonts.ready);
      const cards = page.locator('article[aria-labelledby^="source-"]');
      await expect(cards).toHaveCount(6);
      // The connect tile is pinned as the grid's first cell (and is the page's only connect entry).
      const addTile = page.getByRole('button', { name: t.connect.addTitle });
      await expect(addTile).toHaveCount(1);
      assert.ok(await addTile.evaluate(node => node.parentElement.firstElementChild === node), 'Connect tile is the first grid cell');
      for (const width of [1440, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await fit(page);
        // With the tile in cell 1, cards 2 and 3 share the second row when there are two columns.
        const [second, third] = await cards.evaluateAll(nodes => nodes.slice(1, 3).map(node => node.getBoundingClientRect().top));
        assert.equal(Math.abs(second - third) < 1, width === 1440, `Source cards use ${width === 1440 ? 'two columns' : 'one column'} at ${width}px`);
        // Beside the tile at desktop width, the first card shares its row; stacked, the tile stays slim.
        const tileBox = await addTile.boundingBox(), cardBox = await cards.first().boundingBox();
        assert.equal(Math.abs(tileBox.y - cardBox.y) < 1, width === 1440, `Connect tile shares the first row only in two columns (${width}px)`);
        if (width !== 1440) assert.ok(tileBox.height <= 80 && tileBox.height >= 44, 'Stacked connect tile is a slim touch target');
        for (const row of await cards.locator('[data-interactive]').all()) {
          assert.ok((await row.boundingBox()).height >= 44, 'Pipeline rows are 44px touch targets');
        }
        renders++;
      }
      if (locale === 'en') await page.screenshot({ path: join(output, `list-grid-${theme}.png`), fullPage: true });

      for (const mode of ['postgres', 'mysql', 'firestore']) {
        await page.goto(`${baseURL}/dev/connections?view=form&mode=${mode}`);
        const dialog = page.getByRole('dialog');
        if (mode === 'firestore') {
          const file = dialog.locator('input[type="file"]');
          await file.focus();
          await expect(file).toBeFocused();
          await file.setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{not-valid') });
          await expect(field(dialog, t.form.pasteJson)).toHaveValue('{not-valid');
          await file.setInputFiles({ name: 'sample-service-account-for-international-analytics-preview.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ type: 'service_account', project_id: 'fixture-project', client_email: 'fixture-reader@international-analytics-preview.example.invalid', private_key: 'NOT_A_REAL_PRIVATE_KEY' })) });
          await expect(field(dialog, t.form.name)).toHaveValue('fixture-project');
          await fit(page);
          const described = await field(dialog, t.form.pasteJson).getAttribute('aria-describedby');
          assert.ok(described);
          assert.equal(await page.locator(`[id="${described}"]`).textContent(), t.form.saHint);
        } else {
          for (const [label, value] of [[t.form.name, 'Fixture only'], [t.form.host, 'database.example.invalid'], [t.form.database, 'sample'], [t.form.user, 'fixture_reader'], [t.form.password, 'NOT_A_REAL_PASSWORD']]) {
            await field(dialog, label).fill(value);
          }
          await expect(field(dialog, t.form.port)).toHaveValue(mode === 'mysql' ? '3306' : '5432');
        }
        expectedPath = '/api/data-sources'; held = null;
        await dialog.getByRole('button', { name: t.form.submit, exact: true }).click();
        await expect.poll(() => !!held).toBe(true);
        await expect(field(dialog, t.form.name)).toBeDisabled();
        await page.keyboard.press('Escape');
        await expect(dialog).toBeVisible();
        if (mode !== 'firestore') assert.equal(payload.port, mode === 'mysql' ? 3306 : 5432);
        await held.fulfill({ status: 503, json: { message: 'Sample connection failed. No external database was contacted.' } });
        expectedPath = null; held = null;
        await expect(dialog.getByRole('alert')).toContainText('Sample connection failed');
        await expect(field(dialog, t.form.name)).toBeEnabled();
        await expect(field(dialog, t.form.name)).toHaveValue(mode === 'firestore' ? 'fixture-project' : 'Fixture only');
        await fit(page);
        if (locale === 'en') await page.screenshot({ path: join(output, `form-error-${mode}-${theme}.png`) });
        interactions++;
      }

      await page.goto(`${baseURL}/dev/connections?view=repo&mode=attached`);
      const dialog = page.getByRole('dialog');
      const group = dialog.getByRole('radiogroup');
      await group.locator('[aria-checked="true"]').focus();
      await page.keyboard.press('End');
      await expect(group.getByRole('radio', { name: t.attach.detach, exact: true })).toBeChecked();
      await page.keyboard.press('Home');
      await expect(group.getByRole('radio').first()).toBeChecked();
      await page.keyboard.press('ArrowDown');
      await expect(group.getByRole('radio').nth(1)).toBeChecked();
      await dialog.getByRole('searchbox').fill('no-matching-repository');
      await expect(dialog.getByText(t.attach.noMatches.replace('{query}', 'no-matching-repository'), { exact: true })).toBeVisible();
      await dialog.getByRole('searchbox').fill('billing-international');
      await group.getByRole('radio', { name: /northstar\/billing-international/ }).click();
      expectedPath = '/api/data-sources/fixture-source'; held = null;
      await dialog.getByRole('button', { name: t.attach.save, exact: true }).click();
      await expect.poll(() => !!held).toBe(true);
      assert.equal(payload.repoId, 'fixture-r9');
      await expect(dialog.getByRole('button', { name: t.attach.cancel, exact: true })).toBeDisabled();
      await expect(dialog.getByRole('button', { name: m.appCommon.close, exact: true })).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeVisible();
      await held.fulfill({ status: 503, json: { message: 'Sample repository update failed. No repository was changed.' } });
      expectedPath = null; held = null;
      await expect(dialog.getByRole('alert')).toContainText('Sample repository update failed');
      await expect(dialog.getByRole('button', { name: m.appCommon.close, exact: true })).toBeEnabled();
      await expect(group.getByRole('radio', { name: /northstar\/billing-international/ })).toBeChecked();
      await dialog.locator('details summary').click();
      await expect(dialog.locator('details')).toHaveAttribute('open', '');
      await fit(page);
      interactions++;

      await page.goto(`${baseURL}/dev/connections?view=projects&mode=choose`);
      await page.getByRole('checkbox', { name: 'Northstar staging', exact: true }).check();
      await page.getByRole('button', { name: tp.ctaMany.replace('{count}', '2'), exact: true }).click();
      await expect(page.locator('li[data-state="pending"]')).toHaveCount(2);
      await expect(page.getByRole('alert').filter({ hasText: 'Sample provisioning failed' })).toBeVisible();
      await expect(page.getByRole('checkbox', { name: 'Northstar staging', exact: true })).toBeChecked();
      await fit(page);
      interactions++;

      await page.goto(`${baseURL}/dev/connections?view=connect`);
      await page.getByRole('button', { name: t.connect.addTitle, exact: true }).click();
      await page.getByRole('button', { name: new RegExp(t.connect.othersToggle) }).click();
      const chooser = page.getByRole('dialog');
      for (const width of [1440, 768, 390, 320]) { await page.setViewportSize({ width, height: 900 }); await fit(page); renders++; }
      await chooser.getByRole('button', { name: /^PostgreSQL/ }).click();
      await expect(chooser.getByRole('heading')).toHaveText('PostgreSQL');
      assert.ok((await chooser.getByRole('button', { name: t.connect.back, exact: true }).boundingBox()).height >= 44);
      for (const [label, value] of [[t.form.name, 'Fixture only'], [t.form.host, 'database.example.invalid'], [t.form.database, 'sample'], [t.form.user, 'fixture_reader'], [t.form.password, 'NOT_A_REAL_PASSWORD']]) await field(chooser, label).fill(value);
      expectedPath = '/api/data-sources'; held = null;
      await chooser.getByRole('button', { name: t.form.submit, exact: true }).click();
      await expect.poll(() => !!held).toBe(true);
      await expect(chooser.getByRole('button', { name: m.appCommon.close, exact: true })).toBeDisabled();
      await expect(chooser.getByRole('button', { name: t.connect.back, exact: true })).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(chooser).toBeVisible();
      await held.fulfill({ status: 503, json: { message: 'Sample connection failed. No external database was contacted.' } });
      expectedPath = null; held = null;
      await expect(chooser.getByRole('alert')).toContainText('Sample connection failed');
      await expect(chooser.getByRole('button', { name: m.appCommon.close, exact: true })).toBeEnabled();
      interactions++;
      await chooser.getByRole('button', { name: t.connect.back, exact: true }).click();
      await expect(chooser.getByRole('heading')).toHaveText(t.connect.modalTitle);
      await expect(chooser.getByRole('link', { name: t.connect.supabaseCta, exact: true })).toHaveAttribute('href', /connect-supabase\/authorize/);
      interactions++;
      await page.goto(`${baseURL}/dev/modals`);
      const cardMenus = page.locator('article button[aria-haspopup="menu"]');
      await expect(cardMenus).toHaveCount(2);
      for (const width of [1440, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await fit(page);
        for (const menu of await cardMenus.all()) {
          const box = await menu.boundingBox();
          assert.ok(box.width >= 44 && box.height >= 44, 'Source-card menu has a 44px target');
        }
        renders++;
      }
      assert.deepEqual(errors, [], 'No runtime or missing translations');
      assert.deepEqual(unexpected, [], 'No unexpected mutations or authorization navigation');
      await context.close();
      console.log(`PASS ${locale}/${theme}: file upload, form failure, busy state, radio keyboard, project selection, provider flow`);
    }
  }
} finally {
  await browser.close();
  console.log(`Checked ${renders} viewport cases and ${interactions} connection interactions. Screenshots: ${output}`);
}
